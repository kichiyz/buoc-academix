/* BUOC AcademiX client. Configure the two public Supabase values below.
   The anon/publishable key is designed for browsers; NEVER place service_role or LLM keys here. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://otkgtwwxmmdmiavmpyqo.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_A-o7buSKUahNZceiaJBgCw_cvzeW-Rg";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = { supabase: null, user: null, profile: null, authMode: "signin", view: "exams",
    draft: null, currentExam: null, currentQuestions: [], answers: {}, questionIndex: 0, timerId: null, secondsLeft: 0 };
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
    if (view === "developer" && state.profile?.role !== "admin") return toast("Developer access is required.", "error");
    if (view === "generator" && !["teacher", "admin"].includes(state.profile?.role)) return toast("Teacher access is required.", "error");
    state.view = view;
    $$(".page-view").forEach(el => el.classList.toggle("hidden", el.id !== `view-${view}`));
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    $("#page-heading").textContent = ({ developer: "Developer Center", exams: state.profile?.role === "admin" ? "Exam Library" : "My Exams", generator: "Generate Quiz", grades: "Grades", account: "Account" })[view] || "AcademiX";
    if (view === "exams") loadExams();
    if (view === "grades") loadGrades();
  }
  function initials(name) { return (name || "A").trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
  function renderProfile() {
    const p = state.profile, u = state.user;
    $("#profile-name").textContent = p.full_name || u.email;
    $("#profile-role").textContent = p.role;
    $("#role-label").textContent = `${p.role.toUpperCase()} WORKSPACE`;
    $("#avatar").textContent = initials(p.full_name || u.email);
    $("#account-avatar").textContent = initials(p.full_name || u.email);
    $("#account-name").textContent = p.full_name || "AcademiX user";
    $("#account-email").textContent = u.email;
    $("#account-role").textContent = p.role;
    $("#verification-status").textContent = p.verified_at ? "Verified" : "Pending verification";
    $("#verification-status").className = `badge ${p.verified_at ? "badge-success" : "badge-warning"}`;
    $(".teacher-only").forEach(el => el.classList.toggle("hidden", !["teacher", "admin"].includes(p.role)));
    $(".developer-only").forEach(el => el.classList.toggle("hidden", p.role !== "admin"));
    const examNavLabel = $("#exam-nav-label"); if (examNavLabel) examNavLabel.lastChild.textContent = p.role === "admin" ? " Exam Library" : " My Exams";
  }
  async function loadProfile() {
    const { data, error } = await state.supabase.from("profiles").select("id,full_name,role,bu_id,verified_at").eq("id", state.user.id).single();
    if (error) throw error;
    state.profile = data; renderProfile();
  }
  async function enterApp() {
    showOnly("#dashboard-view");
    await loadProfile();
    switchView(state.profile.role === "admin" ? "developer" : "exams");
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
        const { error } = await state.supabase.auth.signUp({ email, password, options: { data: { full_name: name, bu_id: buId } } });
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
        if (state.profile.role !== "teacher") card.querySelector("button").addEventListener("click", () => startExam(exam));
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
    if (!state.profile.verified_at) return toast("Your account is awaiting institutional verification.", "error");
    try {
      const { data: existing, error: existingError } = await state.supabase.from("submissions").select("id,status").eq("exam_id", exam.id).eq("student_id", state.user.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.status === "submitted" || existing?.status === "graded") return toast("You have already submitted this exam.", "error");
      let submissionId = existing?.id;
      if (!submissionId) {
        const { data: created, error } = await state.supabase.from("submissions").insert({ exam_id: exam.id, student_id: state.user.id }).select("id").single();
        if (error) throw error; submissionId = created.id;
      }
      const { data: questions, error: qError } = await state.supabase.rpc("get_exam_questions", { p_exam_id: exam.id });
      if (qError) throw qError;
      if (!questions?.length) throw new Error("No questions are available for this exam.");
      state.currentExam = { ...exam, submissionId }; state.currentQuestions = questions; state.answers = {}; state.questionIndex = 0;
      state.secondsLeft = Number(exam.duration_minutes) * 60; $("#taking-title").textContent = exam.title;
      showOnly("#exam-view"); renderQuestion(); startTimer();
    } catch (e) { toast(e.message || "Could not start exam.", "error"); }
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
      // Production must replace this direct client write with a trusted submit_exam RPC
      // that grades server-side. This placeholder intentionally does not send correct answers.
      const { error } = await state.supabase.rpc("submit_exam", {
        p_submission_id: state.currentExam.submissionId,
        p_answers: state.answers
      });
      if (error) throw error;
      showOnly("#dashboard-view"); toast("Exam submitted successfully.", "success"); switchView("grades");
    } catch (e) { toast(`Submission failed: ${e.message}. Your attempt may remain in progress; do not close this page.`, "error"); startTimer(); }
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
  async function signOut() { await state.supabase.auth.signOut(); state.user = state.profile = null; showOnly("#auth-view"); }
  async function init() {
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
    $("#signout").addEventListener("click", signOut);
    $("#refresh-exams").addEventListener("click", loadExams);
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
