/* BUOC AcademiX client. Public Supabase configuration is loaded from academix-config.js.
   Only publishable/anon keys belong in browser code; NEVER place service_role or LLM keys here. */
(() => {
  "use strict";
  const APP_CONFIG = window.ACADEMIX_CONFIG || {};
  const SUPABASE_URL = String(APP_CONFIG.supabaseUrl || "").trim();
  const SUPABASE_ANON_KEY = String(APP_CONFIG.supabasePublishableKey || "").trim();
  const APP_ENVIRONMENT = String(APP_CONFIG.environment || "UNCONFIGURED").trim().toUpperCase();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = { supabase: null, user: null, profile: null, authMode: "signin", view: "exams",
    draft: null, adminUsers: [], teacherRequest: null, currentExam: null, currentQuestions: [], answers: {}, questionIndex: 0, timerId: null, secondsLeft: 0 };
  const configured = /^https:\/\/[^\s]+\.supabase\.co$/.test(SUPABASE_URL) && /^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)$/.test(SUPABASE_ANON_KEY);
  // Phase 4 safety boundary: prevent TEST mode from connecting to production.
  // This guard supplements, but cannot replace, a separately provisioned test project.
  const PRODUCTION_SUPABASE_URL = "https://otkgtwwxmmdmiavmpyqo.supabase.co";
  const normalizedSupabaseUrl = SUPABASE_URL.replace(/\/+$/, "").toLowerCase();
  const environmentConfigSafe = ["TEST", "PRODUCTION"].includes(APP_ENVIRONMENT) &&
    !(APP_ENVIRONMENT === "TEST" && normalizedSupabaseUrl === PRODUCTION_SUPABASE_URL);


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
    if (view === "developer") { loadAdminUsers(); loadExamRegistry(); loadResultsInspector(); }
    if (view === "generator") { const sandbox = role === "admin"; $("#publish-quiz").classList.toggle("hidden", sandbox); $("#draft-mode-note").textContent = sandbox ? "SANDBOX MODE — generated drafts stay in this browser and are never published to real exam tables." : "AI output is a draft. Review every question, option, answer, and explanation before publishing."; }
  }
  function initials(name) { return (name || "A").trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
  function renderProfile() {
    const p = state.profile, u = state.user;
    const environmentBadge = $("#environment-badge");
    if (environmentBadge) { environmentBadge.textContent = `ENVIRONMENT: ${APP_ENVIRONMENT}`; environmentBadge.dataset.environment = APP_ENVIRONMENT; }
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
    $$(".teacher-only.nav-item").forEach(el => el.classList.toggle("hidden", p.role !== "teacher"));
    $$(".developer-only").forEach(el => el.classList.toggle("hidden", p.role !== "admin"));
    $$(".student-only").forEach(el => el.classList.toggle("hidden", p.role !== "student"));
    const examNavLabel = $("#exam-nav-label"); if (examNavLabel) examNavLabel.lastChild.textContent = " My Exams";
    renderTeacherRequest();
  }
  async function loadProfile() {
    const { data, error } = await state.supabase.from("profiles").select("id,full_name,role,bu_id,verified_at").eq("id", state.user.id).single();
    if (error) throw error;
    state.profile = data;
    await loadTeacherRequest();
    renderProfile();
  }

  async function loadTeacherRequest() {
    state.teacherRequest = null;
    if (!state.user || !state.supabase) return;
    const { data, error } = await state.supabase.from("teacher_access_requests").select("status,requested_at,reviewed_at,review_note").eq("user_id", state.user.id).maybeSingle();
    if (error) { console.warn("Teacher request status unavailable:", error.message); return; }
    state.teacherRequest = data || null;
  }
  function renderTeacherRequest() {
    const panel=$("#teacher-request-panel"), title=$("#teacher-request-title"), message=$("#teacher-request-message"), button=$("#teacher-request-button");
    if(!panel||!title||!message||!button)return;
    const request=state.teacherRequest;
    panel.classList.toggle("hidden",state.profile?.role!=="student");
    button.classList.add("hidden");
    if(state.profile?.role!=="student")return;
    if(request?.status==="pending"){title.textContent="Teacher access pending";message.textContent="An administrator must review your request. You remain a Student until approved.";}
    else if(request?.status==="rejected"){title.textContent="Teacher access request not approved";message.textContent=(request.review_note?request.review_note+" ":"")+"You remain a Student. You may submit a new request when ready.";button.textContent="Reapply for Teacher access";button.classList.remove("hidden");}
    else {title.textContent="Request Teacher access";message.textContent="Teacher access requires administrator approval. Your account remains a Student while your request is reviewed.";button.textContent="Request Teacher access";button.classList.remove("hidden");}
  }
  async function submitTeacherRequest() {
    const button=$("#teacher-request-button");button.disabled=true;
    try {const {error}=await state.supabase.rpc("request_teacher_access");if(error)throw error;await loadTeacherRequest();renderTeacherRequest();toast("Teacher access request submitted for administrator review.","success");}
    catch(error){toast(error.message||"Could not submit the Teacher access request. Ensure the Supabase migration has been applied.","error");}
    finally{button.disabled=false;}
  }

  async function enterApp() {
    // Auth INITIAL_SESSION and getSession can resolve together. Do not let the
    // duplicate initialization reset whichever tab the user has already opened.
    if (state.profile?.id === state.user?.id) return;
    if (state.enteringUserId === state.user?.id) return;
    const enteringUserId = state.user?.id;
    state.enteringUserId = enteringUserId;
    try {
      showOnly("#dashboard-view");
      await loadProfile();
      if (state.user?.id !== enteringUserId) return;
      switchView(state.profile.role === "admin" ? "developer" : state.profile.role === "teacher" ? "teacher-home" : "student-home");
    } finally {
      if (state.enteringUserId === enteringUserId) state.enteringUserId = null;
    }
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
        const requestedRole = $("#auth-role").value === "teacher" ? "teacher" : "student";
        const { error } = await state.supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { full_name: name, bu_id: buId, requested_role: requestedRole } } });
        if (error) throw error;
        toast(requestedRole === "teacher" ? "Account created. Your Teacher access request is pending administrator approval. Check your email if confirmation is enabled." : "Account created. Check your email if confirmation is enabled.", "success");
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
          const actions = document.createElement("div");
          actions.className = "exam-card-actions";
          const assign = document.createElement("button");
          assign.className = "btn btn-primary";
          assign.textContent = "Manage assigned students";
          assign.addEventListener("click", () => manageAssignments(exam));
          const attempts = document.createElement("button");
          attempts.className = "btn btn-quiet";
          attempts.textContent = "Authorize retake / remedial";
          attempts.addEventListener("click", () => authorizeAttempt(exam));
          actions.append(assign, attempts);
          card.querySelector("button").replaceWith(actions);
        }
        target.append(card);
      }
    } catch (e) { target.innerHTML = '<div class="empty-state">Could not load exams. Check your connection and Supabase policies.</div>'; toast(e.message, "error"); }
  }
  async function generateQuiz(event) {
    event.preventDefault();
    const button = $("#generate-button");
    const startedAt = performance.now();
    const stages = ["Analyzing study material…", "Generating questions with AI…", "Validating answers…"];
    let stageIndex = 0;
    button.disabled = true;
    button.textContent = stages[stageIndex];
    const stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      button.textContent = stages[stageIndex];
    }, 8000);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Quiz generation timed out after 60 seconds. Please try again with shorter study material.")), 60000));
    try {
      const request = (async () => {
        const { error: sessionError } = await state.supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const { data, error } = await state.supabase.functions.invoke("generate-quiz", {
          body: { title: $("#quiz-title").value.trim(), material: $("#quiz-material").value.slice(0, 30000),
            count: Number($("#quiz-count").value), questionType: $("#quiz-type").value, difficulty: $("#quiz-difficulty").value }
        });
        if (error) {
          // Supabase FunctionsHttpError carries the Edge Function Response in
          // error.context. Read its JSON body so the UI shows the real cause
          // (missing API key, quota, invalid model, rejected input, etc.).
          let detail = "";
          try {
            const response = error.context;
            if (response && typeof response.json === "function") {
              const body = await response.json();
              detail = typeof body?.error === "string" ? body.error : "";
            }
          } catch (_) {}
          throw new Error(detail || error.message || "Quiz generation failed. Check the generate-quiz function logs.");
        }
        if (!data?.questions) throw new Error(data?.error || "The generator returned no questions.");
        return data;
      })();
      const data = await Promise.race([request, timeout]);
      state.draft = data; renderDraft();
      // Clear the submitted prompt/material after successful generation so stale
      // inputs do not remain in the generator form.
      $("#quiz-title").value = "";
      $("#quiz-material").value = "";
      console.info("[AcademiX] Quiz generation completed in", Math.round(performance.now() - startedAt), "ms");
      toast("Draft generated. Review every answer before publishing.", "success");
    } catch (e) {
      console.error("[AcademiX] Quiz generation failed after", Math.round(performance.now() - startedAt), "ms", e);
      toast(e.message || "Could not generate quiz.", "error");
    } finally {
      clearInterval(stageTimer);
      button.disabled = false;
      button.innerHTML = "✦ Generate draft";
    }
  }
  function renderDraft() {
    const panel=$("#draft-panel"), target=$("#draft-questions");
    target.replaceChildren();panel.classList.remove("hidden");
    if(!state.draft?.questions?.length){target.innerHTML='<div class="empty-state">No questions in this draft. Generate a new draft to continue.</div>';panel.scrollIntoView({behavior:"smooth",block:"start"});return;}
    const questions=state.draft.questions;
    questions.forEach((q,i)=>{
      const block=document.createElement("article");block.className="question-draft phase-three-question";
      const heading=document.createElement("div");heading.className="phase-three-question-heading";
      const h=document.createElement("h3");h.textContent=`Question ${i+1}`;
      const remove=document.createElement("button");remove.type="button";remove.className="btn btn-quiet";remove.textContent="Remove";
      remove.addEventListener("click",()=>{if(!confirm(`Remove question ${i+1} from this draft?`))return;state.draft.questions.splice(i,1);state.draft.questions.forEach((item,index)=>item.position=index+1);renderDraft();});
      heading.append(h,remove);block.append(heading);
      const promptLabel=document.createElement("label");promptLabel.textContent="Question prompt";
      const prompt=document.createElement("textarea");prompt.rows=3;prompt.maxLength=3000;prompt.required=true;prompt.value=q.prompt||"";
      prompt.addEventListener("input",()=>{q.prompt=prompt.value;});promptLabel.append(prompt);block.append(promptLabel);
      const optionsLabel=document.createElement("label");optionsLabel.textContent="Answer options (one per line)";
      const options=document.createElement("textarea");options.rows=Math.max(3,Math.min(6,(q.options||[]).length));options.maxLength=6000;options.required=true;options.value=(q.options||[]).join("\n");
      options.addEventListener("input",()=>{q.options=options.value.split("\n").map(v=>v.trim()).filter(Boolean);renderAnswerSelect(answer,q);});optionsLabel.append(options);block.append(optionsLabel);
      const answerLabel=document.createElement("label");answerLabel.textContent="Correct answer";
      const answer=document.createElement("select");answer.required=true;answerLabel.append(answer);block.append(answerLabel);
      const renderAnswerSelect=(select,question)=>{const previous=question.correct_answer;select.replaceChildren();(question.options||[]).forEach(option=>{const opt=document.createElement("option");opt.value=option;opt.textContent=option;select.append(opt);});if((question.options||[]).includes(previous))select.value=previous;else {select.selectedIndex=0;question.correct_answer=select.value||"";}};
      renderAnswerSelect(answer,q);answer.addEventListener("change",()=>{q.correct_answer=answer.value;});
      const explanationLabel=document.createElement("label");explanationLabel.textContent="Explanation (optional)";
      const explanation=document.createElement("textarea");explanation.rows=2;explanation.maxLength=3000;explanation.value=q.explanation||"";explanation.addEventListener("input",()=>{q.explanation=explanation.value;});explanationLabel.append(explanation);block.append(explanationLabel);
      const pointsLabel=document.createElement("label");pointsLabel.textContent="Points";
      const points=document.createElement("input");points.type="number";points.min="1";points.max="100";points.step="1";points.required=true;points.value=Number(q.points)||1;points.addEventListener("input",()=>{q.points=Number(points.value);});pointsLabel.append(points);block.append(pointsLabel);
      target.append(block);
    });
    const summary=document.createElement("p");summary.className="muted phase-three-summary";summary.textContent=`${questions.length} question(s) • Changes apply to this draft only until published.`;target.prepend(summary);
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function publishQuiz() {
    if (!state.draft?.questions?.length) return toast("Add at least one question before publishing.", "error");
    for (let i=0;i<state.draft.questions.length;i++) {
      const q=state.draft.questions[i];
      q.position=i+1;
      q.prompt=String(q.prompt||"").trim();
      q.options=Array.isArray(q.options)?q.options.map(v=>String(v).trim()).filter(Boolean):[];
      q.correct_answer=String(q.correct_answer||"").trim();
      q.points=Number(q.points)||1;
      if(!q.prompt)return toast(`Question ${i+1} needs a prompt.`,"error");
      if(q.options.length<2)return toast(`Question ${i+1} needs at least two answer options.`,"error");
      if(new Set(q.options).size!==q.options.length)return toast(`Question ${i+1} has duplicate options.`,"error");
      if(!q.options.includes(q.correct_answer))return toast(`Choose a valid correct answer for question ${i+1}.`,"error");
      if(!Number.isInteger(q.points)||q.points<1||q.points>100)return toast(`Question ${i+1} must have 1–100 points.`,"error");
    }
    const duration=Number($("#publish-duration").value);
    if(!Number.isInteger(duration)||duration<1||duration>300)return toast("Exam duration must be between 1 and 300 whole minutes.","error");

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
      // Load questions before creating a new attempt. Otherwise question-fetch latency is
      // deducted from the student's allotted time before the timer is even visible.
      const { data: questions, error: qError } = await state.supabase.rpc("get_exam_questions", { p_exam_id: exam.id });
      if (qError) throw qError;
      if (!questions?.length) throw new Error("No questions are available for this exam.");

      const { data: attempt, error: attemptError } = await state.supabase.rpc("start_exam_attempt", { p_exam_id: exam.id });
      if (attemptError) throw attemptError;
      const submissionId = attempt?.submission_id;
      if (!submissionId) throw new Error("The server did not create or return an exam attempt.");

      // Read the server timestamp immediately. Existing attempts retain their original deadline.
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

  let workflowReturnFocus = null;
  function openWorkflowModal(title, description) {
    const modal = $("#workflow-modal");
    workflowReturnFocus = document.activeElement;
    $("#workflow-modal-title").textContent = title;
    $("#workflow-modal-description").textContent = description || "";
    $("#workflow-modal-body").replaceChildren();
    $("#workflow-modal-footer").replaceChildren();
    modal.classList.remove("hidden");
    document.body.classList.add("workflow-modal-open");
    $("#workflow-modal-close").focus();
    return { body: $("#workflow-modal-body"), footer: $("#workflow-modal-footer") };
  }
  function closeWorkflowModal() {
    const modal = $("#workflow-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    document.body.classList.remove("workflow-modal-open");
    if (workflowReturnFocus && typeof workflowReturnFocus.focus === "function") workflowReturnFocus.focus();
    workflowReturnFocus = null;
  }
  function workflowButton(label, variant, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn " + variant;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  async function manageAssignments(exam) {
    if (!["teacher", "admin"].includes(state.profile?.role)) {
      return toast("Teacher access is required to manage assignments.", "error");
    }
    const { body, footer } = openWorkflowModal(
      "Manage assigned students",
      "Choose the verified student accounts that can access “" + exam.title + "”. Save to apply your changes."
    );
    body.innerHTML = '<div class="empty-state">Loading verified student accounts…</div>';
    footer.append(workflowButton("Close", "btn-quiet", closeWorkflowModal));
    try {
      const [{ data: studentsData, error: studentsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
        state.supabase.from("profiles").select("id,full_name,bu_id,verified_at").eq("role", "student").not("verified_at", "is", null).order("full_name"),
        state.supabase.from("exam_assignments").select("student_id").eq("exam_id", exam.id)
      ]);
      if (studentsError) throw studentsError;
      if (assignmentsError) throw assignmentsError;
      const students = studentsData || [];
      const assignedIds = new Set((assignments || []).map(row => row.student_id));
      const selectedIds = new Set(assignedIds);
      body.replaceChildren();
      footer.replaceChildren();
      if (!students.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No institutionally verified student accounts are available to assign.";
        body.append(empty);
        footer.append(workflowButton("Close", "btn-quiet", closeWorkflowModal));
        return;
      }

      const toolbar = document.createElement("div");
      toolbar.className = "workflow-assignment-toolbar";
      const searchLabel = document.createElement("label");
      searchLabel.className = "workflow-search-label";
      searchLabel.textContent = "Find a student";
      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = "Search name or BU ID…";
      search.maxLength = 120;
      search.setAttribute("aria-label", "Search verified students by name or BU ID");
      searchLabel.append(search);
      const selectVisible = workflowButton("Select visible", "btn-quiet", () => {
        students.forEach(student => {
          const row = rows.get(student.id);
          if (row && !row.hidden) selectedIds.add(student.id);
        });
        syncRows();
      });
      const clearSelection = workflowButton("Clear selection", "btn-quiet", () => {
        selectedIds.clear();
        syncRows();
      });
      toolbar.append(searchLabel, selectVisible, clearSelection);
      const summary = document.createElement("p");
      summary.className = "workflow-selection-summary";
      const list = document.createElement("div");
      list.className = "workflow-student-list";
      list.setAttribute("aria-label", "Verified student accounts");
      const rows = new Map();

      function syncRows() {
        rows.forEach((row, id) => {
          const checkbox = row.querySelector("input[type=checkbox]");
          checkbox.checked = selectedIds.has(id);
        });
        summary.textContent = selectedIds.size + " student(s) selected";
      }

      students.forEach(student => {
        const row = document.createElement("label");
        row.className = "workflow-student-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedIds.has(student.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedIds.add(student.id);
          else selectedIds.delete(student.id);
          summary.textContent = selectedIds.size + " student(s) selected";
        });
        const identity = document.createElement("span");
        identity.className = "workflow-student-identity";
        const name = document.createElement("strong");
        name.textContent = student.full_name || "Unnamed student";
        const meta = document.createElement("small");
        meta.textContent = (student.bu_id ? "BU ID: " + student.bu_id : "No BU ID on file") +
          (assignedIds.has(student.id) ? " • Currently assigned" : " • Not assigned");
        identity.append(name, meta);
        row.append(checkbox, identity);
        row.dataset.searchText = [student.full_name, student.bu_id].filter(Boolean).join(" ").toLowerCase();
        rows.set(student.id, row);
        list.append(row);
      });
      search.addEventListener("input", () => {
        const query = search.value.trim().toLowerCase();
        rows.forEach(row => { row.hidden = !row.dataset.searchText.includes(query); });
      });
      syncRows();
      body.append(toolbar, summary, list);
      footer.append(
        workflowButton("Cancel", "btn-quiet", closeWorkflowModal),
        workflowButton("Save assignments", "btn-primary", async event => {
          const saveButton = footer.querySelector(".btn-primary");
          saveButton.disabled = true;
          saveButton.textContent = "Saving…";
          try {
            const toAdd = students.filter(student => selectedIds.has(student.id) && !assignedIds.has(student.id));
            const toRemove = [...assignedIds].filter(id => !selectedIds.has(id));
            if (!toAdd.length && !toRemove.length) {
              closeWorkflowModal();
              return toast("Assignments are already up to date.", "success");
            }
            if (toAdd.length) {
              const { error } = await state.supabase.from("exam_assignments").insert(
                toAdd.map(student => ({ exam_id: exam.id, student_id: student.id }))
              );
              if (error) throw error;
            }
            for (const studentId of toRemove) {
              const { error } = await state.supabase.from("exam_assignments").delete()
                .eq("exam_id", exam.id).eq("student_id", studentId);
              if (error) throw error;
            }
            closeWorkflowModal();
            toast("Assignments saved for " + selectedIds.size + " student(s).", "success");
            await loadExams();
          } catch (error) {
            toast(error.message || "Could not save assignments. Check the exam_assignments policies.", "error");
            saveButton.disabled = false;
            saveButton.textContent = "Save assignments";
          }
        })
      );
    } catch (error) {
      body.replaceChildren();
      const message = document.createElement("div");
      message.className = "empty-state";
      message.textContent = error.message || "Could not load verified students or current assignments.";
      body.append(message);
    }
  }

  async function authorizeAttempt(exam) {
    if (!["teacher", "admin"].includes(state.profile?.role)) {
      return toast("Teacher access is required to authorize an attempt.", "error");
    }
    const { body, footer } = openWorkflowModal(
      "Authorize retake or remedial",
      "Choose an assigned student and record why another attempt is being authorized."
    );
    body.innerHTML = '<div class="empty-state">Loading assigned students…</div>';
    footer.append(workflowButton("Close", "btn-quiet", closeWorkflowModal));
    try {
      const { data: assignments, error: assignmentError } = await state.supabase
        .from("exam_assignments").select("student_id").eq("exam_id", exam.id);
      if (assignmentError) throw assignmentError;
      const ids = [...new Set((assignments || []).map(row => row.student_id).filter(Boolean))];
      if (!ids.length) {
        body.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Assign at least one student to this exam before authorizing another attempt.";
        body.append(empty);
        return;
      }
      const { data: studentRows, error: studentError } = await state.supabase
        .from("profiles").select("id,full_name,bu_id").in("id", ids);
      if (studentError) throw studentError;
      const students = (studentRows || []).filter(student => student.id)
        .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
      if (!students.length) {
        body.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Student details are not visible under the current database policies.";
        body.append(empty);
        return;
      }
      body.replaceChildren();
      footer.replaceChildren();
      const form = document.createElement("div");
      form.className = "workflow-form";
      const studentLabel = document.createElement("label");
      studentLabel.textContent = "Assigned student";
      const studentSelect = document.createElement("select");
      studentSelect.required = true;
      students.forEach(student => {
        const option = document.createElement("option");
        option.value = student.id;
        option.textContent = (student.full_name || "Unnamed student") + (student.bu_id ? " • BU ID: " + student.bu_id : "");
        studentSelect.append(option);
      });
      studentLabel.append(studentSelect);
      const typeLabel = document.createElement("label");
      typeLabel.textContent = "Attempt type";
      const typeSelect = document.createElement("select");
      [["retake", "Retake"], ["remedial", "Remedial"]].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        typeSelect.append(option);
      });
      typeLabel.append(typeSelect);
      const reasonLabel = document.createElement("label");
      reasonLabel.textContent = "Reason (optional)";
      const reason = document.createElement("textarea");
      reason.rows = 3;
      reason.maxLength = 1000;
      reason.placeholder = "Add a brief reason for this authorization…";
      reasonLabel.append(reason);
      form.append(studentLabel, typeLabel, reasonLabel);
      body.append(form);
      footer.append(
        workflowButton("Cancel", "btn-quiet", closeWorkflowModal),
        workflowButton("Authorize attempt", "btn-primary", async () => {
          const authorizeButton = footer.querySelector(".btn-primary");
          authorizeButton.disabled = true;
          authorizeButton.textContent = "Authorizing…";
          try {
            const student = students.find(item => item.id === studentSelect.value);
            const { data, error } = await state.supabase.rpc("authorize_exam_attempt", {
              p_exam_id: exam.id,
              p_student_id: studentSelect.value,
              p_attempt_type: typeSelect.value,
              p_reason: reason.value.trim()
            });
            if (error) throw error;
            closeWorkflowModal();
            toast("Authorized " + data.attempt_type + " attempt #" + data.attempt_number +
              " for " + (student?.full_name || "student") + ".", "success");
          } catch (error) {
            toast(error.message || "Could not authorize attempt.", "error");
            authorizeButton.disabled = false;
            authorizeButton.textContent = "Authorize attempt";
          }
        })
      );
    } catch (error) {
      body.replaceChildren();
      const message = document.createElement("div");
      message.className = "empty-state";
      message.textContent = error.message || "Could not load students assigned to this exam.";
      body.append(message);
    }
  }
  function renderQuestion() {
    const q = state.currentQuestions[state.questionIndex], i = state.questionIndex, total = state.currentQuestions.length;
    if (!q) return;
    $("#progress-label").textContent = `Question ${i + 1} of ${total}`;
    $("#progress-fill").style.width = `${((i + 1) / total) * 100}%`;
    $("#question-count-label").textContent = `${Object.keys(state.answers).length} of ${total} answered`;
    $("#previous-question").disabled = i === 0;
    $("#next-question").classList.toggle("hidden", i === total - 1);
    $("#submit-exam").classList.toggle("hidden", i !== total - 1);
    const target = $("#question-container"); target.innerHTML = "";
    const num = document.createElement("p"); num.className = "question-number"; num.textContent = `QUESTION ${String(i + 1).padStart(2, "0")}`; target.append(num);
    const title = document.createElement("h2"); title.className = "question-title"; title.textContent = q.prompt; target.append(title);
    const list = document.createElement("div"); list.className = "answer-list";
    (q.options || []).forEach(option => {
      const label = document.createElement("label"); label.className = "answer-option";
      const input = document.createElement("input"); input.type = "radio"; input.name = `answer-${q.id}`; input.value = option; input.checked = state.answers[q.id] === option;
      input.addEventListener("change", () => { state.answers[q.id] = option; $("#question-count-label").textContent = `${Object.keys(state.answers).length} of ${total} answered`; renderQuestionNavigator(); });
      const text = document.createElement("span"); text.textContent = option; label.append(input, text); list.append(label);
    });
    target.append(list); renderQuestionNavigator();
  }
  function renderQuestionNavigator() {
    const nav = $("#question-navigator"); if (!nav) return;
    nav.innerHTML = "";
    state.currentQuestions.forEach((q, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "question-jump"; b.textContent = String(i + 1);
      b.setAttribute("aria-label", `Go to question ${i + 1}`);
      if (state.answers[q.id] !== undefined) b.classList.add("answered");
      if (i === state.questionIndex) { b.classList.add("current"); b.setAttribute("aria-current", "step"); }
      b.addEventListener("click", () => { state.questionIndex = i; renderQuestion(); }); nav.append(b);
    });
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

  // Phase 2: read-only diagnostic views. Queries deliberately use ordinary
  // authenticated client access so Supabase RLS remains the authorization boundary.
  let registryRows = [], inspectorRows = [];
  function renderExamRegistry() {
    const target=$("#exam-registry-list"), status=$("#exam-registry-status");
    if(!target||!status)return;
    const query=$("#exam-registry-search").value.trim().toLowerCase();
    const rows=registryRows.filter(x=>[x.title,x.status,x.id].some(v=>String(v??"").toLowerCase().includes(query)));
    target.replaceChildren();
    if(!rows.length){status.textContent=registryRows.length?"No exams match this filter.":"No exams are visible to this account.";return;}
    status.textContent=`Showing ${rows.length} of ${registryRows.length} exam record(s). Read-only view.`;
    const frag=document.createDocumentFragment();
    rows.forEach(exam=>{
      const row=document.createElement("article");row.className="phase-two-row";
      const info=document.createElement("div"), title=document.createElement("strong"), meta=document.createElement("small");
      title.textContent=exam.title||"Untitled exam";
      meta.textContent=`ID: ${exam.id} • ${exam.duration_minutes??"—"} min • Published: ${exam.published_at?new Date(exam.published_at).toLocaleString():"—"}`;
      info.append(title,meta);
      const badge=document.createElement("span");badge.className="badge";badge.textContent=exam.status||"unknown";
      row.append(info,badge);frag.append(row);
    });
    target.append(frag);
  }
  async function loadExamRegistry() {
    if(state.profile?.role!=="admin")return toast("Developer access is required.","error");
    const status=$("#exam-registry-status"), target=$("#exam-registry-list");
    status.textContent="Loading exam records…";target.replaceChildren();
    try{
      const {data,error}=await state.supabase.from("exams").select("id,title,duration_minutes,status,published_at,teacher_id,created_at").order("created_at",{ascending:false}).limit(200);
      if(error)throw error;
      registryRows=data||[];renderExamRegistry();
    }catch(e){registryRows=[];status.textContent="Could not load exam registry. The database returned an access or query error.";toast("Exam Registry: "+(e.message||"request failed"),"error");}
  }
  function renderResultsInspector() {
    const target=$("#results-inspector-list"), status=$("#results-inspector-status");
    if(!target||!status)return;
    const query=$("#results-inspector-search").value.trim().toLowerCase();
    const rows=inspectorRows.filter(x=>[x.exam_id,x.student_id,x.status,x.attempt_type,x.exams?.title].some(v=>String(v??"").toLowerCase().includes(query)));
    target.replaceChildren();
    if(!rows.length){status.textContent=inspectorRows.length?"No submissions match this filter.":"No submission records are visible to this account.";return;}
    status.textContent=`Showing ${rows.length} of ${inspectorRows.length} submission record(s). Read-only view.`;
    const frag=document.createDocumentFragment();
    rows.forEach(sub=>{
      const row=document.createElement("article");row.className="phase-two-row";
      const info=document.createElement("div"), title=document.createElement("strong"), meta=document.createElement("small");
      title.textContent=sub.exams?.title||("Exam "+String(sub.exam_id||"").slice(0,8));
      const score=sub.score==null||sub.max_score==null?"Not scored":`${sub.score} / ${sub.max_score}`;
      meta.textContent=`Student: ${sub.student_id} • Attempt #${sub.attempt_number??"—"} (${sub.attempt_type||"—"}) • ${score} • Started: ${sub.started_at?new Date(sub.started_at).toLocaleString():"—"} • Submitted: ${sub.submitted_at?new Date(sub.submitted_at).toLocaleString():"—"}`;
      info.append(title,meta);
      const badge=document.createElement("span");badge.className="badge";badge.textContent=sub.status||"unknown";
      row.append(info,badge);frag.append(row);
    });
    target.append(frag);
  }
  async function loadResultsInspector() {
    if(state.profile?.role!=="admin")return toast("Developer access is required.","error");
    const status=$("#results-inspector-status"), target=$("#results-inspector-list");
    status.textContent="Loading submission records…";target.replaceChildren();
    try{
      const {data,error}=await state.supabase.from("submissions").select("id,exam_id,student_id,attempt_number,attempt_type,status,score,max_score,started_at,submitted_at,exams(title)").order("started_at",{ascending:false}).limit(300);
      if(error)throw error;
      inspectorRows=data||[];renderResultsInspector();
    }catch(e){inspectorRows=[];status.textContent="Could not load submissions. Check table permissions, relationships, and RLS.";toast("Results Inspector: "+(e.message||"request failed"),"error");}
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
        const meta = document.createElement("small"); meta.textContent = `${user.role || "student"} • ${user.verified_at ? "Verified" : "Unverified"} • ${user.suspended ? "Suspended" : "Active"}${user.teacher_request_status ? " • Teacher request: " + user.teacher_request_status : ""}`;
        identity.append(name,email,meta);
        if (user.suspended && user.suspension_reason) { const suspensionReason = document.createElement("small"); suspensionReason.textContent = `Suspension reason: ${user.suspension_reason}`; suspensionReason.className = "muted"; identity.append(suspensionReason); }
        const controls = document.createElement("div"); controls.className = "admin-user-controls";
        const role = document.createElement("select"); role.setAttribute("aria-label", "Role for " + (user.email || user.id));
        ["student","teacher","admin"].forEach(value => { const option=document.createElement("option"); option.value=value; option.textContent=value; option.selected=value===(user.role||"student"); role.append(option); });
        const save = document.createElement("button"); save.className="btn btn-quiet"; save.textContent="Save role"; save.addEventListener("click", async()=>{ if(!confirm(`Change ${user.email}'s role to ${role.value}?`)) return; const reason=prompt("Reason for this role change (required):"); if(!reason||reason.trim().length<3)return toast("Enter a reason of at least 3 characters.","error"); try { await adminControl("set_role",{user_id:user.id,role:role.value,reason:reason.trim()}); toast("Role updated.","success"); await loadAdminUsers(); } catch(e){toast(e.message,"error");} });
        if (user.teacher_request_status === "pending") {
          const approve=document.createElement("button");approve.className="btn btn-primary";approve.textContent="Approve Teacher";
          approve.addEventListener("click",async()=>{if(!confirm("Approve Teacher access for "+user.email+"?"))return;try{await adminControl("approve_teacher_request",{user_id:user.id});toast("Teacher access approved.","success");await loadAdminUsers();}catch(e){toast(e.message,"error");}});
          const reject=document.createElement("button");reject.className="btn btn-quiet";reject.textContent="Reject request";
          reject.addEventListener("click",async()=>{const note=prompt("Optional reason for rejection:")||"";if(!confirm("Reject Teacher access request for "+user.email+"?"))return;try{await adminControl("reject_teacher_request",{user_id:user.id,review_note:note});toast("Request rejected. Applicant can reapply later.","success");await loadAdminUsers();}catch(e){toast(e.message,"error");}});
          controls.append(approve,reject);
        }
        const verify = document.createElement("button"); verify.className="btn btn-quiet"; verify.textContent=user.verified_at?"Revoke verification":"Verify"; verify.addEventListener("click",async()=>{ try { await adminControl("set_verified",{user_id:user.id,verified:!user.verified_at}); toast("Verification status updated.","success"); await loadAdminUsers(); } catch(e){toast(e.message,"error");} });
        const suspend = document.createElement("button"); suspend.className="btn btn-quiet"; suspend.textContent=user.suspended?"Reactivate":"Suspend"; suspend.disabled=user.id===state.user.id; suspend.addEventListener("click",async()=>{ const action=user.suspended?"reactivate":"suspend"; if(!confirm(`${action==="suspend"?"Suspend":"Reactivate"} ${user.email}?`))return; const reason=prompt(`Reason for ${action} (required):`); if(!reason||reason.trim().length<3)return toast("Enter a reason of at least 3 characters.","error"); try { await adminControl(action,{user_id:user.id,reason:reason.trim()}); toast(action==="suspend"?"Account suspended.":"Account reactivated.","success"); await loadAdminUsers(); }catch(e){toast(e.message,"error");} });
        const del = document.createElement("button"); del.className="btn btn-danger"; del.textContent="Delete"; del.disabled=user.id===state.user.id; del.addEventListener("click",async()=>{ if(prompt(`Permanently delete ${user.email}? Type DELETE to confirm.`)!=="DELETE")return; try { await adminControl("delete_user",{user_id:user.id,confirmation:"DELETE",reason:"Account deletion explicitly confirmed by administrator."}); toast("Account deleted.","success"); await loadAdminUsers(); }catch(e){ const originalError=e.message || "The delete function returned an error."; try { const check=await adminControl("list_users",{query:""}); const stillExists=(check.users||[]).some(account=>account.id===user.id); if(!stillExists){ toast("The account is no longer listed. Deletion appears to have succeeded, but the admin function returned an error; its cleanup/audit step may have failed.","success"); await loadAdminUsers(); return; } }catch(checkError){} toast(`Delete operation reported an error: ${originalError}`, "error"); await loadAdminUsers(); } });
        controls.append(role,save,verify,suspend,del); card.append(identity,controls); fragment.append(card);
      });
      if (loadSequence !== adminUsersLoadSequence) return;
      list.replaceChildren(fragment);
      const audit = await adminControl("list_audit");
      if (loadSequence !== adminUsersLoadSequence) return;
      const auditList=$("#admin-audit-list"); auditList.replaceChildren();
      if(!audit.logs?.length) auditList.innerHTML='<div class="empty-state">No administrative actions recorded yet.</div>';
      (audit.logs||[]).forEach(log=>{const row=document.createElement("div");row.className="admin-audit-row";const label=document.createElement("strong");label.textContent=`${log.action} · ${log.outcome||"success"}`;const detail=document.createElement("span");detail.textContent=`Target: ${log.target_email||log.target_user_id||"Platform"} • Actor: ${log.actor_id||"Unavailable"} • ${new Date(log.created_at).toLocaleString()}`;row.append(label,detail);if(log.reason){const reason=document.createElement("small");reason.textContent=`Reason: ${log.reason}`;row.append(reason);}if(log.details&&Object.keys(log.details).length){const details=document.createElement("small");details.textContent=`Details: ${JSON.stringify(log.details)}`;row.append(details);}auditList.append(row);});
    } catch (e) { if (loadSequence !== adminUsersLoadSequence) return; status.textContent = "Could not load accounts."; list.replaceChildren(); toast(e.message || "Admin controls are unavailable. Deploy admin-control and configure its secrets.", "error"); }
  }

  async function signOut() { await state.supabase.auth.signOut(); state.user = state.profile = null; showOnly("#auth-view"); }
  async function init() {
    // Protect against accidental duplicate script execution or repeated DOM-ready handlers.
    if (window.__academixInitStarted) return;
    window.__academixInitStarted = true;
    if (!environmentConfigSafe) {
      showOnly("#auth-view");
      const message = APP_ENVIRONMENT === "TEST" && normalizedSupabaseUrl === PRODUCTION_SUPABASE_URL
        ? "SAFETY BLOCK: TEST mode is pointing at the production database. Use a separate test Supabase project before signing in."
        : "Setup required: environment must be TEST or PRODUCTION. Check academix-config.js.";
      toast(message, "error");
      const badge = $("#environment-badge");
      if (badge) { badge.textContent = "ENVIRONMENT CONFIGURATION ERROR"; badge.dataset.environment = "UNCONFIGURED"; }
      return;
    }
    if (!configured || !window.supabase) {
      showOnly("#auth-view");
      toast("Setup required: add your Supabase project URL and publishable/anon key in academix-config.js.", "error");
      return;
    }
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    $$("[data-auth-tab]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.authTab)));
    $("#auth-form").addEventListener("submit", authSubmit);
    $("#teacher-request-button")?.addEventListener("click", submitTeacherRequest);
    $("#forgot-password").addEventListener("click", async () => {
      const email = $("#auth-email").value.trim(); if (!email) return toast("Enter your email address first.", "error");
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      toast(error ? error.message : "If the account exists, a password reset email will be sent.", error ? "error" : "success");
    });
    $("#password-recovery-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = $("#recovery-password").value;
      const confirmation = $("#recovery-password-confirm").value;
      if (password.length < 8) return toast("Use at least 8 characters for your new password.", "error");
      if (password !== confirmation) return toast("The passwords do not match.", "error");
      const button = $("#password-recovery-form button[type='submit']");
      button.disabled = true;
      try {
        const { error } = await state.supabase.auth.updateUser({ password });
        if (error) throw error;
        await state.supabase.auth.signOut();
        $("#password-recovery-form").classList.add("hidden");
        $("#auth-form").classList.remove("hidden");
        $("#forgot-password").classList.remove("hidden");
        $("#recovery-password").value = "";
        $("#recovery-password-confirm").value = "";
        setAuthMode("signin");
        showOnly("#auth-view");
        toast("Password updated. Sign in with your new password.", "success");
      } catch (error) {
        toast(error.message || "Could not update the password.", "error");
      } finally {
        button.disabled = false;
      }
    });
    $$(".nav-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
    $$("[data-go]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.go)));
    $$("[data-action=\"planned\"]").forEach(b => b.addEventListener("click", () => toast(b.dataset.feature + " is planned but not implemented yet.", "error")));
    $("#workflow-modal-close")?.addEventListener("click", closeWorkflowModal);
    $("#workflow-modal")?.addEventListener("click", event => {
      if (event.target.matches("[data-workflow-close]")) closeWorkflowModal();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !$("#workflow-modal")?.classList.contains("hidden")) closeWorkflowModal();
    });
        $("#signout").addEventListener("click", signOut);
    $("#refresh-exams").addEventListener("click", loadExams);
    $("#refresh-exam-registry")?.addEventListener("click", loadExamRegistry);
    $("#search-exam-registry")?.addEventListener("click", renderExamRegistry);
    $("#exam-registry-search")?.addEventListener("input", renderExamRegistry);
    $("#refresh-results-inspector")?.addEventListener("click", loadResultsInspector);
    $("#search-results-inspector")?.addEventListener("click", renderResultsInspector);
    $("#results-inspector-search")?.addEventListener("input", renderResultsInspector);
    $("#refresh-admin-users")?.addEventListener("click", loadAdminUsers);
    $("#jump-admin-users")?.addEventListener("click", () => $("#admin-users-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    $("#search-admin-users")?.addEventListener("click", loadAdminUsers);
    $("#generator-form").addEventListener("submit", generateQuiz);
    $("#publish-quiz").addEventListener("click", publishQuiz);
    $("#export-grades").addEventListener("click", exportGrades);
    $("#previous-question").addEventListener("click", () => { if (state.questionIndex > 0) { state.questionIndex--; renderQuestion(); } });
    $("#next-question").addEventListener("click", () => { if (state.questionIndex < state.currentQuestions.length - 1) { state.questionIndex++; renderQuestion(); } });
    $("#exam-form").addEventListener("submit", e => submitExam(e));
    $("#exit-exam").addEventListener("click", () => { if (confirm("Leave this attempt? Your answers may not be submitted.")) { clearInterval(state.timerId); showOnly("#dashboard-view"); switchView("exams"); } });
    state.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showOnly("#auth-view");
        $("#auth-form").classList.add("hidden");
        $("#forgot-password").classList.add("hidden");
        $("#password-recovery-form").classList.remove("hidden");
        $("#auth-title").textContent = "Reset your password";
        $("#auth-subtitle").textContent = "Enter and confirm your new password below.";
        return;
      }
      if (session?.user) {
        const sameUser = state.user?.id === session.user.id;
        state.user = session.user;
        // Token refreshes happen during normal use. Re-entering the app on every
        // refresh resets the active view and can kick users out of Quiz Studio.
        if (event === "TOKEN_REFRESHED" && sameUser) return;
        try { await enterApp(); } catch (e) { toast(e.message || "Could not load your profile.", "error"); }
      } else {
        state.user = state.profile = null;
        $("#auth-form").classList.remove("hidden");
        $("#password-recovery-form").classList.add("hidden");
        $("#forgot-password").classList.remove("hidden");
        showOnly("#auth-view");
      }
    });
    const { data: { session } } = await state.supabase.auth.getSession();
    if (session?.user) { state.user = session.user; try { await enterApp(); } catch (e) { toast(e.message, "error"); } }
  }
  document.addEventListener("DOMContentLoaded", init);
})(); 
