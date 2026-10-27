import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const edge = await readFile("supabase/functions/admin-control/index.ts", "utf8");
const baseMigration = await readFile("supabase/migrations/20261028_phase5_identity_access.sql", "utf8");
const outcomeMigration = await readFile("supabase/migrations/20261029_phase5_audit_outcomes.sql", "utf8");

test("admin-control authenticates caller and requires an active admin", () => {
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /actor\.role !== "admin" \|\| actor\.suspended_at/);
  assert.match(edge, /401, \{ error: "Authentication required\."/);
});

test("privileged actions reject self-targeting and require explicit deletion confirmation", () => {
  assert.match(edge, /if \(userId === actorId\)/);
  assert.match(edge, /body\?\.confirmation !== "DELETE"/);
});

test("role changes, suspension and reactivation require a meaningful bounded reason", () => {
  assert.match(edge, /reasonRequiredActions = new Set\(\["set_role", "suspend", "reactivate"\]\)/);
  assert.match(edge, /body\.reason\.trim\(\)\.length < 3/);
  assert.match(edge, /body\.reason\.trim\(\)\.length > 500/);
  assert.match(baseMigration, /char_length\(trim\(reason\)\) BETWEEN 3 AND 500/);
});

test("audit intents are written before privileged mutations and finalized", () => {
  assert.match(edge, /const beginAudit = async/);
  assert.match(edge, /const finishAudit = async/);
  assert.match(edge, /const failAudit = async/);
  for (const action of ["role_changed", "verification_changed", "account_suspended", "account_reactivated", "teacher_request_approved", "teacher_request_rejected", "account_deleted"]) {
    assert.ok(edge.includes(`"${action}"`), `missing audit action: ${action}`);
  }
  assert.match(edge, /phase: "started"/);
  assert.match(edge, /phase: "completed"/);
  assert.match(edge, /phase: "failed"/);
});

test("audit outcome migration allows all outcomes used by the edge function", () => {
  assert.match(baseMigration, /outcome IN \('success'\)/);
  assert.match(outcomeMigration, /DROP CONSTRAINT IF EXISTS admin_audit_log_outcome_check/);
  assert.match(outcomeMigration, /CHECK \(outcome IN \('success', 'failure', 'denied'\)\)/);
  assert.match(edge, /outcome: "failure"/);
  assert.match(edge, /outcome: "success"/);
});

test("account listing paginates rather than stopping after the first auth page", () => {
  assert.match(edge, /for \(let page = 1; page <= 20; page\+\+\)/);
  assert.match(edge, /perPage: 1000/);
  assert.match(edge, /if \(batch\.length < 1000\) break/);
});

test("database audit log is protected by RLS and not directly writable by clients", () => {
  assert.match(baseMigration, /ALTER TABLE public\.admin_audit_log ENABLE ROW LEVEL SECURITY/);
  assert.match(baseMigration, /REVOKE ALL ON public\.admin_audit_log FROM anon, authenticated/);
  assert.match(baseMigration, /CREATE POLICY "Admins read identity audit log"/);
});

test("base migration and follow-up migration keep audit action and outcome constraints aligned", () => {
  const actions = [
    "role_changed", "account_suspended", "account_reactivated", "account_deleted",
    "verification_changed", "teacher_request_approved", "teacher_request_rejected"
  ];
  for (const action of actions) {
    assert.ok(baseMigration.includes(`'${action}'`), `base migration missing ${action}`);
  }
  assert.match(outcomeMigration, /COMMENT ON COLUMN public\.admin_audit_log\.outcome/);
});
