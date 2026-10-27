// BUOC AcademiX Phase 5 — privileged identity operations.
// Deploy as Supabase Edge Function "admin-control".
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Never expose the service-role key to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanReason(value: unknown, fallback = "Administrator action") {
  const reason = typeof value === "string" ? value.trim() : "";
  return (reason || fallback).slice(0, 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return response(500, { error: "Admin function secrets are not configured." });
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return response(401, { error: "Authentication required." });
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return response(401, { error: "Invalid session." });

    const actorId = authData.user.id;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: actor, error: actorError } = await admin
      .from("profiles")
      .select("id,role,suspended_at")
      .eq("id", actorId)
      .maybeSingle();

    if (actorError) throw actorError;
    if (!actor || actor.role !== "admin" || actor.suspended_at) {
      return response(403, { error: "Active administrator access required." });
    }

    const body = await req.json();
    const action = String(body?.action || "");
    const userId = typeof body?.user_id === "string" ? body.user_id : "";
    const reason = cleanReason(body?.reason);
    const reasonRequiredActions = new Set(["set_role", "suspend", "reactivate"]);
    if (reasonRequiredActions.has(action) && (typeof body?.reason !== "string" || body.reason.trim().length < 3)) {
      return response(400, { error: "Provide a reason of at least 3 characters." });
    }
    if (typeof body?.reason === "string" && body.reason.trim().length > 500) {
      return response(400, { error: "Reason must be 500 characters or fewer." });
    }
    // Write an audit intent before privileged mutations. A failed or interrupted operation
    // remains visible as failure; successful operations are finalized after the mutation.
    const beginAudit = async (
      targetId: string | null,
      auditAction: string,
      details: Record<string, unknown> = {},
      auditReason = reason,
    ): Promise<number> => {
      const { data, error } = await admin.from("admin_audit_log").insert({
        actor_id: actorId, target_user_id: targetId, action: auditAction,
        outcome: "failure", reason: auditReason,
        details: { ...details, phase: "started" },
      }).select("id").single();
      if (error) throw error;
      return Number(data.id);
    };
    const finishAudit = async (auditId: number, details: Record<string, unknown> = {}) => {
      const { error } = await admin.from("admin_audit_log").update({
        outcome: "success", details: { ...details, phase: "completed" },
      }).eq("id", auditId);
      if (error) throw error;
    };
    const failAudit = async (auditId: number, error: unknown) => {
      const message = error instanceof Error ? error.message : "Administrative operation failed.";
      const { error: auditError } = await admin.from("admin_audit_log").update({
        outcome: "failure", details: { phase: "failed", error: message.slice(0, 500) },
      }).eq("id", auditId);
      if (auditError) console.error("Could not finalize failure audit:", auditError);
    };

    if (action === "list_users") {
      const query = String(body?.query || "").trim().toLowerCase().slice(0, 120);
      const collectedUsers: any[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data: pageData, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (usersError) throw usersError;
        const batch = pageData.users || [];
        collectedUsers.push(...batch);
        if (batch.length < 1000) break;
      }

      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id,full_name,role,bu_id,verified_at,suspended_at,suspension_reason,created_at");
      if (profilesError) throw profilesError;

      const { data: requests, error: requestsError } = await admin
        .from("teacher_access_requests")
        .select("user_id,status,requested_at,reviewed_at,review_note");
      if (requestsError && requestsError.code !== "42P01") throw requestsError;

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      const requestMap = new Map((requests || []).map((r) => [r.user_id, r]));
      const rows = collectedUsers.map((u) => {
        const p = profileMap.get(u.id);
        const request = requestMap.get(u.id);
        return {
          id: u.id,
          email: u.email || "",
          full_name: p?.full_name || u.user_metadata?.full_name || "",
          role: p?.role || "student",
          bu_id: p?.bu_id || "",
          verified_at: p?.verified_at || null,
          suspended: Boolean(p?.suspended_at || u.banned_until),
          suspended_at: p?.suspended_at || null,
          suspension_reason: p?.suspension_reason || null,
          teacher_request_status: request?.status || null,
          created_at: p?.created_at || u.created_at,
        };
      }).filter((u) => !query || [u.email, u.full_name, u.bu_id, u.id]
        .some((v) => String(v || "").toLowerCase().includes(query)))
        .slice(0, 100);

      return response(200, { users: rows });
    }

    if (action === "list_audit") {
      const { data, error } = await admin
        .from("admin_audit_log")
        .select("id,actor_id,target_user_id,action,outcome,reason,details,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const ids = [...new Set((data || []).map((r) => r.target_user_id).filter(Boolean))];
      const emailById = new Map<string, string>();
      for (const id of ids) {
        const { data: userData } = await admin.auth.admin.getUserById(id);
        if (userData?.user?.email) emailById.set(id, userData.user.email);
      }
      return response(200, {
        logs: (data || []).map((row) => ({
          ...row,
          target_email: emailById.get(row.target_user_id) || null,
        })),
      });
    }

    if (!userId) return response(400, { error: "A target user ID is required." });
    if (userId === actorId) {
      return response(403, { error: "You cannot change your own privileged access or delete your own account." });
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id,role,verified_at,suspended_at")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return response(404, { error: "Target account not found." });

    if (action === "set_role") {
      const newRole = String(body?.role || "");
      if (!["student", "teacher", "admin"].includes(newRole)) {
        return response(400, { error: "Role must be student, teacher, or admin." });
      }
      if (target.role === newRole) return response(400, { error: "Account already has that role." });
      if (target.role === "admin" && newRole !== "admin") {
        const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        if (error) throw error;
        if ((count || 0) <= 1) return response(409, { error: "Cannot demote the last administrator." });
      }
      const auditId = await beginAudit(userId, "role_changed", { old_role: target.role, new_role: newRole });
      const { error } = await admin.from("profiles").update({ role: newRole }).eq("id", userId);
      if (error) { await failAudit(auditId, error); throw error; }
      try { await finishAudit(auditId, { old_role: target.role, new_role: newRole }); }
      catch (error) {
        const { error: rollbackError } = await admin.from("profiles").update({ role: target.role }).eq("id", userId);
        await failAudit(auditId, error);
        if (rollbackError) console.error("Role rollback failed:", rollbackError);
        throw error;
      }
      return response(200, { success: true });
    }

    if (action === "set_verified") {
      const verified = body?.verified === true;
      const previousVerifiedAt = target.verified_at;
      const auditId = await beginAudit(userId, "verification_changed", { verified });
      const { error } = await admin.from("profiles")
        .update({ verified_at: verified ? new Date().toISOString() : null }).eq("id", userId);
      if (error) { await failAudit(auditId, error); throw error; }
      try { await finishAudit(auditId, { verified }); }
      catch (error) {
        const { error: rollbackError } = await admin.from("profiles").update({ verified_at: previousVerifiedAt }).eq("id", userId);
        await failAudit(auditId, error);
        if (rollbackError) console.error("Verification rollback failed:", rollbackError);
        throw error;
      }
      return response(200, { success: true });
    }

    if (action === "suspend" || action === "reactivate") {
      const shouldSuspend = action === "suspend";
      if (shouldSuspend && target.suspended_at) return response(409, { error: "Account is already suspended." });
      if (!shouldSuspend && !target.suspended_at) return response(409, { error: "Account is not suspended." });
      if (shouldSuspend && target.role === "admin") {
        const { count, error } = await admin.from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin").is("suspended_at", null);
        if (error) throw error;
        if ((count || 0) <= 1) return response(409, { error: "Cannot suspend the last active administrator." });
      }

      const { error: profileError } = await admin.from("profiles").update({
        suspended_at: shouldSuspend ? new Date().toISOString() : null,
        suspension_reason: shouldSuspend ? reason : null,
      }).eq("id", userId);
      if (profileError) throw profileError;

      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: shouldSuspend ? "876000h" : "none",
      });
      if (authError) throw authError;

      await audit(userId, shouldSuspend ? "account_suspended" : "account_reactivated", {}, reason);
      return response(200, { success: true });
    }

    if (action === "approve_teacher_request" || action === "reject_teacher_request") {
      const approve = action === "approve_teacher_request";
      const { data: request, error: requestError } = await admin
        .from("teacher_access_requests")
        .select("user_id,status")
        .eq("user_id", userId)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!request || request.status !== "pending") {
        return response(409, { error: "No pending Teacher access request exists." });
      }

      const { error: updateRequestError } = await admin.from("teacher_access_requests").update({
        status: approve ? "approved" : "rejected",
        reviewed_by: actorId,
        reviewed_at: new Date().toISOString(),
        review_note: cleanReason(body?.review_note, approve ? "Approved by administrator." : "Not approved by administrator."),
      }).eq("user_id", userId);
      if (updateRequestError) throw updateRequestError;

      if (approve) {
        const { error } = await admin.from("profiles")
          .update({ role: "teacher", verified_at: new Date().toISOString() })
          .eq("id", userId);
        if (error) throw error;
      }

      await audit(userId, approve ? "teacher_request_approved" : "teacher_request_rejected", {
        review_note: cleanReason(body?.review_note, approve ? "Approved by administrator." : "Not approved by administrator."),
      });
      return response(200, { success: true });
    }

    if (action === "delete_user") {
      if (body?.confirmation !== "DELETE") {
        return response(400, { error: "Explicit DELETE confirmation is required." });
      }
      // Persist the audit intent before the irreversible Auth deletion. If deletion fails,
      // the row is finalized as failure; if the process is interrupted, phase=started remains.
      const auditId = await beginAudit(userId, "account_deleted", { deleted: true }, "Account deletion explicitly confirmed by administrator.");
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) { await failAudit(auditId, error); throw error; }
      await finishAudit(auditId, { deleted: true });
      return response(200, { success: true });
    }

    return response(400, { error: "Unsupported admin action." });
  } catch (error) {
    console.error("admin-control error:", error);
    return response(500, { error: error instanceof Error ? error.message : "Unexpected administrative operation failure." });
  }
});
