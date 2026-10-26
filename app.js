/* BUOC AcademiX client. Configure the two public Supabase values below.
   The anon/publishable key is designed for browsers; NEVER place service_role or LLM keys here. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://otkgtwwxmmdmiavmpyqo.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_A-o7buSKUahNZceiaJBgCw_cvzeW-Rg";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = { supabase: null, user: null, profile: null, authMode: "signin", view: "exams",
    draft: null, adminUsers: [], currentExam: null, currentQuestions: [], answers: {}, questionIndex: 0, timerId: null, secondsLeft: 0 };
  const configured = !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

  function toast(message, type = "") {
    const el = $("#toast"); el.textContent = message; el.className = `toast ${type}`.trim();
    clearTimeout(toast.timeout); toast.timeout = setTimeout(() => el.classList.add("hidden"), 4500);
  }
  function showOnly(id) {
    ["#auth-view", "#dashboard-view", "#exam-view"].forEach(s => $(s).classList.toggle("hidden", s !== id));
  }
  function setAuthMode(mode) {
    state.authMode = mode;
    $$("[data-auth-tab]").forEach(b => b.classList.toggle("active", b.dataset.authTab === mode));
    $("#signup-fields").classList.toggle("hidden", mode !== "signup");
    $("#auth-title").textContent = mode === "signin" ? "Welcome back" : "Create your account";
    $("#auth-subtitle").textContent = mode === "signin" ? "Sign in with your verified account." : "New accounts begin as students pending institutional verification.";
    $("#auth-submit").innerHTML = mode === "signin" ? "Sign in <span>→</span>" : "Create account <span>→</span>";
    $("#auth-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  }
  function switchView(view) {
    const role = state.profile?.role;
    if (view === "developer" && role !== "admin") return toast("Developer access is required.", "error");
    if (view === "teacher-home" && role !== "teacher") return toast("Teacher access is required.", "error");
    if (view === "student-home" && role !== "student") return toast("Student access is required.", "error");
    if (view === "generator" && !["teacher", "admin"].includes(role)) return toast("Teacher access is required.", "error");
    state.view = view;
    $$(".page-view").forEach(el => el.classList.toggle("hidden", el.id !== `view-${view}`));
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    $("#page-heading").textContent = ({ "student-home": "Learning Home", "teacher-home": "Teaching Hub", developer: "Developer Center", exams: role === "student" ? "My Exams" : "Exam Library", generator: role === "admin" ? "Exam Sandbox" : "Quiz Studio", grades: role === "student" ? "My Grades" : "Results", account: "Account" })[view] || "AcademiX";
    $("#role-label").textContent = ({ student: "STUDENT LEARNING WORKSPACE", teacher: "TEACHING & ASSESSMENT WORKSPACE", admin: "PLATFORM OPERATIONS / DEVELOPER" })[role] || "ACADEMIX WORKSPACE";
    $("#dashboard-view").classList.remove("role-student", "role-teacher", "role-admin");
    $("#dashboard-view").classList.add(role === "admin" ? "role-admin" : role === "teacher" ? "role-teacher" : "role-student");
    if (view === "exams") loadExams();
    if (view === "grades") loadGrades();
    if (view === "developer") loadAdminUsers();
    if (view === "generator") { const sandbox = role === "admin"; $("#publish-quiz").classList.toggle("hidden", sandbox); $("#draft-mode-note").textContent = sandbox ? "SANDBOX MODE — generated drafts stay in this browser and are never published to real exam tables." : "AI output is a draft. Review every question, option, answer, and explanation before publishing."; }
  }
  function initials(name) { return (name || "A").trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
  function renderProfile() {
    const p = state.profile, u = state.user;
    document.body.classList.toggle("role-admin", p.role === "admin");
    document.body.classList.toggle("role-teacher", p.role === "teacher");
    document.body.classList.toggle("role-student", p.role === "student");
    $("#profile-name").textContent = p.full_name || u.email;
    $("#profile-role").textContent = p.role;
    $("#role-label").textContent = `${p.role.toUpperCase()} WORKSPACE`;
    $("#avatar").textContent = initials(p.full_name || u.email);
    $("#account-avatar").textContent = initials(p.full_name || u.email);
    $("#account-name").textContent = p.full_name || "AcademiX user";
    $("#account-email").textContent = u.email;
    $("#account-role").textContent = p.role;
    const emailVerified = Boolean(u.email_confirmed_at || u.confirmed_at);
    const emailStatus = $("#email-verification-status");
    if (emailStatus) {
      emailStatus.textContent = emailVerified ? "Email confirmed" : "Email not confirmed";
      emailStatus.className = `badge ${emailVerified ? "badge-success" : "badge-warning"}`;
    }
    $("#verification-status").textContent = p.verified_at ? "Institutionally approved" : "Pending admin approval";
    $("#verification-status").className = `badge ${p.verified_at ? "badge-success" : "badge-warning"}`;
    $(".teacher-only.nav-item").forEach(el => el.classList.toggle("hidden", p.role !== "teacher"));
    $$(".developer-only").forEach(el => el.classList.toggle("hidden", p.role !== "admin"));
    $$(".student-only").forEach(el => el.classList.toggle("hidden", p.role !== "student"));
    const examNavLabel = $("#exam-nav-label"); if (examNavLabel) examNavLabel.lastChild.textContent = " My Exams";
  }
  async function loadProfile() {
    const { data, error } = await state.supabase.from("profiles").select("id,full_name,role,bu_id,verified_at").eq("id", state.user.id).single();
    if (error) throw error;
    state.profile = data; renderProfile();
  }
  async function enterApp() {
    showOnly("#dashboard-view");
    await loadProfile();
    switchView(state.profile.role === "admin" ? "developer" : state.profile.role === "teacher" ? "teacher-home" : "student-home");
  }
  async function authSubmit(event) {
    event.preventDefault();
    const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
    try {
      if (state.authMode === "signin") {
        const { error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const name = $("#auth-name").value.trim(), buId = $("#auth-bu-id").value.trim();
        if (!name) return toast("Enter your full name.", "error");
        const emailRedirectTo = "https://kichiyz.github.io/buoc-academix/";
        const { error } = await state.supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { full_name: name, bu_id: buId } } });
        if (error) throw error;
        toast("Account created. Check your email if confirmation is enabled. Your role and verification must be approved by an administrator.", "success");
        setAuthMode("signin");
      }
    } catch (e) { toast(e.message || "Authentication failed.", "error"); }
  }
  async function loadExams() {
    const target = $("#exam-list"); target.innerHTML = '<div class="empty-state">Loading assessments…</div>';
    try {
      const { data, error } = await state.supabase.from("exams").select("id,title,duration_minutes,status,published_at,teacher_id").eq("status", "published").order("published_at", { ascending: false });
      if (error) throw error;
      // RLS limits students to assigned exams. Teachers only see their own via the policies.
      if (!data?.length) { target.innerHTML = '<div class="empty-state">No published assessments found for this account.</div>'; return; }
      target.innerHTML = "";
      for (const exam of data) {
        const { count } = await state.supabase.from("questions").select("*", { count: "exact", head: true }).eq("exam_id", exam.id);
        const card = document.createElement("article"); card.className = "exam-card";
        card.innerHTML = `<span class="badge">${state.profile.role === "teacher" ? "Published" : "Assigned exam"}</span><h3></h3><div class="exam-meta"><span>◷ ${exam.duration_minutes} min</span><span>▤ ${count ?? "—"} questions</span></div><button class="btn ${state.profile.role === "teacher" ? "btn-quiet" : "btn-primary"}">${state.profile.role === "teacher" ? "Exam ID: " + exam.id.slice(0, 8) : "Start exam →"}</button>`;
        card.querySelector("h3").textContent = exam.title;
        if (state.profile.role === "student") {
          card.querySelector("button").addEventListener("click", () => startExam(exam));
        } else {
          card.querySelector("button").textContent = "Authorize retake / remedial";
          card.querySelector("button").addEventListener("click", () => authorizeAttempt(exam));
        }
        target.append(card);
      }
    } catch (e) { target.innerHTML = '<div class="empty-state">Could not load exams. Check your connection and Supabase policies.</div>'; toast(e.message, "error"); }
  }
  async function generateQuiz(event) {
    event.preventDefault();
    const button = $("#generate-button"); button.disabled = true; button.textContent = "Generating…";
    try {
      const { data: sessionData } = await state.supabase.auth.getSession();
      const { data, error } = await state.supabase.functions.invoke("generate-quiz", {
        body: { title: $("#quiz-title").value.trim(), material: $("#quiz-material").value,
          count: Number($("#quiz-count").value), questionType: $("#quiz-type").value, difficulty: $("#quiz-difficulty").value }
      });
      if (error) throw error;
      if (!data?.questions) throw new Error(data?.error || "The generator returned no questions.");
      state.draft = data; renderDraft();
      toast("Draft generated. Review every answer before publishing.", "success");
    } catch (e) { toast(e.message || "Could not generate quiz.", "error"); }
    finally { button.disabled = false; button.innerHTML = "✦ Generate draft"; }
  }
  function renderDraft() {
    const panel = $("#draft-panel"), target = $("#draft-questions");
    target.innerHTML = ""; panel.classList.remove("hidden");
    state.draft.questions.forEach((q, i) => {
      const block = document.createElement("div"); block.className = "question-draft";
      const h = document.createElement("h3"); h.textContent = `${i + 1}. ${q.prompt}`; block.append(h);
      const opts = document.createElement("div"); opts.className = "draft-options";
      q.options.forEach(o => { const el = document.createElement("div"); el.className = `draft-option ${o === q.correct_answer ? "correct" : ""}`; el.textContent = `${o === q.correct_answer ? "✓ " : ""}${o}`; opts.append(el); });
      block.append(opts); const exp = document.createElement("p"); exp.className = "muted"; exp.textContent = `Answer: ${q.correct_answer}. ${q.explanation || ""}`; block.append(exp); target.append(block);
    });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function publishQuiz() {
    if (state.profile?.role === "admin") return toast("Developer sandbox cannot publish to live exam tables.", "error");
    if (!state.draft) return toast("Generate a draft first.", "error");
    try {
      const { data: exam, error } = await state.supabase.from("exams").insert({
        teacher_id: state.user.id, title: state.draft.title || $("#quiz-title").value.trim(),
        duration_minutes: Number($("#publish-duration").value), status: "draft"
      }).select("id").single();
      if (error) throw error;
      const rows = state.draft.questions.map(q => ({ exam_id: exam.id, position: q.position, question_type: q.question_type,
        prompt: q.prompt, options: q.options, correct_answer: q.correct_answer, explanation: q.explanation, points: q.points || 1 }));
      const { error: questionError } = await state.supabase.from("questions").insert(rows);
      if (questionError) { await state.supabase.from("exams").delete().eq("id", exam.id); throw questionError; }
      // Publishing is a privileged workflow in a production deployment; teacher policy permits own exam updates.
      const { error: publishError } = await state.supabase.from("exams").update({ status: "published", published_at: new Date().toISOString() }).eq("id", exam.id);
      if (publishError) throw publishError;
      state.draft = null; $("#draft-panel").classList.add("hidden"); toast("Exam published. Assign students from your course roster before use.", "success"); switchView("exams");
    } catch (e) { toast(e.message || "Could not publish exam.", "error"); }
  }
  async function startExam(exam) {
    if (state.profile?.role !== "student") return toast("Only student accounts can take assessments.", "error");
    if (!state.profile.verified_at) return toast("Your account is awaiting institutional verification.", "error");
    try {
      const { data: attempt, error: attemptError } = await state.supabase.rpc("start_exam_attempt", { p_exam_id: exam.id });
      if (attemptError) throw attemptError;
      const submissionId = attempt?.submission_id;
      if (!submissionId) throw new Error("The server did not create or return an exam attempt.");

      const { data: questions, error: qError } = await state.supabase.rpc("get_exam_questions", { p_exam_id: exam.id });
      if (qError) throw qError;
      if (!questions?.length) throw new Error("No questions are available for this exam.");

      // A resumed attempt keeps its original time limit instead of receiving a fresh timer.
      const { data: submission, error: submissionError } = await state.supabase
        .from("submissions").select("started_at,status").eq("id", submissionId).single();
      if (submissionError) throw submissionError;
      if (submission.status !== "in_progress") throw new Error("This attempt is no longer in progress.");

      state.currentExam = { ...exam, submissionId, attemptNumber: attempt.attempt_number, attemptType: attempt.attempt_type };
      state.currentQuestions = questions; state.answers = {}; state.questionIndex = 0;
      const durationSeconds = Math.max(0, Number(exam.duration_minutes) * 60);
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(submission.started_at).getTime()) / 1000));
      state.secondsLeft = Math.max(0, durationSeconds - elapsedSeconds);
      $("#taking-title").textContent = exam.title;
      showOnly("#exam-view"); renderQuestion();
      if (state.secondsLeft <= 0) {
        toast("The time limit has elapsed. Submitting this attempt.", "error");
        await submitExam(null, true);
      } else {
        startTimer();
      }
      if (attempt.attempt_number > 1) {
        toast(`Started authorized ${attempt.attemptType} attempt #${attempt.attempt_number}.`, "success");
      }
    } catch (e) { toast(e.message || "Could not start exam.", "error"); }
  }

  async function authorizeAttempt(exam) {
    try {
      const { data: assignments, error: assignmentError } = await state.supabase
        .from("exam_assignments").select("student_id").eq("exam_id", exam.id);
      if (assignmentError) throw assignmentError;
      const ids = [...new Set((assignments || []).map(row => row.student_id).filter(Boolean))];
      if (!ids.length) return toast("No assigned students were found for this exam.", "error");

      const { data: students, error: studentError } = await state.supabase
        .from("profiles").select("id,full_name,bu_id").in("id", ids);
      if (studentError) throw studentError;
      const eligibleStudents = (students || []).filter(student => student.id);
      if (!eligibleStudents.length) {
        return toast("Student details are not visible under the current Supabase policies.", "error");
      }

      const choices = eligibleStudents.map((student, index) =>
        `${index + 1}. ${student.full_name || "Unnamed student"}${student.bu_id ? ` (BU ID: ${student.bu_id})` : ""}`
      ).join("\n");
      const selection = prompt(`Choose an assigned student by number:\n\n${choices}\n\nEnter student number:`);
      if (selection === null || !selection.trim()) return;
      const studentIndex = Number(selection) - 1;
      if (!Number.isInteger(studentIndex) || studentIndex < 0 || studentIndex >= eligibleStudents.length) {
        return toast("Enter a valid student number from the list.", "error");
      }
      const student = eligibleStudents[studentIndex];

      const typeInput = prompt("Attempt type: retake or remedial", "retake");
      if (typeInput === null) return;
      const attemptType = typeInput.trim().toLowerCase();
      if (!["retake", "remedial"].includes(attemptType)) {
        return toast("Attempt type must be retake or remedial.", "error");
      }
      const reason = prompt("Reason for authorization (optional):") || "";
      const { data, error } = await state.supabase.rpc("authorize_exam_attempt", {
        p_exam_id: exam.id,
        p_student_id: student.id,
        p_attempt_type: attemptType,
        p_reason: reason
      });
      if (error) throw error;
      toast(`Authorized ${data.attempt_type} attempt #${data.attempt_number} for ${student.full_name || "student"}.`, "success");
    } catch (e) {
      toast(e.message || "Could not authorize attempt.", "error");
    }
  }
  function renderQuestion() {
    const q = state.currentQuestions[state.questionIndex], i = state.questionIndex, total = state.currentQuestions.length;
    $("#progress-label").textContent = `QUESTION ${i + 1} OF ${total}`;
    $("#progress-fill").style.width = `${((i + 1) / total) * 100}%`;
    $("#question-count-label").textContent = `${Object.keys(state.answers).length} answered`;
    $("#previous-question").disabled = i === 0;
    $("#next-question").classList.toggle("hidden", i === total - 1);
    $("#submit-exam").classList.toggle("hidden", i !== total - 1);
    const target = $("#question-container"); target.innerHTML = "";
    const num = document.createElement("p"); num.className = "question-number"; num.textContent = `QUESTION ${String(i + 1).padStart(2, "0")}`; target.append(num);
    const title = document.createElement("h2"); title.className = "question-title"; title.textContent = q.prompt; target.append(title);
    const list = document.createElement("div"); list.className = "answer-list";
    q.options.forEach((option, j) => {
      const label = document.createElement("label"); label.className = "answer-option";
      const input = document.createElement("input"); input.type = "radio"; input.name = `answer-${q.id}`; input.value = option; input.checked = state.answers[q.id] === option;
      input.addEventListener("change", () => { state.answers[q.id] = option; $("#question-count-label").textContent = `${Object.keys(state.answers).length} answered`; });
      const text = document.createElement("span"); text.textContent = option; label.append(input, text); list.append(label);
    });
    target.append(list);
  }
  function startTimer() {
    clearInterval(state.timerId); updateTimer();
    state.timerId = setInterval(() => { state.secondsLeft--; updateTimer(); if (state.secondsLeft <= 0) { clearInterval(state.timerId); toast("Time is up. Submitting your answers.", "error"); submitExam(null, true); } }, 1000);
  }
  function updateTimer() { const m = Math.max(0, Math.floor(state.secondsLeft / 60)), s = Math.max(0, state.secondsLeft % 60); $("#exam-timer").textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`; }
  async function submitExam(event, timedOut = false) {
    if (event) event.preventDefault();
    if (!timedOut && !confirm("Submit this exam now? You cannot change answers after submission.")) return;
    clearInterval(state.timerId);
    try {
      // Answers are graded by the trusted server-side RPC; the browser never receives the answer key.
      const { data: result, error } = await state.supabase.rpc("submit_exam", {
        p_submission_id: state.currentExam.submissionId,
        p_answers: state.answers
      });
      if (error) throw error;
      showOnly("#dashboard-view");
      const scoreMessage = result && result.score != null && result.max_score != null
        ? `Exam submitted and graded: ${result.score} / ${result.max_score}.`
        : "Exam submitted successfully.";
      toast(scoreMessage, "success");
      switchView("grades");
    } catch (e) {
      toast(`Submission failed: ${e.message}. Your attempt may remain in progress; retry submission when ready.`, "error");
      if (state.secondsLeft > 0) startTimer();
      else updateTimer();
    }
  }
  async function loadGrades() {
    const target = $("#grades-list"); target.innerHTML = '<div class="empty-state">Loading grades…</div>';
    try {
      const { data, error } = await state.supabase.from("grades").select("id,score,max_score,feedback,created_at,exams(title)").order("created_at", { ascending: false });
      if (error) throw error;
      if (!data?.length) { target.innerHTML = '<div class="empty-state">No graded submissions yet.</div>'; return; }
      target.innerHTML = "";
      data.forEach(g => {
        const row = document.createElement("div"); row.className = "grade-row";
        const name = document.createElement("div"); const b = document.createElement("b"); b.textContent = g.exams?.title || "Assessment"; const small = document.createElement("small"); small.textContent = new Date(g.created_at).toLocaleString(); name.append(b, small);
        const score = document.createElement("div"); score.className = "score"; score.textContent = `${g.score} / ${g.max_score}`;
        const feedback = document.createElement("div"); feedback.className = "grade-status muted"; feedback.textContent = g.feedback || "Graded";
        row.append(name, score, feedback); target.append(row);
      });
    } catch (e) { target.innerHTML = '<div class="empty-state">Could not load grades. Check your Supabase policies.</div>'; toast(e.message, "error"); }
  }
  async function exportGrades() {
    try {
      const { data, error } = await state.supabase.from("grades").select("student_id,exam_id,score,max_score,feedback,created_at,exams(title),profiles!grades_student_id_fkey(full_name,bu_id)").order("created_at", { ascending: false });
      if (error) throw error;
      const cols = ["student_id","student_name","bu_id","exam_title","score","max_score","feedback","graded_at"];
      const esc = v => `"${String(v ?? "").replaceAll('"','""')}"`;
      const lines = [cols.join(","), ...(data || []).map(g => [g.student_id,g.profiles?.full_name,g.profiles?.bu_id,g.exams?.title,g.score,g.max_score,g.feedback,g.created_at].map(esc).join(","))];
      const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `academix-grades-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast(e.message || "Could not export grades.", "error"); }
  }

  async function adminControl(action, payload = {}) {
    if (state.profile?.role !== "admin") throw new Error("Developer access required.");
    const { data, error } = await state.supabase.functions.invoke("admin-control", { body: { action, ...payload } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }
  let adminUsersLoadSequence = 0;
  async function loadAdminUsers() {
    const loadSequence = ++adminUsersLoadSequence;
    const status = $("#admin-users-status"), list = $("#admin-users-list");
    if (!status || !list) return;
    status.textContent = "Loading accounts…"; list.innerHTML = "";
    try {
      const result = await adminControl("list_users", { query: $("#admin-user-search")?.value.trim() || "" });
      if (loadSequence !== adminUsersLoadSequence) return;
      // Normalize the API response by stable account ID before any DOM rendering.
      // Auth user IDs are the primary identity; normalized email is a secondary
      // guard against repeated directory rows for the same account.
      const uniqueUsers = new Map();
      const seenEmails = new Set();
      for (const user of (Array.isArray(result.users) ? result.users : [])) {
        if (!user?.id) continue;
        const emailKey = String(user.email || "").trim().toLowerCase();
        if (uniqueUsers.has(user.id) || (emailKey && seenEmails.has(emailKey))) continue;
        uniqueUsers.set(user.id, user);
        if (emailKey) seenEmails.add(emailKey);
      }
      state.adminUsers = [...uniqueUsers.values()];
      const fragment = document.createDocumentFragment();
      status.textContent = state.adminUsers.length ? `${state.adminUsers.length} account(s) found` : "No accounts matched your search.";
      state.adminUsers.forEach(user => {
        const card = document.createElement("article"); card.className = "admin-user-card";
        const identity = document.createElement("div"); identity.className = "admin-user-identity";
        const name = document.createElement("strong"); name.textContent = user.full_name || user.email || user.id;
        const email = document.createElement("small"); email.textContent = user.email || "No email";
        const meta = document.createElement("small"); meta.textContent = `${user.role || "student"} • ${user.verified_at ? "Verified" : "Unverified"} • ${user.suspended ? "Suspended" : "Active"}`;
        identity.append(name,email,meta);
        const controls = document.createElement("div"); controls.className = "admin-user-controls";
        const role = document.createElement("select"); role.setAttribute("aria-label", "Role for " + (user.email || user.id));
        ["student","teacher","admin"].forEach(value => { const option=document.createElement("option"); option.value=value; option.textContent=value; option.selected=value===(user.role||"student"); role.append(option); });
        const save = document.createElement("button"); save.className="btn btn-quiet"; save.textContent="Save role"; save.addEventListener("click", async()=>{ if(!confirm(`Change ${user.email}'s role to ${role.value}?`)) return; try { await adminControl("set_role",{user_id:user.id,role:role.value}); toast("Role updated.","success"); await loadAdminUsers(); } catch(e){toast(e.message,"error");} });
        const verify = document.createElement("button"); verify.className="btn btn-quiet"; verify.textContent=user.verified_at?"Revoke verification":"Verify"; verify.addEventListener("click",async()=>{ try { await adminControl("set_verified",{user_id:user.id,verified:!user.verified_at}); toast("Verification status updated.","success"); await loadAdminUsers(); } catch(e){toast(e.message,"error");} });
        const suspend = document.createElement("button"); suspend.className="btn btn-quiet"; suspend.textContent=user.suspended?"Reactivate":"Suspend"; suspend.disabled=user.id===state.user.id; suspend.addEventListener("click",async()=>{ const action=user.suspended?"reactivate":"suspend"; if(!confirm(`${action==="suspend"?"Suspend":"Reactivate"} ${user.email}?`))return; try { await adminControl(action,{user_id:user.id}); toast(action==="suspend"?"Account suspended.":"Account reactivated.","success"); await loadAdminUsers(); }catch(e){toast(e.message,"error");} });
        const del = document.createElement("button"); del.className="btn btn-danger"; del.textContent="Delete"; del.disabled=user.id===state.user.id; del.addEventListener("click",async()=>{ if(prompt(`Permanently delete ${user.email}? Type DELETE to confirm.`)!=="DELETE")return; try { await adminControl("delete_user",{user_id:user.id}); toast("Account deleted.","success"); await loadAdminUsers(); }catch(e){ const originalError=e.message || "The delete function returned an error."; try { const check=await adminControl("list_users",{query:""}); const stillExists=(check.users||[]).some(account=>account.id===user.id); if(!stillExists){ toast("The account is no longer listed. Deletion appears to have succeeded, but the admin function returned an error; its cleanup/audit step may have failed.","success"); await loadAdminUsers(); return; } }catch(checkError){} toast(`Delete operation reported an error: ${originalError}`, "error"); await loadAdminUsers(); } });
        controls.append(role,save,verify,suspend,del); card.append(identity,controls); fragment.append(card);
      });
      if (loadSequence !== adminUsersLoadSequence) return;
      list.replaceChildren(fragment);
      const audit = await adminControl("list_audit");
      if (loadSequence !== adminUsersLoadSequence) return;
      const auditList=$("#admin-audit-list"); auditList.replaceChildren();
      if(!audit.logs?.length) auditList.innerHTML='<div class="empty-state">No administrative actions recorded yet.</div>';
      (audit.logs||[]).forEach(log=>{const row=document.createElement("div");row.className="admin-audit-row";const label=document.createElement("strong");label.textContent=log.action;const detail=document.createElement("span");detail.textContent=`${log.target_email||log.target_user_id||"Platform"} • ${new Date(log.created_at).toLocaleString()}`;row.append(label,detail);auditList.append(row);});
    } catch (e) { if (loadSequence !== adminUsersLoadSequence) return; status.textContent = "Could not load accounts."; list.replaceChildren(); toast(e.message || "Admin controls are unavailable. Deploy admin-control and configure its secrets.", "error"); }
  }

  async function signOut() { await state.supabase.auth.signOut(); state.user = state.profile = null; showOnly("#auth-view"); }
  async function init() {
    // Protect against accidental duplicate script execution or repeated DOM-ready handlers.
    if (window.__academixInitStarted) return;
    window.__academixInitStarted = true;
    if (!configured || !window.supabase) {
      showOnly("#auth-view"); toast("Setup required: add your Supabase project URL and publishable/anon key in app.js.", "error"); return;
    }
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    $$("[data-auth-tab]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.authTab)));
    $("#auth-form").addEventListener("submit", authSubmit);
    $("#forgot-password").addEventListener("click", async () => {
      const email = $("#auth-email").value.trim(); if (!email) return toast("Enter your email address first.", "error");
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      toast(error ? error.message : "If the account exists, a password reset email will be sent.", error ? "error" : "success");
    });
    $$(".nav-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
    $$("[data-go]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.go)));
    $$("[data-action=\"planned\"]").forEach(b => b.addEventListener("click", () => toast(b.dataset.feature + " is planned but not implemented yet.", "error")));
    $("#signout").addEventListener("click", signOut);
    $("#refresh-exams").addEventListener("click", loadExams);
    $("#refresh-admin-users")?.addEventListener("click", loadAdminUsers);
    $("#search-admin-users")?.addEventListener("click", loadAdminUsers);
    $("#generator-form").addEventListener("submit", generateQuiz);
    $("#publish-quiz").addEventListener("click", publishQuiz);
    $("#export-grades").addEventListener("click", exportGrades);
    $("#previous-question").addEventListener("click", () => { if (state.questionIndex > 0) { state.questionIndex--; renderQuestion(); } });
    $("#next-question").addEventListener("click", () => { if (state.questionIndex < state.currentQuestions.length - 1) { state.questionIndex++; renderQuestion(); } });
    $("#exam-form").addEventListener("submit", e => submitExam(e));
    $("#exit-exam").addEventListener("click", () => { if (confirm("Leave this attempt? Your answers may not be submitted.")) { clearInterval(state.timerId); showOnly("#dashboard-view"); switchView("exams"); } });
    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) { state.user = session.user; try { await enterApp(); } catch (e) { toast(e.message || "Could not load your profile.", "error"); } }
      else { state.user = state.profile = null; showOnly("#auth-view"); }
    });
    const { data: { session } } = await state.supabase.auth.getSession();
    if (session?.user) { state.user = session.user; try { await enterApp(); } catch (e) { toast(e.message, "error"); } }
  }
  document.addEventListener("DOMContentLoaded", init);
})(); 
