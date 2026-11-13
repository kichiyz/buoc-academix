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
    draft: null, previewQuestionIndex: 0, adminUsers: [], currentExam: null, currentQuestions: [], answers: {}, questionIndex: 0, timerId: null, secondsLeft: 0 };
  const validSupabaseUrl = /^https:\/\/[^\s]+\.supabase\.co$/.test(SUPABASE_URL) || (APP_ENVIRONMENT === "TEST" && /^http:\/\/(localhost|127\.0\.0\.1):54321$/.test(SUPABASE_URL));
  const configured = validSupabaseUrl && /^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)$/.test(SUPABASE_ANON_KEY);
  // Phase 4 safety boundary: prevent TEST mode from connecting to production.
  // This guard supplements, but cannot replace, a separately provisioned test project.
  const PRODUCTION_SUPABASE_URL = "https://otkgtwwxmmdmiavmpyqo.supabase.co";
  const normalizedSupabaseUrl = SUPABASE_URL.replace(/\/+$/, "").toLowerCase();
  const environmentConfigSafe = ["TEST", "PRODUCTION"].includes(APP_ENVIRONMENT) &&
    !(APP_ENVIRONMENT === "TEST" && normalizedSupabaseUrl === PRODUCTION_SUPABASE_URL);



  function renderTestEnvironmentStatus() {
    const status = $("#test-environment-status");
    const tag = $("#test-environment-tag");
    const button = $("#check-test-environment");
    if (!status || !tag) return;
    const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
    const localConfig = APP_ENVIRONMENT === "TEST" && /^http:\/\/(localhost|127\.0\.0\.1):54321$/.test(SUPABASE_URL);
    if (!localHost) {
      tag.textContent = "LOCAL ONLY";
      status.textContent = "This deployed site uses production. Start the sandbox on your computer to use the isolated test database.";
    } else if (localConfig) {
      tag.textContent = "LOCAL CONFIG";
      status.textContent = "Local test configuration loaded. Use Check local sandbox to verify Supabase.";
    } else {
      tag.textContent = "NOT CONNECTED";
      status.textContent = "Local Supabase is not configured. Follow TEST-ENVIRONMENT.md; production credentials are blocked on localhost.";
    }
    button?.addEventListener("click", async () => {
      if (!localHost || !localConfig) return toast("The isolated sandbox is available only after the local setup script configures TEST mode.", "error");
      status.textContent = "Checking local Supabase…";
      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Auth health returned HTTP ${response.status}`);
        status.textContent = "ONLINE — connected to the local Supabase instance. Test data stays on this computer.";
        tag.textContent = "ONLINE";
      } catch (error) {
        status.textContent = `OFFLINE — ${error.message}. Run supabase start and retry.`;
        tag.textContent = "OFFLINE";
      }
    });
  }

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
    if (view === "evaluations" && role === "student") loadStudentEvaluations();
    if (view === "developer" && role === "admin") { loadPhase8Admin(); loadAcademicDirectory(); loadUnassignedStudents(); }
    if (view === "teacher-home" && role === "teacher") loadTeacherPhase8Offerings();
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
    $("#role-label").textContent = p.role === "admin" ? "PLATFORM OPERATIONS / DEVELOPER" : `${p.role.toUpperCase()} WORKSPACE`;
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
    const roleNotice = $("#teacher-role-notice");
    if (roleNotice) roleNotice.classList.toggle("hidden", p.role !== "student" || Boolean(p.verified_at));
    const examNavLabel = $("#exam-nav-label"); if (examNavLabel) examNavLabel.lastChild.textContent = " My Exams";
  }
  async function loadProfile() {
    const { data, error } = await state.supabase.from("profiles").select("id,full_name,role,bu_id,verified_at,campus_id,college_id,program_id,year_level,block_code").eq("id", state.user.id).single();
    if (error) throw error;
    state.profile = data;
    renderProfile();
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
        const { error } = await state.supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { full_name: name, bu_id: buId } } });
        if (error) throw error;
        toast("Account created as a Student. Confirm your email, then wait for an administrator to verify your institutional details and assign any elevated role.", "success");
        setAuthMode("signin");
      }
    } catch (e) { toast(e.message || "Authentication failed.", "error"); }
  }
  async function loadExams() {
    const target = $("#exam-list"); target.innerHTML = '<div class="empty-state">Loading assessments…</div>';
    try {
      const { data, error } = await state.supabase.from("exams").select("id,title,duration_minutes,status,published_at,teacher_id,exam_mode,assessment_category,grade_weight_percent").eq("status", "published").order("published_at", { ascending: false });
      if (error) throw error;
      // RLS limits students to assigned exams. Teachers only see their own via the policies.
      if (!data?.length) { target.innerHTML = '<div class="empty-state">No published assessments found for this account.</div>'; return; }
      target.innerHTML = "";
      for (const exam of data) {
        const { count } = await state.supabase.from("questions").select("*", { count: "exact", head: true }).eq("exam_id", exam.id);
        const card = document.createElement("article"); card.className = "exam-card";
        card.innerHTML = `<span class="badge">${state.profile.role === "teacher" ? "Published" : "Assigned exam"}</span><h3></h3><div class="exam-meta"><span>Duration: ${exam.duration_minutes} min</span><span>Questions: ${count ?? "—"}</span></div><button class="btn ${state.profile.role === "teacher" ? "btn-quiet" : "btn-primary"}">${state.profile.role === "teacher" ? "Exam ID: " + exam.id.slice(0, 8) : "Start exam →"}</button>`;
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
          if (state.profile.role === "teacher") {
            const remove = document.createElement("button");
            remove.className = "btn btn-danger";
            remove.textContent = "Delete assessment";
            remove.addEventListener("click", async () => {
              const {count,error:countError}=await state.supabase.from("submissions").select("id",{count:"exact",head:true}).eq("exam_id",exam.id);
              if(countError)return toast(countError.message,"error");
              const warning=count? " This permanently deletes "+count+" student submission(s) and their associated scores.":"";
              if(!confirm("Delete “"+exam.title+"” permanently?"+warning+" This cannot be undone."))return;
              remove.disabled=true;
              try{const {error}=await state.supabase.rpc("academix_teacher_delete_exam",{p_exam_id:exam.id});if(error)throw error;toast("Assessment deleted.","success");await loadExams();}
              catch(err){toast(err.message||"Could not delete assessment.","error");remove.disabled=false;}
            });
            actions.append(remove);
          }
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
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Quiz generation timed out after 125 seconds. The AI provider may be slow or unavailable; please retry shortly.")), 125000));
    try {
      const request = (async () => {
        const { error: sessionError } = await state.supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const { data, error } = await state.supabase.functions.invoke("generate-quiz", {
          body: { title: $("#quiz-title").value.trim(), material: $("#quiz-material").value.slice(0, 30000),
            count: Number($("#quiz-count").value), questionType: $("#quiz-type").value, difficulty: $("#quiz-difficulty").value, mixDistribution: $("#quiz-mix-distribution").value }
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
  function validateImportedExam(data) {
    if(!data||typeof data!=="object"||!Array.isArray(data.questions))throw new Error("JSON must contain a questions array.");
    const title=String(data.title||data.exam_title||"").trim();if(!title)throw new Error("JSON must include a title.");
    if(!data.questions.length||data.questions.length>50)throw new Error("An exam must contain between 1 and 50 questions.");
    const supported=["multiple_choice","true_false","identification","enumeration","short_answer","essay"];
    const questions=data.questions.map((raw,i)=>{
      const type=raw.question_type||raw.type,prompt=String(raw.prompt||raw.question||"").trim();
      const options=Array.isArray(raw.options)?raw.options.map(x=>String(x).trim()).filter(Boolean):[];
      let answer=raw.correct_answer??raw.answer??"",explanation=String(raw.explanation||"").trim();
      if(!supported.includes(type))throw new Error("Question "+(i+1)+": unsupported question_type.");
      if(!prompt)throw new Error("Question "+(i+1)+": prompt is required.");
      if(type==="multiple_choice"&&(options.length!==4||new Set(options).size!==4||!options.includes(String(answer))))throw new Error("Question "+(i+1)+": multiple choice requires four unique options and a matching answer.");
      if(type==="true_false"&&(options.length!==2||!options.includes("True")||!options.includes("False")||!["True","False"].includes(String(answer))))throw new Error("Question "+(i+1)+": true/false requires True and False with a matching answer.");
      if(["identification","short_answer","enumeration"].includes(type)){
        answer=Array.isArray(answer)?answer.map(v=>String(v).trim()).filter(Boolean):String(answer).split("\n").map(v=>v.trim()).filter(Boolean);
        if(type==="enumeration"&&answer.length<2)throw new Error("Question "+(i+1)+": enumeration requires at least two expected items.");
        if(type!=="enumeration"&&!answer.length)throw new Error("Question "+(i+1)+": provide at least one accepted answer.");
        if(type!=="enumeration"&&answer.length===1)answer=answer[0];
      }
      if(type==="essay")answer=null;
      const points=Number(raw.points??1);if(!Number.isInteger(points)||points<1||points>100)throw new Error("Question "+(i+1)+": points must be a whole number from 1 to 100.");
      const image_url=String(raw.image_url||"").trim();if(image_url&&!/^https:\/\//i.test(image_url))throw new Error("Question "+(i+1)+": image_url must use HTTPS.");
      return {position:i+1,question_type:type,prompt,options,correct_answer:answer,explanation,points,image_url};
    });
    return {title,exam_mode:data.exam_mode==="sequential"?"sequential":"freeroam",questions};
  }
  function downloadText(filename, text, type) {
    const url=URL.createObjectURL(new Blob([text],{type}));
    const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function printDraft(answerKey) {
    if(!state.draft?.questions?.length)return toast("Create or import a draft first.","error");
    const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const draft=state.draft;
    const title=esc(draft.title||"Untitled assessment");
    const questions=draft.questions;
    const totalPoints=questions.reduce((sum,q)=>sum+(Number(q.points)||0),0);
    const duration=Number($("#publish-duration")?.value)||0;
    const offering=$("#publish-offering");
    const offeringLabel=offering?.selectedOptions?.[0]?.textContent?.trim()||"";
    const assessmentType=$("#publish-type")?.selectedOptions?.[0]?.textContent?.trim()||"Assessment";
    const dateLabel=new Intl.DateTimeFormat("en-PH",{year:"numeric",month:"long",day:"numeric"}).format(new Date());
    const items=questions.map((q,i)=>{
      const marks='<span class="marks">'+(Number(q.points)||0)+' '+((Number(q.points)||0)===1?"point":"points")+'</span>';
      const image=q.image_url?'<img class="question-image" src="'+esc(q.image_url)+'" alt="Question reference image">':"";
      if(answerKey){
        const answer=Array.isArray(q.correct_answer)?q.correct_answer.join("; "):q.correct_answer||"Teacher-reviewed response";
        return '<article class="question answer-question"><div class="question-heading"><span class="question-number">'+String(i+1).padStart(2,"0")+'</span><div class="question-main"><p class="question-prompt">'+esc(q.prompt)+'</p></div>'+marks+'</div>'+image+'<div class="key-answer"><div class="answer-label">Correct answer / expected response</div><p>'+esc(answer)+'</p></div>'+(q.explanation?'<p class="explanation"><b>Rationale:</b> '+esc(q.explanation)+'</p>':"")+'</article>';
      }
      const choices=(q.options||[]).length
        ?'<ol class="choices" type="A">'+q.options.map(o=>'<li>'+esc(o)+'</li>').join("")+'</ol>'
        :'<div class="response-lines"><span>Write your response in the space provided.</span><i></i><i></i><i></i></div>';
      return '<article class="question"><div class="question-heading"><span class="question-number">'+String(i+1).padStart(2,"0")+'</span><div class="question-main"><p class="question-prompt">'+esc(q.prompt)+'</p></div>'+marks+'</div>'+image+choices+'</article>';
    }).join("");
    const cover=answerKey
      ?'<div class="confidential"><b>CONFIDENTIAL</b><span>INSTRUCTOR COPY · ANSWER KEY AND MARKING GUIDE</span></div>'
      :'<section class="candidate-panel"><div class="candidate-field candidate-name"><b>Name of student</b><span></span></div><div class="candidate-field"><b>Student number</b><span></span></div><div class="candidate-field"><b>Course / year / section</b><span></span></div><div class="candidate-field"><b>Date</b><span></span></div><div class="candidate-field candidate-score"><b>Score</b><span>________ / '+totalPoints+'</span></div></section>';
    const instructions=answerKey
      ?"For instructor use only. Check each response against the accepted answer. Apply the indicated points consistently; use professional judgment for equivalent responses."
      :"Read every instruction carefully. Write your name and student number in the spaces provided. Answer all questions legibly. Do not write outside the designated answer spaces or in the page margins.";
    const doc='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+(answerKey?" — Answer Key":" — Examination")+'</title><style>'+
      '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#182b3a}body{font:10pt/1.48 "Arial", "Helvetica Neue", sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{width:100%;max-width:180mm;margin:0 auto;padding:0 0 2mm}.running-header{position:fixed;top:-11mm;left:0;right:0;height:9mm;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #9aabb7;color:#4b6070;font-size:7pt;letter-spacing:.08em;text-transform:uppercase}.running-header strong{color:#183f5b;font-family:Georgia,serif;font-size:8pt}.running-footer{position:fixed;bottom:-13mm;left:0;right:0;height:8mm;border-top:1px solid #9aabb7;padding-top:2mm;display:flex;justify-content:space-between;align-items:flex-start;color:#536777;font-size:7pt}.running-footer strong{color:#183f5b;letter-spacing:.06em}.page-number:after{content:counter(page)}.masthead{display:grid;grid-template-columns:17mm 1fr auto;gap:4mm;align-items:center;border-bottom:2px solid #174d70;padding:0 0 4mm;margin:0 0 5mm}.seal{width:18mm;height:18mm;object-fit:contain;display:block;flex:none}.institution-name{font:bold 12pt Georgia,serif;letter-spacing:.045em;text-transform:uppercase;color:#173f5b}.institution-subtitle{font-size:7pt;font-weight:bold;letter-spacing:.16em;text-transform:uppercase;color:#94651f;margin-top:1mm}.document-class{text-align:right;font-size:7pt;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#4c6271}.document-title{font: bold 17pt Georgia,serif;text-align:center;color:#18364b;line-height:1.2;margin:0 0 1.5mm}.document-subtitle{text-align:center;color:#617483;font-size:8.5pt;margin:0 0 5mm}.confidential{display:flex;flex-direction:column;align-items:center;gap:1mm;border:1px solid #b55a54;background:#fff8f7;color:#963f39;padding:2.5mm;margin:0 0 4mm;text-align:center}.confidential b{font-size:8pt;letter-spacing:.18em}.confidential span{font-size:7pt;letter-spacing:.09em}.candidate-panel{display:grid;grid-template-columns:1.5fr 1.1fr 1.2fr 1fr;gap:3mm 4mm;border:1px solid #aebdc7;padding:4mm;margin:0 0 4mm}.candidate-field{display:flex;flex-direction:column;gap:3mm;min-width:0}.candidate-field b{font-size:7pt;color:#40596b}.candidate-field span{min-height:5mm;border-bottom:1px solid #7d909c;font-size:8pt}.candidate-name{grid-column:span 2}.candidate-score{grid-column:span 1}.meta-grid{display:grid;grid-template-columns:1.1fr 1.6fr 1fr 1fr;gap:2mm;border-top:1px solid #c6d1d8;border-bottom:1px solid #c6d1d8;padding:2.5mm 0;margin:0 0 4mm}.meta-cell{font-size:7.5pt;color:#40596b}.meta-cell b{display:block;font-size:6.5pt;letter-spacing:.07em;text-transform:uppercase;color:#718391;margin-bottom:.7mm}.instructions{border-left:2px solid #b18135;background:#f4f7f9;padding:3mm 3.5mm;margin:0 0 5mm;font-size:8pt;color:#334b5c}.section-heading{font-size:7pt;font-weight:bold;letter-spacing:.15em;text-transform:uppercase;color:#95671f;border-bottom:1px solid #c7d2d9;padding-bottom:1.5mm;margin:0 0 3.5mm}.question{break-inside:avoid-page;page-break-inside:avoid;margin:0 0 4mm;padding:0 0 3.5mm;border-bottom:1px solid #dce3e8}.question-heading{display:grid;grid-template-columns:8mm minmax(0,1fr) auto;gap:2.5mm;align-items:start}.question-number{width:7mm;height:7mm;border:1px solid #7f98a8;border-radius:50%;display:grid;place-items:center;color:#174d70;font-weight:bold;font-size:7.5pt}.question-main{min-width:0}.question-prompt{font-weight:bold;color:#1c2f3d;margin:1mm 0 0}.marks{white-space:nowrap;border:1px solid #c5d0d7;border-radius:2px;padding:1mm 1.7mm;font-size:7pt;color:#536b7b}.choices{margin:2mm 0 0 10mm;padding-left:5mm}.choices li{padding:.5mm 0 .5mm 1mm}.response-lines{margin:3mm 0 0 10mm;display:grid;gap:5mm}.response-lines span{font-size:7pt;color:#667b89}.response-lines i{height:4mm;border-bottom:1px solid #aebbc4}.question-image{display:block;max-width:calc(100% - 10mm);max-height:65mm;object-fit:contain;margin:3mm 0 2mm 10mm}.key-answer{margin:2.5mm 0 0 10mm;padding:2.5mm 3mm;border:1px solid #d5e2d9;border-left:2px solid #47745f;background:#f4f8f5}.answer-label{font-size:6.5pt;font-weight:bold;letter-spacing:.09em;text-transform:uppercase;color:#315e49}.key-answer p{margin:1mm 0 0;white-space:pre-wrap;color:#1f382d}.explanation{margin:2mm 0 0 10mm;color:#536977;font-size:8pt}.end-note{margin:5mm 0 0;padding-top:2.5mm;border-top:1px solid #aebdc7;text-align:center;color:#617482;font-size:7pt}.signature-row{display:grid;grid-template-columns:1fr 1fr;gap:18mm;margin:12mm 8mm 0}.signature-field{text-align:center;border-top:1px solid #536777;padding-top:1.5mm;font-size:7pt;color:#536777}.answer-signoff{margin-top:8mm;padding:3mm;border:1px solid #d8e0e5;color:#526777;font-size:7pt;text-align:center}@page{size:A4 portrait;margin:20mm 17mm 20mm 17mm}@media print{.sheet{max-width:none}.question{break-inside:avoid-page;page-break-inside:avoid}.question-image{max-height:60mm}.running-header,.running-footer{position:fixed}body{font-size:9.5pt}}@media screen{body{background:#eef3f7;padding:18mm 0}.sheet{background:#fff;min-height:257mm;box-shadow:0 2px 14px #1d354522;padding:0 0 15mm}.running-header,.running-footer{display:none}}'+
      '</style></head><body><header class="running-header"><strong>Bicol University · AcademiX</strong><span>'+(answerKey?"Confidential instructor copy":"Official assessment document")+'</span></header><footer class="running-footer"><strong>BU · ACADEMIX</strong><span>'+(answerKey?"CONFIDENTIAL — FOR INSTRUCTOR USE ONLY":"PLEASE KEEP THIS DOCUMENT INTACT")+'</span><span>Page <b class="page-number"></b></span></footer><main class="sheet"><header class="masthead"><img class="seal" src="https://commons.wikimedia.org/wiki/Special:FilePath/BU_Logo-_Transparent_BG.png" alt="Official Bicol University seal"><div><div class="institution-name">Bicol University</div><div class="institution-subtitle">AcademiX · Learning and Assessment Portal</div></div><div class="document-class">'+(answerKey?"Instructor document":"Official assessment")+'</div></header><h1 class="document-title">'+title+'</h1><p class="document-subtitle">'+(answerKey?"Instructor reference copy · Answer key and marking guide":"Written examination / assessment")+'</p>'+cover+'<section class="meta-grid"><div class="meta-cell"><b>Assessment type</b>'+esc(assessmentType)+'</div><div class="meta-cell"><b>Course / class offering</b>'+esc(offeringLabel||"As assigned")+'</div><div class="meta-cell"><b>Time allowed</b>'+(duration?duration+" minutes":"As instructed")+'</div><div class="meta-cell"><b>Total items / points</b>'+questions.length+" / "+totalPoints+'</div></section><div class="instructions"><b>Instructions:</b> '+instructions+'</div><h2 class="section-heading">'+(answerKey?"Answer key and marking reference":"Examination questions")+'</h2>'+items+(answerKey?'<div class="answer-signoff">This document contains confidential assessment answers. Store securely and do not distribute to students.</div>':'<div class="signature-row"><div class="signature-field">Signature of student</div><div class="signature-field">Signature of proctor / instructor</div></div>')+'<div class="end-note">'+(answerKey?"End of confidential instructor answer key.":"End of examination. Review your answers before submission.")+'</div></main><script>window.addEventListener("load",()=>{const imgs=Array.from(document.images);Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;}))).then(()=>setTimeout(()=>{window.focus();window.print();},300));});</script></body></html>';
    const w=window.open("","_blank");
    if(!w)return toast("Allow pop-ups to print this document.","error");
    w.document.open();w.document.write(doc);w.document.close();
  }
  function importExamJson(file) {
    const reader=new FileReader();reader.onload=()=>{try{$("#json-authoring-input").value=JSON.stringify(JSON.parse(String(reader.result)),null,2);validateJsonAuthoring();toast("JSON loaded into the editor. Review the preview before publishing.","success");}catch(e){toast("JSON import failed: "+e.message,"error");}};reader.onerror=()=>toast("Could not read the selected JSON file.","error");reader.readAsText(file);
  }
  function validateJsonAuthoring() {
    const status=$("#json-validation-status"), preview=$("#student-preview");
    try {
      const raw=JSON.parse($("#json-authoring-input").value);
      raw.exam_mode=$("#exam-navigation-mode").value;
      const draft=validateImportedExam(raw);
      const title=$("#json-assessment-title").value.trim();if(title)draft.title=title;
      state.draft=draft;state.previewQuestionIndex=0;status.textContent="Valid JSON — "+draft.questions.length+" question(s). Student preview is ready.";status.className="notice notice-success";
      renderStudentPreview();renderDraft();return true;
    } catch(error) {
      state.draft=null;status.textContent="JSON needs attention: "+error.message;status.className="notice notice-error";
      preview.innerHTML='<div class="empty-state">Fix the JSON error, then validate again. No exam has been published.</div>';$("#draft-panel").classList.add("hidden");return false;
    }
  }
  function renderStudentPreview() {
    const target=$("#student-preview"),draft=state.draft;if(!target||!draft?.questions?.length)return;
    const safe=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const total=draft.questions.length;state.previewQuestionIndex=Math.max(0,Math.min(state.previewQuestionIndex||0,total-1));
    const index=state.previewQuestionIndex,q=draft.questions[index],progress=(index+1)/total*100;
    if(window.MathJax?.typesetClear)window.MathJax.typesetClear([target]);
    const opts=["multiple_choice","true_false"].includes(q.question_type)?'<div class="preview-options">'+(q.options||[]).map((o,i)=>'<div class="preview-option"><span>'+(i+1)+'</span><div>'+safe(o)+'</div></div>').join("")+'</div>':'<p class="muted">'+({identification:"Short written answer",enumeration:"One item per line",short_answer:"Short written answer",essay:"Long-form response · manually graded"}[q.question_type]||"Written response")+'</p>';
    const image=q.image_preview_url||q.image_url;
    target.innerHTML='<div class="preview-exam-top"><span class="eyebrow">STUDENT ASSESSMENT PREVIEW</span><span class="preview-pill">'+(draft.exam_mode==="sequential"?"SEQUENTIAL":"FREE-ROAM")+'</span></div><h3>'+safe(draft.title)+'</h3><div class="preview-meta"><span>'+total+' questions</span><span>'+Number($("#publish-duration").value||30)+' minutes</span><span>Question '+(index+1)+' of '+total+'</span></div><div class="preview-progress"><span style="width:'+progress+'%"></span></div><article class="preview-question"><p class="eyebrow">QUESTION '+String(index+1).padStart(2,"0")+' · '+Number(q.points||1)+' POINTS · '+safe(String(q.question_type).replaceAll("_"," ").toUpperCase())+'</p><h4>'+safe(q.prompt)+'</h4>'+(image?'<img class="question-reference-image" src="'+safe(image)+'" alt="Question reference image">':"")+opts+'</article><div class="preview-controls"><button type="button" class="btn btn-quiet" data-preview-prev '+(index===0?"disabled":"")+' aria-label="Previous preview question">← Previous</button><span>Student view · answers hidden</span><button type="button" class="btn btn-quiet" data-preview-next '+(index===total-1?"disabled":"")+' aria-label="Next preview question">Next →</button></div>';
    target.querySelector("[data-preview-prev]")?.addEventListener("click",()=>{state.previewQuestionIndex=Math.max(0,index-1);renderStudentPreview();});
    target.querySelector("[data-preview-next]")?.addEventListener("click",()=>{state.previewQuestionIndex=Math.min(total-1,index+1);renderStudentPreview();});
    if(window.MathJax?.typesetPromise)window.MathJax.typesetPromise([target]).catch(()=>{});
  }
  function renderDraft() {
    const panel=$("#draft-panel"),target=$("#draft-questions");target.replaceChildren();panel.classList.remove("hidden");
    if(!state.draft?.questions?.length){target.innerHTML='<div class="empty-state">No questions in this draft.</div>';return;}
    const label=(text,control)=>{const el=document.createElement("label");el.textContent=text;el.append(control);return el;};
    state.draft.questions.forEach((q,i)=>{
      const block=document.createElement("article");block.className="question-draft phase-three-question";
      const head=document.createElement("div");head.className="phase-three-question-heading";const title=document.createElement("h3");title.textContent="Question "+(i+1)+" · "+q.question_type.replaceAll("_"," ");
      const remove=document.createElement("button");remove.type="button";remove.className="btn btn-quiet";remove.textContent="Remove";remove.addEventListener("click",()=>{if(confirm("Remove question "+(i+1)+"?")){state.draft.questions.splice(i,1);renderDraft();}});head.append(title,remove);block.append(head);
      const prompt=document.createElement("textarea");prompt.rows=3;prompt.maxLength=3000;prompt.value=q.prompt||"";prompt.addEventListener("input",()=>{q.prompt=prompt.value;renderStudentPreview();});block.append(label("Question prompt",prompt));
      const url=document.createElement("input");url.type="url";url.placeholder="Optional HTTPS image URL";url.value=q.image_url||"";url.addEventListener("change",()=>{q.image_url=url.value.trim();q.image_preview_url=q.image_url;renderStudentPreview();});block.append(label("Reference image URL (optional)",url));
      const file=document.createElement("input");file.type="file";file.accept="image/png,image/jpeg,image/webp,image/gif";
      file.addEventListener("change",()=>{const f=file.files?.[0];if(!f)return;if(f.size>5*1024*1024){toast("Images must be 5 MB or smaller.","error");file.value="";return;}q.image_file=f;q.image_preview_url=URL.createObjectURL(f);renderStudentPreview();const img=block.querySelector(".question-image-preview");if(img)img.src=q.image_preview_url;else{const p=document.createElement("img");p.className="question-image-preview";p.src=q.image_preview_url;p.alt="Question image preview";block.append(p);}});
      block.append(label("Upload reference image · PNG/JPG/WEBP/GIF · max 5 MB",file));
      if(q.image_preview_url||q.image_url){const img=document.createElement("img");img.className="question-image-preview";img.src=q.image_preview_url||q.image_url;img.alt="Question image preview";block.append(img);}
      if(["multiple_choice","true_false"].includes(q.question_type)){
        const options=document.createElement("textarea");options.rows=4;options.value=(q.options||[]).join("\n");
        const answer=document.createElement("select");const draw=()=>{const old=q.correct_answer;answer.replaceChildren();(q.options||[]).forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;answer.append(o);});if((q.options||[]).includes(old))answer.value=old;else{answer.selectedIndex=0;q.correct_answer=answer.value||"";}};
        options.addEventListener("input",()=>{q.options=options.value.split("\n").map(v=>v.trim()).filter(Boolean);draw();});draw();answer.addEventListener("change",()=>q.correct_answer=answer.value);
        block.append(label("Answer options (one per line)",options),label("Correct answer",answer));
      }else if(["identification","short_answer","enumeration"].includes(q.question_type)){
        const answers=document.createElement("textarea");answers.rows=3;answers.placeholder=q.question_type==="enumeration"?"One expected item per line":"One accepted answer per line";answers.value=Array.isArray(q.correct_answer)?q.correct_answer.join("\n"):(q.correct_answer||"");
        answers.addEventListener("input",()=>{const v=answers.value.split("\n").map(x=>x.trim()).filter(Boolean);q.correct_answer=q.question_type==="enumeration"?v:(v.length>1?v:v[0]||"");});
        block.append(label(q.question_type==="enumeration"?"Expected items (one per line)":"Accepted answer(s), one per line",answers));
      }else{const note=document.createElement("p");note.className="notice";note.textContent="Essay answers are sent to the teacher for manual grading.";block.append(note);}
      const explanation=document.createElement("textarea");explanation.rows=2;explanation.value=q.explanation||"";explanation.addEventListener("input",()=>q.explanation=explanation.value);block.append(label("Explanation / marking notes",explanation));
      const points=document.createElement("input");points.type="number";points.min="1";points.max="100";points.value=q.points||1;points.addEventListener("input",()=>q.points=Number(points.value));block.append(label("Points",points));
      target.append(block);
    });
    const summary=document.createElement("p");summary.className="muted phase-three-summary";summary.textContent=state.draft.questions.length+" question(s) · Changes are saved when published.";target.prepend(summary);
  }
  function resetAssessmentAuthoring() {
    state.draft = null;
    state.previewQuestionIndex = 0;
    $("#json-assessment-title").value = "";
    $("#json-authoring-input").value = "";
    $("#publish-duration").value = "30";
    $("#exam-navigation-mode").value = "freeroam";
    $("#assessment-category").value = "quiz";
    $("#assessment-weight").value = "10";
    $("#assessment-weight").disabled = false;
    const weightLabel = $("#assessment-weight").closest("label");
    if (weightLabel) weightLabel.firstChild.textContent = "Relative weight within coursework (55%)";
    $("#assessment-category").value = "quiz";
    $("#import-json-file").value = "";
    $("#draft-questions").replaceChildren();
    $("#draft-panel").classList.add("hidden");
    $("#student-preview").innerHTML = '<div class="empty-state">Paste or import your next assessment to preview it.</div>';
    $("#json-validation-status").textContent = "Ready for a new assessment. Nothing is published until you select Publish assessment.";
    $("#json-validation-status").className = "notice";
    $("#student-preview-panel").classList.remove("hidden");
  }
  async function publishQuiz() {
    if (!state.draft?.questions?.length) return toast("Add at least one question before publishing.", "error");
    for(let i=0;i<state.draft.questions.length;i++){
      const q=state.draft.questions[i];q.position=i+1;q.prompt=String(q.prompt||"").trim();q.options=Array.isArray(q.options)?q.options.map(v=>String(v).trim()).filter(Boolean):[];q.points=Number(q.points)||1;
      if(!q.prompt)return toast("Question "+(i+1)+" needs a prompt.","error");
      if(["multiple_choice","true_false"].includes(q.question_type)){
        if(q.question_type==="multiple_choice"&&(q.options.length!==4||new Set(q.options).size!==4))return toast("Multiple choice requires four unique options.","error");
        if(q.question_type==="true_false"&&(q.options.length!==2||!q.options.includes("True")||!q.options.includes("False")))return toast("True/false requires True and False.","error");
        if(!q.options.includes(String(q.correct_answer||"")))return toast("Choose a valid correct answer.","error");
      }else if(["identification","short_answer"].includes(q.question_type)){
        const accepted=Array.isArray(q.correct_answer)?q.correct_answer:[String(q.correct_answer||"").trim()];q.correct_answer=accepted.map(x=>String(x).trim()).filter(Boolean);
        if(!q.correct_answer.length)return toast("Provide an accepted answer.","error");if(q.correct_answer.length===1)q.correct_answer=q.correct_answer[0];
      }else if(q.question_type==="enumeration"){
        q.correct_answer=(Array.isArray(q.correct_answer)?q.correct_answer:String(q.correct_answer||"").split("\n")).map(x=>String(x).trim()).filter(Boolean);
        if(q.correct_answer.length<2)return toast("Enumeration requires at least two expected items.","error");
      }else if(q.question_type==="essay")q.correct_answer=null;
      if(!Number.isInteger(q.points)||q.points<1||q.points>100)return toast("Points must be a whole number from 1 to 100.","error");
      if(q.image_file&&(!/^image\/(png|jpeg|webp|gif)$/.test(q.image_file.type)||q.image_file.size>5*1024*1024))return toast("Question image must be PNG/JPG/WEBP/GIF and no larger than 5 MB.","error");
    }
    const category=$("#assessment-category").value;
    const offeringId=$("#assessment-course-offering")?.value;
    if(!offeringId)return toast("Choose the course offering this assessment belongs to.","error");
    const duration=Number($("#publish-duration").value);
    if(!Number.isInteger(duration)||duration<1||duration>300)return toast("Exam duration must be between 1 and 300 whole minutes.","error");
    const weight=category==="midterm"?20:category==="final"?25:Number($("#assessment-weight").value);
    if(!Number.isFinite(weight)||weight<=0||weight>100)return toast("Coursework relative weight must be greater than 0 and no more than 100.","error");
    if(state.profile?.role!=="teacher")return toast("Only verified teachers can publish live assessments.","error");
    try {
      if(["midterm","final"].includes(category)){
        const {data:existing,error:existingError}=await state.supabase.from("exams").select("id,title")
          .eq("teacher_id",state.user.id).eq("course_offering_id",offeringId)
          .eq("assessment_category",category).eq("status","published");
        if(existingError)throw existingError;
        if(existing?.length){
          const old=existing.map(x=>"• "+x.title).join("\n");
          const label=category==="midterm"?"Midterm":"Final";
          if(!confirm("A published "+label+" examination already exists for this course:\n\n"+old+
            "\n\nPublish this new "+label+" examination and replace the existing one? The old exam will be archived and its submitted records preserved."))return;
        }
      }
      const {data:exam,error}=await state.supabase.from("exams").insert({
        teacher_id:state.user.id,course_offering_id:offeringId,
        title:state.draft.title||$("#json-assessment-title").value.trim(),
        duration_minutes:duration,exam_mode:state.draft.exam_mode||$("#exam-navigation-mode").value,
        assessment_category:category,grade_weight_percent:weight,status:"draft"
      }).select("id").single();
      if(error)throw error;
      const rows=[];
      for(const q of state.draft.questions){
        if(q.image_file){
          const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[q.image_file.type];
          const path=state.user.id+"/"+crypto.randomUUID()+"."+ext;
          const {error:uploadError}=await state.supabase.storage.from("assessment-question-images").upload(path,q.image_file,{upsert:false,contentType:q.image_file.type});
          if(uploadError)throw new Error("Question image upload failed: "+uploadError.message);
          q.image_url=state.supabase.storage.from("assessment-question-images").getPublicUrl(path).data.publicUrl;
        }
        rows.push({exam_id:exam.id,position:q.position,question_type:q.question_type,prompt:q.prompt,options:q.options||[],
          correct_answer:q.correct_answer??'',explanation:q.explanation,image_url:q.image_url||null,points:q.points||1});
      }
      const {error:questionError}=await state.supabase.from("questions").insert(rows);
      if(questionError){await state.supabase.from("exams").delete().eq("id",exam.id);throw questionError;}
      const {error:publishError}=await state.supabase.rpc("academix_teacher_publish_course_assessment",{p_exam_id:exam.id});
      if(publishError){await state.supabase.from("exams").delete().eq("id",exam.id);throw publishError;}
      resetAssessmentAuthoring();
      toast("Assessment published and assigned to the selected class. The authoring form is ready for the next assessment.","success");
      switchView("exams");
    }catch(e){toast(e.message||"Could not publish assessment.","error");}
  }
  async function startExam(exam) {
    if (state.profile?.role !== "student") return toast("Only student accounts can take assessments.", "error");
    if (!state.profile.verified_at) return toast("Your account is awaiting institutional verification.", "error");
    let fullscreenRequest=null;try{if(document.fullscreenEnabled&&document.documentElement.requestFullscreen)fullscreenRequest=document.documentElement.requestFullscreen();}catch(_){}
    state.integrityFullscreenRequested=true;
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
      document.body.classList.add("exam-active");$("#exam-view").classList.add("exam-integrity-active");installIntegrityMonitoring();
      if(fullscreenRequest)Promise.resolve(fullscreenRequest).catch(()=>toast("Full-screen mode was blocked by your browser. The attempt will still be monitored.","error"));else toast("Your browser does not support full-screen mode. The attempt will still be monitored.","error");
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
    } catch (e) { if(!state.currentExam&&document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen();}catch(_){}} state.integrityFullscreenRequested=false; toast(e.message || "Could not start exam.", "error"); }
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
  function logIntegrityEvent(type,details={}) {
    const id=state.currentExam?.submissionId;if(!id||!state.supabase)return;
    const now=Date.now();state.integrityLastEvents=state.integrityLastEvents||{};
    if(now-(state.integrityLastEvents[type]||0)<1800)return;state.integrityLastEvents[type]=now;
    state.supabase.rpc("academix_log_exam_integrity_event",{p_submission_id:id,p_event_type:type,p_details:details})
      .then(({error})=>{if(error)console.warn("Exam integrity event could not be saved:",error.message);});
  }
  function installIntegrityMonitoring() {
    if(state.integrityHandlersInstalled)return;state.integrityHandlersInstalled=true;
    document.addEventListener("visibilitychange",()=>{if(state.currentExam&&document.hidden)logIntegrityEvent("tab_hidden",{visibility_state:document.visibilityState});});
    document.addEventListener("fullscreenchange",()=>{if(state.currentExam&&state.integrityFullscreenRequested&&!document.fullscreenElement)logIntegrityEvent("fullscreen_exit",{reason:"fullscreen element exited"});});
    window.addEventListener("blur",()=>{if(state.currentExam)logIntegrityEvent("window_blur",{reason:"window lost focus"});});
  }
  async function stopIntegrityMonitoring() {
    document.body.classList.remove("exam-active");$("#exam-view")?.classList.remove("exam-integrity-active");
    state.integrityFullscreenRequested=false;state.currentExam=null;
    if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen();}catch(_){}}
  }

  function renderQuestion() {
    const q=state.currentQuestions[state.questionIndex],i=state.questionIndex,total=state.currentQuestions.length;if(!q)return;
    $("#progress-label").textContent="Question "+(i+1)+" of "+total;$("#progress-fill").style.width=((i+1)/total*100)+"%";
    $("#question-count-label").textContent=Object.keys(state.answers).length+" of "+total+" answered";
    const sequential=state.currentExam?.exam_mode==="sequential";$("#previous-question").disabled=i===0;
    $("#previous-question").classList.toggle("hidden",sequential);$("#question-navigator").parentElement.classList.toggle("hidden",sequential);
    $("#next-question").disabled=sequential&&state.answers[q.id]===undefined;$("#next-question").classList.toggle("hidden",i===total-1);$("#submit-exam").classList.toggle("hidden",i!==total-1);
    const target=$("#question-container");target.replaceChildren();
    const num=document.createElement("p");num.className="question-number";num.textContent="QUESTION "+String(i+1).padStart(2,"0");target.append(num);
    const type=document.createElement("p");type.className="eyebrow";type.textContent=String(q.question_type).replaceAll("_"," ").toUpperCase()+" · "+Number(q.points||1)+" POINTS";target.append(type);
    const title=document.createElement("h2");title.className="question-title";title.textContent=q.prompt;target.append(title);
    if(q.image_url){const img=document.createElement("img");img.className="question-reference-image";img.src=q.image_url;img.alt="Reference image for question "+(i+1);img.loading="lazy";target.append(img);}
    const setAnswer=value=>{if(value===undefined||value===null)delete state.answers[q.id];else state.answers[q.id]=value;$("#question-count-label").textContent=Object.keys(state.answers).length+" of "+total+" answered";$("#next-question").disabled=sequential&&state.answers[q.id]===undefined;renderQuestionNavigator();};
    if(["multiple_choice","true_false"].includes(q.question_type)){
      const list=document.createElement("div");list.className="answer-list";(q.options||[]).forEach(option=>{const label=document.createElement("label");label.className="answer-option";const input=document.createElement("input");input.type="radio";input.name="answer-"+q.id;input.value=option;input.checked=state.answers[q.id]===option;input.addEventListener("change",()=>setAnswer(option));const span=document.createElement("span");span.textContent=option;label.append(input,span);list.append(label);});target.append(list);
    }else if(["identification","short_answer"].includes(q.question_type)){
      const input=document.createElement("input");input.type="text";input.maxLength=2000;input.placeholder="Type your answer";input.value=String(state.answers[q.id]??"");input.addEventListener("input",()=>setAnswer(input.value.trim()?input.value:undefined));target.append(input);
    }else if(q.question_type==="enumeration"){
      const area=document.createElement("textarea");area.rows=5;area.placeholder="Enter one item per line";area.value=Array.isArray(state.answers[q.id])?state.answers[q.id].join("\n"):String(state.answers[q.id]??"");area.addEventListener("input",()=>{const values=area.value.split("\n").map(x=>x.trim()).filter(Boolean);setAnswer(values.length?values:undefined);});target.append(area);
    }else if(q.question_type==="essay"){
      const area=document.createElement("textarea");area.rows=10;area.maxLength=10000;area.placeholder="Write your response here";area.value=String(state.answers[q.id]??"");area.addEventListener("input",()=>setAnswer(area.value.trim()?area.value:undefined));target.append(area);
      const note=document.createElement("p");note.className="muted";note.textContent="Your essay will be reviewed and graded by your teacher.";target.append(note);
    }
    renderQuestionNavigator();if(window.MathJax?.typesetPromise)window.MathJax.typesetPromise([target]).catch(()=>{});
  }
  function renderQuestionNavigator() {
    const nav = $("#question-navigator"); if (!nav) return;
    nav.innerHTML = "";
    state.currentQuestions.forEach((q, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "question-jump"; b.textContent = String(i + 1);
      b.setAttribute("aria-label", `Go to question ${i + 1}`);
      if (state.answers[q.id] !== undefined) b.classList.add("answered");
      if (i === state.questionIndex) { b.classList.add("current"); b.setAttribute("aria-current", "step"); }
      b.addEventListener("click", () => { if(state.currentExam?.exam_mode==="sequential")return;state.questionIndex = i; renderQuestion(); }); nav.append(b);
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
      await stopIntegrityMonitoring();
      showOnly("#dashboard-view");
      const percentage = result && Number(result.max_score) > 0 ? (Number(result.score) / Number(result.max_score)) * 100 : null;
      const outcome = percentage == null ? "Submitted — awaiting grade" : percentage >= 75 ? "Passed" : "Failed";
      const scoreMessage = result?.requires_manual_grading ? "Exam submitted successfully. Your essay response is awaiting teacher review." : percentage == null ? "Exam submitted successfully. Your result will appear after grading." : `Exam submitted: ${result.score} / ${result.max_score} (${percentage.toFixed(2)}%). ${outcome}.`;
      toast(scoreMessage, "success");
      switchView("grades");
    } catch (e) {
      toast(`Submission failed: ${e.message}. Your attempt may remain in progress; retry submission when ready.`, "error");
      if (state.secondsLeft > 0) startTimer();
      else updateTimer();
    }
  }

  let academicDirectory={campuses:[],colleges:[],programs:[]};
  function fillAcademicSelect(selector,rows,label,placeholder){const el=$(selector);if(!el)return;el.replaceChildren();const first=document.createElement("option");first.value="";first.textContent=placeholder;el.append(first);rows.forEach(row=>{const o=document.createElement("option");o.value=row.id;o.textContent=label(row);el.append(o);});}
  async function loadAcademicDirectory(){
    if(state.profile?.role!=="admin")return;
    const [ca,co,pr]=await Promise.all([state.supabase.from("academic_campuses").select("id,campus_code,campus_name").eq("is_active",true).order("display_order"),state.supabase.from("academic_colleges").select("id,campus_id,college_code,college_name").eq("is_active",true).order("college_name"),state.supabase.from("academic_programs").select("id,college_id,program_code,program_name").eq("is_active",true).order("program_name")]);
    for(const r of [ca,co,pr])if(r.error)throw r.error;academicDirectory={campuses:ca.data||[],colleges:co.data||[],programs:pr.data||[]};
    fillAcademicSelect("#placement-campus",academicDirectory.campuses,x=>x.campus_name,"Choose campus");
    fillAcademicSelect("#grade-filter-campus",academicDirectory.campuses,x=>x.campus_name,"All campuses");
    fillAcademicSelect("#grade-filter-college",academicDirectory.colleges,x=>x.college_name,"All colleges");
    fillAcademicSelect("#grade-filter-program",academicDirectory.programs,x=>x.program_name+" ("+x.program_code+")","All programs");
    populatePlacementColleges();
  }
  function populatePlacementColleges(){const id=$("#placement-campus")?.value,rows=academicDirectory.colleges.filter(x=>!id||x.campus_id===id);fillAcademicSelect("#placement-college",rows,x=>x.college_name,"Choose college");$("#placement-college").disabled=!id;populatePlacementPrograms();}
  function populatePlacementPrograms(){const id=$("#placement-college")?.value,rows=academicDirectory.programs.filter(x=>!id||x.college_id===id);fillAcademicSelect("#placement-program",rows,x=>x.program_name+" ("+x.program_code+")","Choose program");$("#placement-program").disabled=!id;}
  async function loadUnassignedStudents(){
    if(state.profile?.role!=="admin")return;const status=$("#academic-placement-status"),list=$("#unassigned-student-list");if(!status||!list)return;
    status.textContent="Checking student accounts for missing academic placement…";
    try{const {data,error}=await state.supabase.rpc("academix_admin_list_unassigned_students");if(error)throw error;
      fillAcademicSelect("#placement-student",(data||[]).map(x=>({...x,id:x.student_id})),x=>(x.full_name||"Student")+" · "+(x.bu_id||x.email||x.student_id.slice(0,8)),"Choose unassigned student");
      status.textContent=(data||[]).length+" student account(s) need placement.";list.replaceChildren();
      (data||[]).slice(0,50).forEach(x=>{const row=document.createElement("div");row.className="grade-directory-row";const n=document.createElement("strong");n.textContent=x.full_name||"Student";const m=document.createElement("small");m.textContent=(x.bu_id||"No BU ID")+" · "+(x.email||"");row.append(n,m);list.append(row);});
      if(!(data||[]).length)list.textContent="All verified student accounts have complete academic placement.";
    }catch(e){status.textContent="Placement checker failed: "+e.message;}
  }
  async function forceAssignStudent(){
    const student=$("#placement-student").value,campus=$("#placement-campus").value,college=$("#placement-college").value,program=$("#placement-program").value,year=Number($("#placement-year").value),block=$("#placement-block").value.trim();
    if(!student||!campus||!college||!program||!year||!block)return toast("Complete all placement fields.","error");
    if(!confirm("Force-assign this student to the selected campus, college, course, year, and block? Existing grades and submissions are retained."))return;
    try{const {data,error}=await state.supabase.rpc("academix_admin_force_assign_student",{p_student_id:student,p_campus_id:campus,p_college_id:college,p_program_id:program,p_year_level:year,p_block_code:block});if(error)throw error;
      toast("Academic placement saved. "+Number(data?.enrollments_created||0)+" matching active course offering(s) enrolled.","success");$("#placement-student").value="";$("#placement-year").value="";$("#placement-block").value="";await loadUnassignedStudents();
    }catch(e){toast(e.message||"Could not assign student.","error");}
  }
  function renderGradeDirectory(target,rows,admin=false){
    target.replaceChildren();if(!rows?.length){target.innerHTML='<div class="empty-state">No grade records match this class filter.</div>';return;}
    rows.forEach(x=>{const row=document.createElement("article");row.className="grade-directory-row";const who=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("small");
      name.textContent=x.full_name||"Student";meta.textContent=(x.bu_id||"No BU ID")+(admin?" · "+[x.campus_name,x.college_name,x.program_name,x.year_level?x.year_level+" Year":null,x.block_code].filter(Boolean).join(" / "):" · "+[x.year_level?x.year_level+" Year":null,x.block_code].filter(Boolean).join(" "));
      who.append(name,meta);const course=document.createElement("div");course.textContent=(x.course_code||"Course")+" · "+(x.course_title||"");const exam=document.createElement("div");exam.textContent=x.record_type==="course_final"?"Final course grade":(x.exam_title||"Assessment");
      const score=document.createElement("div");score.textContent=Number(x.score).toFixed(2)+" / "+Number(x.max_score).toFixed(2)+" ("+Number(x.percentage).toFixed(2)+"%)"+(x.gwa_value==null?"":" · GWA "+Number(x.gwa_value).toFixed(2));row.append(who,course,exam,score);target.append(row);});
  }
  async function loadAdminGradeDirectory(){
    const status=$("#admin-grade-directory-status"),list=$("#admin-grade-directory-list");if(!status||!list||state.profile?.role!=="admin")return;
    const campus=$("#grade-filter-campus").value,college=$("#grade-filter-college").value,program=$("#grade-filter-program").value,year=$("#grade-filter-year").value,block=$("#grade-filter-block").value.trim();
    if(!campus||!college||!program||!year||!block){status.textContent="Select a campus, college, degree program, year level, and block before viewing grade records.";list.replaceChildren();return;}
    status.textContent="Loading grade records for this academic scope…";
    try{const {data,error}=await state.supabase.rpc("academix_admin_grade_directory",{p_campus_id:campus,p_college_id:college,p_program_id:program,p_year_level:Number(year),p_block_code:block,p_term_id:null});if(error)throw error;
      status.textContent=(data||[]).length+" grade record(s) found.";renderGradeDirectory(list,data||[],true);
    }catch(e){status.textContent="Could not load scoped grades: "+e.message;list.replaceChildren();}
  }
  async function loadTeacherGradeOfferings(){
    if(state.profile?.role!=="teacher")return;const select=$("#teacher-grade-offering");if(!select)return;
    try{const {data,error}=await state.supabase.from("course_offerings").select("id,section,year_level,block_code,academic_terms(academic_year,semester),academic_courses(course_code,course_title),academic_campuses(campus_name),academic_colleges(college_name),academic_programs(program_name)").eq("instructor_id",state.user.id);if(error)throw error;
      fillAcademicSelect("#teacher-grade-offering",data||[],x=>(x.academic_courses?.course_code||"Course")+" — "+(x.academic_courses?.course_title||"")+" · "+(x.academic_campuses?.campus_name||"Campus not set")+" · "+(x.academic_programs?.program_name||"Program not set")+" · "+(x.year_level?x.year_level+" Year":"Year not set")+" / "+(x.block_code||"Block not set")+" · "+x.section+" · "+(x.academic_terms?.academic_year||"")+" "+(x.academic_terms?.semester||""),"Choose assigned class");
      if(data?.length){select.value=data[0].id;await loadTeacherGradeDirectory();}
    }catch(e){$("#teacher-grade-directory-status").textContent="Could not load assigned classes: "+e.message;}
  }
  async function loadTeacherGradeDirectory(){
    const id=$("#teacher-grade-offering")?.value,status=$("#teacher-grade-directory-status"),list=$("#teacher-grade-directory-list");if(!id||!status||!list)return;
    status.textContent="Loading grades for your assigned class…";
    try{const [{data,error},{data:events,error:eventError},{data:reviews,error:reviewError}]=await Promise.all([state.supabase.rpc("academix_teacher_grade_directory",{p_offering_id:id}),state.supabase.rpc("academix_teacher_integrity_events",{p_offering_id:id}),state.supabase.rpc("academix_teacher_pending_manual_reviews",{p_offering_id:id})]);if(error)throw error;
      status.textContent=(data||[]).length+" grade record(s) in this class.";renderGradeDirectory(list,data||[]);
      const panel=document.createElement("section"),h=document.createElement("h3"),note=document.createElement("p");panel.className="integrity-events-panel";h.textContent="Exam integrity activity";note.className="muted";note.textContent="Tab changes, focus loss, and full-screen exits are review signals, not proof of misconduct.";panel.append(h,note);
      if(eventError){const e=document.createElement("p");e.textContent="Integrity events unavailable: "+eventError.message;panel.append(e);}
      else if(!(events||[]).length){const e=document.createElement("p");e.className="muted";e.textContent="No integrity events recorded for this class.";panel.append(e);}
      else (events||[]).forEach(v=>{const e=document.createElement("p");e.textContent=v.student_name+" · "+v.event_type.replaceAll("_"," ")+" · "+new Date(v.occurred_at).toLocaleString();panel.append(e);});list.append(panel);
      const reviewsPanel=document.createElement("section");reviewsPanel.className="integrity-events-panel";const rh=document.createElement("h3");rh.textContent="Essay responses awaiting review";reviewsPanel.append(rh);
      if(reviewError){const e=document.createElement("p");e.textContent="Manual review queue unavailable: "+reviewError.message;reviewsPanel.append(e);}
      else if(!(reviews||[]).length){const e=document.createElement("p");e.className="muted";e.textContent="No essay submissions are awaiting review.";reviewsPanel.append(e);}
      else (reviews||[]).forEach(review=>{const card=document.createElement("article");card.className="question-draft";const title=document.createElement("h4");title.textContent=review.student_name+" · "+review.exam_title;card.append(title);
        (review.questions||[]).filter(q=>q.question_type==="essay").forEach(q=>{const prompt=document.createElement("p");prompt.textContent=q.prompt;const answer=document.createElement("blockquote");answer.textContent=String(review.answers?.[q.id]||"No response");card.append(prompt,answer);});
        const score=document.createElement("input");score.type="number";score.min="0";score.max=String(review.max_score);score.step="0.01";score.value=String(review.auto_score||0);
        const feedback=document.createElement("textarea");feedback.rows=2;feedback.maxLength=1000;feedback.placeholder="Feedback (optional)";
        const label=document.createElement("label");label.textContent="Final score including objective answers · max "+review.max_score;label.append(score);
        const feedbackLabel=document.createElement("label");feedbackLabel.textContent="Feedback";feedbackLabel.append(feedback);
        const save=document.createElement("button");save.type="button";save.className="btn btn-primary";save.textContent="Save final grade";
        save.addEventListener("click",async()=>{const n=Number(score.value);if(!Number.isFinite(n)||n<0||n>Number(review.max_score))return toast("Score must be within the maximum points.","error");save.disabled=true;try{const {error}=await state.supabase.rpc("academix_teacher_grade_submission",{p_submission_id:review.submission_id,p_score:n,p_feedback:feedback.value.trim()});if(error)throw error;toast("Essay response graded.","success");await loadTeacherGradeDirectory();}catch(e){toast(e.message,"error");save.disabled=false;}});
        card.append(label,feedbackLabel,save);reviewsPanel.append(card);});list.append(reviewsPanel);
    }catch(e){status.textContent="Could not load class grades: "+e.message;}
  }

  async function loadPhase8Admin() {
    const status=$("#phase8-admin-status"), records=$("#phase8-admin-records");
    if(!status||!records)return;
    status.textContent="Loading academic configuration…";
    try {
      const [termsR,coursesR,offeringsR,bandsR,peopleR,campusesR,collegesR,programsR]=await Promise.all([
        state.supabase.from("academic_terms").select("id,academic_year,semester,starts_on,ends_on,is_active").order("starts_on",{ascending:false}),
        state.supabase.from("academic_courses").select("id,course_code,course_title,units").order("course_code"),
        state.supabase.from("course_offerings").select("id,term_id,course_id,instructor_id,section").order("created_at",{ascending:false}),
        state.supabase.from("term_grade_bands").select("term_id,label,min_percentage,max_percentage,gwa_value").order("min_percentage"),
        state.supabase.rpc("academix_admin_list_people"),
        state.supabase.from("academic_campuses").select("id,campus_code,campus_name").eq("is_active",true).order("display_order"),
        state.supabase.from("academic_colleges").select("id,campus_id,college_name").eq("is_active",true).order("college_name"),
        state.supabase.from("academic_programs").select("id,college_id,program_name,program_code").eq("is_active",true).order("program_name")
      ]);
      for(const r of [termsR,coursesR,offeringsR,bandsR,peopleR,campusesR,collegesR,programsR])if(r.error)throw r.error;
      const terms=termsR.data||[],courses=coursesR.data||[],offerings=offeringsR.data||[],bands=bandsR.data||[],people=peopleR.data||[];
      const campusRows=campusesR.data||[],collegeRows=collegesR.data||[],programRows=programsR.data||[];
      academicDirectory={campuses:campusRows,colleges:collegeRows,programs:programRows};
      const fill=(selector,items,label,placeholder)=>{const el=$(selector);if(!el)return;el.replaceChildren();const first=document.createElement("option");first.value="";first.textContent=placeholder;el.append(first);items.forEach(item=>{const o=document.createElement("option");o.value=item.id;o.textContent=label(item);el.append(o);});};
      fill("#phase8-offering-campus",campusRows,x=>x.campus_name,"Select campus");
      fill("#phase8-offering-college",collegeRows,x=>x.college_name,"Select college");
      fill("#phase8-offering-program",programRows,x=>x.program_name+" ("+x.program_code+")","Select program");
      $("#phase8-offering-college").disabled=true;$("#phase8-offering-program").disabled=true;
      fill("#phase8-offering-term",terms,t=>t.academic_year+" / "+t.semester+(t.is_active?" (active)":""),"Select academic term");
      fill("#phase8-band-term",terms,t=>t.academic_year+" / "+t.semester,"Select academic term");
      fill("#phase8-offering-course",courses,c=>c.course_code+" — "+c.course_title,"Select course");
      fill("#phase8-enrollment-offering",offerings,o=>{const c=courses.find(x=>x.id===o.course_id),t=terms.find(x=>x.id===o.term_id);return (c?.course_code||"Course")+" / "+(t?.academic_year||"Term")+" / "+o.section+" / "+o.id.slice(0,8);},"Select offering");
      fill("#phase8-instructor-id",people.filter(p=>p.role==="teacher"),p=>(p.full_name||"Teacher")+" · "+(p.bu_id||p.id.slice(0,8)),"Select verified instructor");
      fill("#phase8-student-id",people.filter(p=>p.role==="student"),p=>(p.full_name||"Student")+" · "+(p.bu_id||p.id.slice(0,8)),"Select verified student");
      records.replaceChildren();
      const summary=document.createElement("p");summary.textContent=terms.length+" term(s), "+courses.length+" course(s), "+offerings.length+" offering(s) configured.";records.append(summary);
      const list=document.createElement("div");list.className="phase8-record-list";
      offerings.forEach(o=>{const c=courses.find(x=>x.id===o.course_id),t=terms.find(x=>x.id===o.term_id),teacher=people.find(p=>p.id===o.instructor_id);const row=document.createElement("div");row.className="phase8-record-row";row.textContent=(c?.course_code||"Course")+" — "+(c?.course_title||"")+" · "+(t?.academic_year||"")+" "+(t?.semester||"")+" · "+o.section+" · Instructor: "+(teacher?.full_name||"Assigned teacher");list.append(row);});
      records.append(list);

      // The catalog-level delete action intentionally removes every offering
      // for this subject across all terms, including linked exams and grades.
      const subjectRecords=$("#phase8-course-records");
      if(subjectRecords){
        subjectRecords.replaceChildren();
        if(!courses.length){
          subjectRecords.textContent="No subjects are currently configured.";
        }else{
          courses.forEach(course=>{
            const courseOfferings=offerings.filter(o=>o.course_id===course.id);
            const row=document.createElement("article");
            row.className="phase8-record-row phase8-subject-record";
            const details=document.createElement("div");
            const name=document.createElement("strong");
            name.textContent=course.course_code+" — "+course.course_title;
            const meta=document.createElement("small");
            meta.textContent=Number(course.units).toFixed(1)+" credit units · "+courseOfferings.length+" class offering(s) across all terms";
            details.append(name,meta);
            const del=document.createElement("button");
            del.type="button";
            del.className="btn btn-danger phase8-subject-delete";
            del.textContent="Delete subject";
            del.addEventListener("click",async()=>{
              const warning="PERMANENT SUBJECT DELETION\n\n"+
                course.course_code+" — "+course.course_title+"\n\n"+
                "This removes the subject from the catalog and permanently deletes ALL its class offerings across every academic term, student enrollments, course final grades, linked exams, exam submissions, assessment grades, questions, assignments, retake authorizations, and integrity records.\n\n"+
                "This cannot be undone. Continue?";
              if(!window.confirm(warning))return;
              const typed=window.prompt("To confirm permanent deletion, type DELETE exactly.\n\nSubject: "+course.course_code);
              if(typed!=="DELETE"){if(typed!==null)toast("Deletion cancelled: confirmation did not match.","error");return;}
              del.disabled=true;del.textContent="Deleting…";
              try{
                const {data,error}=await state.supabase.rpc("academix_admin_delete_subject",{
                  p_course_id:course.id,p_confirmation:"DELETE"
                });
                if(error)throw error;
                toast("Subject deleted. Removed "+(data.offerings_deleted||0)+" offering(s), "+(data.enrollments_deleted||0)+" enrollment(s), "+(data.exams_deleted||0)+" exam(s), "+(data.assessment_grades_deleted||0)+" assessment grade(s), and "+(data.final_course_grades_deleted||0)+" final course grade(s).","success");
                await loadPhase8Admin();
              }catch(error){
                del.disabled=false;del.textContent="Delete subject";
                toast("Subject was not deleted: "+(error.message||"Database operation failed."),"error");
              }
            });
            row.append(details,del);subjectRecords.append(row);
          });
        }
      }
      const bandSummary=document.createElement("p");bandSummary.textContent=bands.length+" grading conversion band(s) configured.";records.append(bandSummary);
      const progress=$("#phase8-evaluation-progress");if(progress){progress.replaceChildren();const active=terms.find(t=>t.is_active);if(!active){progress.textContent="No active academic term."; }else{const {data:rows,error:progressError}=await state.supabase.rpc("academix_admin_evaluation_progress",{p_term_id:active.id});if(progressError)throw progressError;if(!rows?.length)progress.textContent="No instructor evaluation targets have been created for the active term.";else rows.forEach(x=>{const row=document.createElement("div");row.className="phase8-record-row";row.textContent=x.instructor_name+" — "+x.completed_count+"/"+x.student_count+" completed ("+x.completion_percent+"%)";progress.append(row);});}}
      status.textContent="Academic configuration loaded. Use the forms to add or update records.";
    } catch(e){status.textContent="Could not load academic configuration: "+(e.message||"Unknown database error.");records.textContent="Check administrator verification, table permissions, RLS policies, and the database error above; then refresh.";}
  }
  async function savePhase8Rpc(fn,args,success) {
    const {data,error}=await state.supabase.rpc(fn,args);if(error)throw error;
    toast(success,"success");await loadPhase8Admin();return data;
  }
  async function loadTeacherPhase8Offerings() {
    const select=$("#phase8-teacher-offering"),target=$("#phase8-teacher-roster"),authoring=$("#assessment-course-offering");
    if(!select||!target)return;
    try{
      const {data,error}=await state.supabase.from("course_offerings")
        .select("id,section,academic_terms(academic_year,semester),academic_courses(course_code,course_title)")
        .eq("instructor_id",state.user.id);
      if(error)throw error;
      const offerings=data||[];
      const label=o=>(o.academic_courses?.course_code||"Course")+" — "+(o.academic_courses?.course_title||"")+" · "+(o.academic_terms?.academic_year||"")+" "+(o.academic_terms?.semester||"")+" · "+o.section;
      select.replaceChildren();const first=document.createElement("option");first.value="";first.textContent="Choose an assigned class";select.append(first);
      offerings.forEach(o=>{const opt=document.createElement("option");opt.value=o.id;opt.textContent=label(o);select.append(opt);});
      if(authoring){const keep=authoring.value;authoring.replaceChildren();const prompt=document.createElement("option");prompt.value="";prompt.textContent="Choose the class for this assessment";authoring.append(prompt);offerings.forEach(o=>{const opt=document.createElement("option");opt.value=o.id;opt.textContent=label(o);authoring.append(opt);});if(offerings.some(o=>o.id===keep))authoring.value=keep;}
      target.textContent=offerings.length?"Select a class to load its roster.":"No course offerings are assigned to your account yet.";
      if(offerings.length)await loadTeacherPhase8Roster();
    }catch(e){target.textContent="Could not load course offerings: "+e.message;}
  }
  async function loadTeacherPhase8Roster(){
    const offering=$("#phase8-teacher-offering")?.value,target=$("#phase8-teacher-roster");if(!target)return;
    if(!offering){target.textContent="Choose an assigned course to load its roster.";return;}
    target.textContent="Loading enrolled students and weighted grade calculations…";
    try{
      const [{data,error},{data:summary,error:summaryError}]=await Promise.all([
        state.supabase.rpc("academix_teacher_roster",{p_offering_id:offering}),
        state.supabase.rpc("academix_teacher_assessment_grade_summary",{p_offering_id:offering})
      ]);
      if(error)throw error;
      if(summaryError)console.warn("Weighted grade summary unavailable:",summaryError.message);
      const summaryByStudent=new Map((summary||[]).map(x=>[x.enrollment_id,x]));
      const ids=(data||[]).map(x=>x.enrollment_id);
      let statusRows=[],outcomesAvailable=true;
      if(ids.length){const sr=await state.supabase.from("course_enrollment_statuses").select("enrollment_id,outcome,drop_requested_at").in("enrollment_id",ids);if(sr.error){outcomesAvailable=false;console.warn("Course outcome controls unavailable:",sr.error.message);}else statusRows=sr.data||[];}
      const statuses=new Map(statusRows.map(x=>[x.enrollment_id,x]));
      target.replaceChildren();
      if(!data?.length){target.textContent="No students are enrolled in this offering.";return;}
      data.forEach(student=>{
        const current=statuses.get(student.enrollment_id)||{outcome:"active",drop_requested_at:null};
        const computed=summaryByStudent.get(student.enrollment_id);
        const row=document.createElement("form");row.className="phase8-grade-row";
        const info=document.createElement("div"),name=document.createElement("strong"),id=document.createElement("small");
        name.textContent=student.student_name;id.textContent=(student.bu_id||"No BU ID")+" · "+student.student_id;info.append(name,id);
        const breakdown=document.createElement("div");breakdown.className="weighted-grade-breakdown";
        const gwaText=value=>value==null?"Pending":Number(value).toFixed(2);
        const pctText=value=>value==null?"Pending":Number(value).toFixed(2)+"%";
        const items=[
          ["Midterm GWA",gwaText(computed?.midterm_gwa),pctText(computed?.midterm_percentage)],
          ["Final exam GWA",gwaText(computed?.final_gwa),pctText(computed?.final_percentage)],
          ["Coursework (55%)",pctText(computed?.coursework_percentage),computed?.missing_coursework_assessments?computed.missing_coursework_assessments+" assessment(s) ungraded":"All published coursework graded"],
          ["Computed final",pctText(computed?.computed_final_percentage),computed?.computed_final_gwa==null?"GWA pending":"GWA "+gwaText(computed.computed_final_gwa)]
        ];
        items.forEach(([label,value,note])=>{const item=document.createElement("div");item.className="weighted-grade-item";const small=document.createElement("small");small.textContent=label;const strong=document.createElement("strong");strong.textContent=value;const hint=document.createElement("span");hint.textContent=note;item.append(small,strong,hint);breakdown.append(item);});
        const grade=document.createElement("input");grade.type="number";grade.min="0";grade.max="100";grade.step="0.01";grade.required=true;grade.placeholder="Final computed %";
        grade.value=student.percentage??computed?.computed_final_percentage??"";
        const remarks=document.createElement("input");remarks.type="text";remarks.maxLength=1000;remarks.placeholder="Remarks (optional)";remarks.value=student.remarks||"";
        const save=document.createElement("button");save.className="btn btn-primary";save.type="submit";save.textContent="Assign final course grade";
        const tools=document.createElement("div");tools.className="course-outcome-tools";
        const badge=document.createElement("span");badge.className="result-status "+(current.outcome==="inc"?"status-inc":current.outcome==="drp"?"status-drp":current.outcome==="passed"?"status-passed":current.outcome==="failed"?"status-failed":"status-pending");badge.textContent=current.outcome==="inc"?"INC":current.outcome==="drp"?"DRP":current.outcome==="passed"?"Passed":current.outcome==="failed"?"Failed":"In progress";
        const request=document.createElement("small");request.className="muted";request.textContent=current.drop_requested_at&&current.outcome!=="drp"?"Student requested DRP — approval pending":current.outcome==="drp"?"Drop approved":" ";
        tools.append(badge,request);
        if(outcomesAvailable){
          const outcome=document.createElement("select");outcome.setAttribute("aria-label","Course outcome for "+student.student_name);
          [["active","In progress"],["inc","INC — Allow compliance"],["drp","DRP — Approve drop"]].forEach(([v,label])=>{const opt=document.createElement("option");opt.value=v;opt.textContent=label;outcome.append(opt);});
          outcome.value=["active","inc","drp"].includes(current.outcome)?current.outcome:"active";
          const apply=document.createElement("button");apply.type="button";apply.className="btn btn-quiet";apply.textContent="Apply outcome";apply.disabled=outcome.value==="drp"&&!current.drop_requested_at;
          outcome.addEventListener("change",()=>{apply.disabled=outcome.value==="drp"&&!current.drop_requested_at;});
          apply.addEventListener("click",async()=>{apply.disabled=true;try{const {error}=await state.supabase.rpc("academix_teacher_set_course_outcome",{p_enrollment_id:student.enrollment_id,p_outcome:outcome.value});if(error)throw error;toast(outcome.value==="inc"?"Student marked INC.":outcome.value==="drp"?"Student drop approved.":"Course returned to in progress.","success");await loadTeacherPhase8Roster();}catch(err){toast(err.message,"error");apply.disabled=false;}});
          tools.append(outcome,apply);
        }
        row.append(info,breakdown,grade,remarks,save,tools);
        row.addEventListener("submit",async e=>{e.preventDefault();save.disabled=true;try{
          const percentage=Number(grade.value);
          const {error}=await state.supabase.rpc("academix_teacher_set_final_grade",{p_enrollment_id:student.enrollment_id,p_percentage:percentage,p_remarks:remarks.value||null});
          if(error)throw error;
          toast(percentage>=75?"Final course grade saved — Passed (75% or above).":"Final course grade saved — Failed (below 75%).","success");
          await loadTeacherPhase8Roster();
        }catch(err){toast(err.message,"error");save.disabled=false;}});
        target.append(row);
      });
    }catch(e){target.textContent="Could not load roster: "+e.message;}
  }
  async function loadStudentCourseOutcomes(){
    const status=$("#student-course-status"),target=$("#student-course-list");if(!status||!target||state.profile?.role!=="student")return;
    status.textContent="Loading your enrolled courses…";target.replaceChildren();
    try{
      const {data,error}=await state.supabase.rpc("academix_student_course_outcomes");if(error)throw error;
      if(!data?.length){status.textContent="No enrolled courses were found for the active academic term.";return;}
      status.textContent=data.length+" enrolled course(s) in the active term.";
      data.forEach(course=>{
        const row=document.createElement("article");row.className="student-course-row";
        const info=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("small");
        title.textContent=course.course_code+" — "+course.course_title;meta.textContent="Section "+course.section;info.append(title,meta);
        const actions=document.createElement("div");actions.style.display="flex";actions.style.alignItems="center";actions.style.gap="10px";actions.style.flexWrap="wrap";
        const outcome=course.outcome||"active";
        const badge=document.createElement("span");badge.className="result-status "+(outcome==="inc"?"status-inc":outcome==="drp"?"status-drp":outcome==="passed"?"status-passed":outcome==="failed"?"status-failed":"status-pending");badge.textContent=outcome==="inc"?"INC":outcome==="drp"?"DRP":outcome==="passed"?"Passed":outcome==="failed"?"Failed":"In progress";
        actions.append(badge);
        if(outcome!=="drp"){
          if(course.drop_requested){const pending=document.createElement("small");pending.className="muted";pending.textContent="DRP request pending teacher approval";actions.append(pending);}
          else{
            const request=document.createElement("button");request.type="button";request.className="btn btn-quiet";request.textContent="Request to drop";
            request.addEventListener("click",async()=>{if(!confirm("Send a request to drop "+course.course_code+"? Your teacher must approve it before the status becomes DRP."))return;request.disabled=true;try{const {error}=await state.supabase.rpc("academix_student_request_course_drop",{p_enrollment_id:course.enrollment_id});if(error)throw error;toast("Drop request sent to your instructor.","success");await loadStudentCourseOutcomes();}catch(err){toast(err.message,"error");request.disabled=false;}});
            actions.append(request);
          }
        }else{const approved=document.createElement("small");approved.className="muted";approved.textContent="Drop approved by instructor";actions.append(approved);}
        row.append(info,actions);target.append(row);
      });
    }catch(e){status.textContent="Course outcomes are unavailable. Apply the final launch database migration, then refresh. "+e.message;}
  }
  async function loadStudentEvaluations(){
    const status=$("#phase8-evaluation-status"),target=$("#phase8-evaluation-list");if(!status||!target)return;
    status.textContent="Loading your assigned instructors…";target.replaceChildren();
    try{
      const {data,error}=await state.supabase.rpc("academix_student_evaluation_targets");if(error)throw error;
      if(!data?.length){status.textContent="No active-term course enrollments were found. Contact your administrator if you believe this is incorrect.";return;}
      const done=data.filter(x=>x.submitted).length;status.textContent=done+" of "+data.length+" instructor evaluation(s) completed.";
      data.forEach(item=>{
        const card=document.createElement("article");card.className="phase8-evaluation-card";
        const title=document.createElement("h3");title.textContent=item.instructor_name;
        const courses=document.createElement("p");courses.className="muted";courses.textContent=item.courses||"Assigned course(s)";
        const statusText=document.createElement("span");statusText.className="badge "+(item.submitted?"badge-success":"badge-warning");statusText.textContent=item.submitted?"Completed":"Required";
        card.append(title,courses,statusText);
        if(!item.submitted){
          const form=document.createElement("form");form.className="phase8-evaluation-form";
          const criteria=[["clarity","Explains course concepts clearly"],["preparedness","Comes prepared and organized"],["engagement","Encourages participation and learning"],["feedback","Provides useful feedback"]];
          const fields=[];
          criteria.forEach(([key,label])=>{const wrap=document.createElement("label");wrap.textContent=label;const select=document.createElement("select");select.required=true;select.innerHTML='<option value="">Select rating</option><option value="5">5 — Excellent</option><option value="4">4 — Very good</option><option value="3">3 — Good</option><option value="2">2 — Needs improvement</option><option value="1">1 — Poor</option>';wrap.append(select);fields.push([key,select]);form.append(wrap);});
          const submit=document.createElement("button");submit.type="submit";submit.className="btn btn-primary";submit.textContent="Submit confidential evaluation";form.append(submit);
          form.addEventListener("submit",async e=>{e.preventDefault();if(fields.some(([,el])=>!el.value))return toast("Complete all four ratings before submitting.","error");if(!confirm("Submit this confidential evaluation? You cannot edit it after submission."))return;submit.disabled=true;try{const ratings=Object.fromEntries(fields.map(([key,el])=>[key,Number(el.value)]));const {error}=await state.supabase.rpc("academix_student_submit_instructor_evaluation",{p_term_id:item.term_id,p_instructor_id:item.instructor_id,p_ratings:ratings});if(error)throw error;toast("Confidential evaluation submitted.","success");await loadStudentEvaluations();}catch(err){toast(err.message,"error");submit.disabled=false;}});
          card.append(form);
        }
        target.append(card);
      });
    }catch(e){status.textContent="Could not load evaluations. "+e.message;}
  }
  async function loadSemesterGwa(){
    const panel=$("#phase8-gwa-panel"),target=$("#phase8-gwa-content");if(!panel||!target||state.profile?.role!=="student")return;
    panel.classList.remove("hidden");target.textContent="Checking semester GWA eligibility…";
    try{
      const {data,error}=await state.supabase.rpc("academix_student_semester_gwa");if(error)throw error;
      target.replaceChildren();
      if(data?.locked){
        const message=document.createElement("p");message.className="notice";message.textContent=data.reason||"Your final GWA is currently locked.";
        target.append(message);
        if(data.missing_evaluations?.length){const list=document.createElement("ul");data.missing_evaluations.forEach(x=>{const li=document.createElement("li");li.textContent=x.instructor_name+" — evaluation required";list.append(li);});target.append(list);const go=document.createElement("button");go.type="button";go.className="btn btn-primary";go.textContent="Complete instructor evaluations";go.addEventListener("click",()=>switchView("evaluations"));target.append(go);}
        return;
      }
      const heading=document.createElement("div");heading.className="phase8-gwa-result";
      const term=document.createElement("p");term.className="eyebrow";term.textContent="FINAL GWA · "+(data.total_units||0)+" CREDIT UNITS";
      const score=document.createElement("strong");score.textContent=Number(data.gwa).toFixed(2);
      heading.append(term,score);target.append(heading);
      const list=document.createElement("div");list.className="phase8-record-list";
      (data.courses||[]).forEach(c=>{const row=document.createElement("div");row.className="phase8-record-row";row.textContent=c.course_code+" — "+c.course_title+" · "+c.units+" units · "+c.percentage+"% → GWA "+c.gwa;list.append(row);});target.append(list);
    }catch(e){target.textContent="Final GWA could not be loaded: "+e.message+" Check student verification, course enrollment, and database permissions.";}
  }

  async function loadGrades() {
    const target=$("#grades-list");
    if(state.profile?.role==="admin"){target.classList.add("hidden");$("#admin-grade-directory")?.classList.remove("hidden");$("#teacher-grade-directory")?.classList.add("hidden");await loadAcademicDirectory();await loadAdminGradeDirectory();return;}
    if(state.profile?.role==="teacher"){target.classList.add("hidden");$("#admin-grade-directory")?.classList.add("hidden");$("#teacher-grade-directory")?.classList.remove("hidden");await loadTeacherGradeOfferings();return;}
    $("#admin-grade-directory")?.classList.add("hidden");$("#teacher-grade-directory")?.classList.add("hidden");target.classList.remove("hidden");target.innerHTML='<div class="empty-state">Loading grades…</div>';
    try{const {data,error}=await state.supabase.from("grades").select("id,score,max_score,feedback,created_at,exams(title)").order("created_at",{ascending:false});if(error)throw error;target.innerHTML="";
      if(!data?.length)target.innerHTML='<div class="empty-state">No graded assessment submissions yet.</div>';
      (data||[]).forEach(g=>{const row=document.createElement("div");row.className="grade-row";const name=document.createElement("div"),b=document.createElement("b"),small=document.createElement("small");b.textContent=g.exams?.title||"Assessment";small.textContent=new Date(g.created_at).toLocaleString();name.append(b,small);
        const score=document.createElement("div");score.className="score";score.textContent=g.score+" / "+g.max_score;const pct=Number(g.max_score)>0?Number(g.score)/Number(g.max_score)*100:null;
        const status=document.createElement("span");status.className="result-status "+(pct==null?"status-pending":pct>=75?"status-passed":"status-failed");status.textContent=pct==null?"Awaiting grade":pct>=75?"Passed":"Failed";
        const detail=document.createElement("small");detail.className="muted";detail.textContent=(pct==null?"":pct.toFixed(2)+"%")+(g.feedback?" · "+g.feedback:"");name.append(detail);row.append(name,score,status);target.append(row);});
      await loadStudentCourseOutcomes();await loadSemesterGwa();
    }catch(e){target.innerHTML='<div class="empty-state">Could not load grades. Check your Supabase policies.</div>';toast(e.message,"error");}
  }
  async function exportGrades() {
    try {
      const offeringId=$("#teacher-grade-offering")?.value;
      if(!offeringId)return toast("Select one assigned class before exporting its grades.","error");
      const {data,error}=await state.supabase.rpc("academix_teacher_grade_directory",{p_offering_id:offeringId});
      if(error)throw error;
      const cols=["student_id","student_name","bu_id","year_level","block","course_code","course_title","grade_type","assessment","score","max_score","percentage","gwa","graded_at"];
      const esc=v=>'"'+String(v??"").replaceAll('"','""')+'"';
      const lines=[cols.join(","),...(data||[]).map(g=>[g.student_id,g.full_name,g.bu_id,g.year_level,g.block_code,g.course_code,g.course_title,g.record_type,g.exam_title,g.score,g.max_score,g.percentage,g.gwa_value,g.graded_at].map(esc).join(","))];
      const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="academix-grades-"+String(offeringId).slice(0,8)+"-"+new Date().toISOString().slice(0,10)+".csv";a.click();URL.revokeObjectURL(url);
    }catch(e){toast(e.message||"Could not export grades.","error");}
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
      const pct=Number(sub.max_score)>0?(Number(sub.score)/Number(sub.max_score))*100:null;
      const badge=document.createElement("span");
      badge.className="result-status "+(pct==null?"status-pending":pct>=75?"status-passed":"status-failed");
      badge.textContent=pct==null?(sub.status||"Submitted"):(pct>=75?"Passed":"Failed");
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

  // Phase 6: read-only operational checks and browser-local UI preferences.
  function renderPlatformBuildInfo() {
    const build = window.ACADEMIX_BUILD || {};
    $("#platform-build-environment").textContent = build.environment || APP_ENVIRONMENT;
    $("#platform-build-version").textContent = build.version || "Not supplied";
    const commit = String(build.commit || "").trim();
    $("#platform-build-commit").textContent = commit ? commit.slice(0, 12) : "Not supplied by deployment";
    const builtAt = build.builtAt ? new Date(build.builtAt) : null;
    $("#platform-build-time").textContent = builtAt && !Number.isNaN(builtAt.getTime())
      ? builtAt.toLocaleString()
      : "Not supplied by deployment";
    const branch = String(build.branch || "").trim();
    const branchTarget = $("#platform-build-branch");
    if (branchTarget) branchTarget.textContent = branch || "Not supplied by deployment";
  }
  function renderPlatformHealth(items, checkedAt) {
    const target = $("#platform-health-status");
    if (!target) return;
    target.replaceChildren();
    items.forEach(item => {
      const row = document.createElement("div"); row.className = "platform-health-row";
      const label = document.createElement("span"); label.textContent = item.label;
      const value = document.createElement("b"); value.className = "platform-state " + (item.state === "available" ? "state-available" : item.state === "degraded" ? "state-degraded" : "state-unknown");
      value.textContent = item.state === "available" ? "Available" : item.state === "degraded" ? "Degraded" : "Unknown";
      row.append(label, value); target.append(row);
      if (item.detail) { const detail = document.createElement("small"); detail.className = "platform-health-detail"; detail.textContent = item.detail; target.append(detail); }
    });
    $("#platform-health-checked").textContent = "Last checked: " + checkedAt.toLocaleString();
  }
  async function loadPlatformHealth() {
    if (state.profile?.role !== "admin") return toast("Developer access is required.", "error");
    const button = $("#refresh-platform-status");
    if (button) button.disabled = true;
    const checkedAt = new Date(), results = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(SUPABASE_URL + "/auth/v1/health", { method: "GET", headers: { apikey: SUPABASE_ANON_KEY }, signal: controller.signal, cache: "no-store" });
      results.push({ label: "Authentication API", state: response.ok ? "available" : "degraded", detail: "Health endpoint responded with HTTP " + response.status + "." });
    } catch (error) {
      results.push({ label: "Authentication API", state: "unknown", detail: error.name === "AbortError" ? "Request timed out; provider status is unknown." : "Browser/network request failed; provider status is unknown." });
    } finally { clearTimeout(timeout); }
    try {
      const { error } = await state.supabase.from("profiles").select("id").eq("id", state.user.id).limit(1);
      if (error) throw error;
      results.push({ label: "Database access", state: "available", detail: "Authenticated profile read succeeded under current database policies." });
    } catch (error) {
      results.push({ label: "Database access", state: "degraded", detail: "Authenticated profile read failed: " + String(error.message || "request error").slice(0, 180) });
    }
    renderPlatformHealth(results, checkedAt);
    if (button) button.disabled = false;
  }
  function initPlatformFlags() {
    const read = key => { try { return localStorage.getItem("academix.ui." + key) === "true"; } catch { return false; } };
    const write = (key, value) => { try { localStorage.setItem("academix.ui." + key, String(value)); } catch { $("#platform-flags-status").textContent = "Browser storage is unavailable; preferences will not persist."; } };
    const diagnostic = $("#flag-diagnostic-hints"), compact = $("#flag-compact-status");
    if (!diagnostic || !compact) return;
    diagnostic.checked = read("diagnosticHints"); compact.checked = read("compactStatus");
    diagnostic.addEventListener("change", () => { write("diagnosticHints", diagnostic.checked); document.body.classList.toggle("platform-hide-diagnostic-hints", !diagnostic.checked); $("#platform-flags-status").textContent = "Diagnostic hints preference saved in this browser."; });
    compact.addEventListener("change", () => { write("compactStatus", compact.checked); document.body.classList.toggle("platform-compact-status", compact.checked); $("#platform-flags-status").textContent = "Compact status preference saved in this browser."; });
    document.body.classList.toggle("platform-compact-status", compact.checked);
    document.body.classList.toggle("platform-hide-diagnostic-hints", !diagnostic.checked);
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
        if (user.suspended && user.suspension_reason) { const suspensionReason = document.createElement("small"); suspensionReason.textContent = `Suspension reason: ${user.suspension_reason}`; suspensionReason.className = "muted"; identity.append(suspensionReason); }
        const controls = document.createElement("div"); controls.className = "admin-user-controls";
        const role = document.createElement("select"); role.setAttribute("aria-label", "Role for " + (user.email || user.id));
        ["student","teacher","admin"].forEach(value => { const option=document.createElement("option"); option.value=value; option.textContent=value; option.selected=value===(user.role||"student"); role.append(option); });
        const save = document.createElement("button"); save.className="btn btn-quiet"; save.textContent="Save role"; save.addEventListener("click", async()=>{ if(!confirm(`Change ${user.email}'s role to ${role.value}?`)) return; const reason=prompt("Reason for this role change (required):"); if(!reason||reason.trim().length<3)return toast("Enter a reason of at least 3 characters.","error"); try { await adminControl("set_role",{user_id:user.id,role:role.value,reason:reason.trim()}); toast("Role updated.","success"); await loadAdminUsers(); } catch(e){toast(e.message,"error");} });
        const verify = document.createElement("button"); verify.className="btn btn-quiet"; verify.textContent=user.verified_at?"Revoke verification":"Verify"; verify.addEventListener("click",async()=>{ try { await adminControl("set_verified",{user_id:user.id,verified:!user.verified_at}); toast("Verification status updated.","success"); await loadAdminUsers(); } catch(e){toast(e.message,"error");} });
        const suspend = document.createElement("button"); suspend.className="btn btn-quiet"; suspend.textContent=user.suspended?"Reactivate":"Suspend"; suspend.disabled=user.id===state.user.id; suspend.addEventListener("click",async()=>{ const action=user.suspended?"reactivate":"suspend"; if(!confirm(`${action==="suspend"?"Suspend":"Reactivate"} ${user.email}?`))return; const reason=prompt(`Reason for ${action} (required):`); if(!reason||reason.trim().length<3)return toast("Enter a reason of at least 3 characters.","error"); try { await adminControl(action,{user_id:user.id,reason:reason.trim()}); toast(action==="suspend"?"Account suspended.":"Account reactivated.","success"); await loadAdminUsers(); }catch(e){toast(e.message,"error");} });
        const del = document.createElement("button"); del.className="btn btn-danger"; del.textContent="Delete"; del.disabled=user.id===state.user.id; del.addEventListener("click",async()=>{ if(prompt(`Permanently delete ${user.email}? Type DELETE to confirm.`)!=="DELETE")return; try { await adminControl("delete_user",{user_id:user.id,confirmation:"DELETE",reason:"Account deletion explicitly confirmed by administrator."}); toast("Account deleted.","success"); await loadAdminUsers(); }catch(e){ const originalError=e.message || "The delete function returned an error."; try { const check=await adminControl("list_users",{query:""}); const stillExists=(check.users||[]).some(account=>account.id===user.id); if(!stillExists){ toast("The account is no longer listed. Deletion appears to have succeeded, but the admin function returned an error; its cleanup/audit step may have failed.","success"); await loadAdminUsers(); return; } }catch(checkError){} toast(`Delete operation reported an error: ${originalError}`, "error"); await loadAdminUsers(); } });
        controls.append(role,save,verify,suspend,del); card.append(identity,controls); fragment.append(card);
      });
      if (loadSequence !== adminUsersLoadSequence) return;
      list.replaceChildren(fragment);
      const audit = await adminControl("list_audit");
      if (loadSequence !== adminUsersLoadSequence) return;
      const auditList=$("#admin-audit-list"); auditList.replaceChildren(); auditList.classList.add("admin-audit-scroll");
      if(!audit.logs?.length) auditList.innerHTML='<div class="empty-state">No administrative actions recorded yet.</div>';
      (audit.logs||[]).forEach(log=>{
        const row=document.createElement("article");
        row.className="admin-audit-row";
        const label=document.createElement("strong");
        label.className="admin-audit-label";
        // ASCII-only separators avoid mojibake even if an intermediary serves a mis-decoded script.
        label.textContent=`${log.action} - ${log.outcome||"success"}`;
        const detail=document.createElement("div");
        detail.className="admin-audit-meta";
        detail.textContent=`Target: ${log.target_email||log.target_user_id||"Platform"} | Actor: ${log.actor_id||"Unavailable"} | ${new Date(log.created_at).toLocaleString()}`;
        detail.style.cssText="display:block; margin-top:6px; line-height:1.55; overflow-wrap:anywhere;";
        row.append(label,detail);
        if(log.reason){
          const reason=document.createElement("div");
          reason.className="admin-audit-reason";
          reason.textContent=`Reason: ${log.reason}`;
          reason.style.cssText="display:block; margin-top:8px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere;";
          row.append(reason);
        }
        if(log.details&&Object.keys(log.details).length){
          const details=document.createElement("div");
          details.className="admin-audit-details";
          details.textContent=`Details:\n${JSON.stringify(log.details,null,2)}`;
          details.style.cssText="display:block; margin-top:8px; padding:9px 11px; border-radius:8px; background:rgba(0,0,0,.18); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.82rem;";
          row.append(details);
        }
        auditList.append(row);
      });
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
    const savedTheme = localStorage.getItem("academix-theme");
    document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
    const themeButtons = [$("#theme-toggle"), $("#theme-toggle-auth")].filter(Boolean);
    const syncThemeButtons = () => { const dark = document.documentElement.dataset.theme === "dark"; themeButtons.forEach(button => { button.textContent = dark ? "☀ Light mode" : "☾ Dark mode"; button.setAttribute("aria-pressed", String(dark)); }); };
    syncThemeButtons();
    themeButtons.forEach(button => button.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("academix-theme", next); syncThemeButtons(); }));
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    $$("[data-auth-tab]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.authTab)));
    $("#auth-form").addEventListener("submit", authSubmit);
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
    $("#refresh-platform-status")?.addEventListener("click", loadPlatformHealth);
    $("#jump-platform-configuration")?.addEventListener("click", () => $("#platform-configuration")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    renderPlatformBuildInfo();
    renderTestEnvironmentStatus();
    initPlatformFlags();
    $("#jump-admin-users")?.addEventListener("click", () => $("#admin-users-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    $("#search-admin-users")?.addEventListener("click", loadAdminUsers);
    // AI generation is intentionally locked in the UI; retain generateQuiz() and the Edge Function for future reactivation.
    $("#validate-json-authoring").addEventListener("click", validateJsonAuthoring);
    $("#json-authoring-input").addEventListener("input", () => {const s=$("#json-validation-status");s.textContent="JSON changed — validate to refresh the student preview.";s.className="notice";});
    $("#json-assessment-title").addEventListener("input",()=>{if(state.draft){state.draft.title=$("#json-assessment-title").value.trim()||state.draft.title;renderStudentPreview();}});
    $("#exam-navigation-mode").addEventListener("change",()=>{if(state.draft){state.draft.exam_mode=$("#exam-navigation-mode").value;renderStudentPreview();}});
    $("#publish-duration").addEventListener("input",()=>{if(state.draft)renderStudentPreview();});
    $("#assessment-category").addEventListener("change",()=>{
      const category=$("#assessment-category").value,weight=$("#assessment-weight"),label=weight.closest("label");
      if(category==="midterm"||category==="final"){weight.value=category==="midterm"?"20":"25";weight.disabled=true;if(label)label.firstChild.textContent="Fixed course weight (%)";}
      else{weight.disabled=false;if(label)label.firstChild.textContent="Relative weight within coursework (55%)";}
    });

    $("#import-json-button").addEventListener("click", () => $("#import-json-file").click());
    $("#import-json-file").addEventListener("change", e => { if(e.target.files?.[0]) importExamJson(e.target.files[0]); e.target.value=""; });
    $("#download-json-template").addEventListener("click", () => downloadText("academix-exam-template.json", JSON.stringify({schema_version:1,title:"Practical Examination",exam_mode:"freeroam",questions:[{question_type:"multiple_choice",prompt:"Sample question?",options:["A","B","C","D"],correct_answer:"A",points:1},{question_type:"identification",prompt:"Identify the term.",correct_answer:["Accepted answer","Alternative"],points:2},{question_type:"enumeration",prompt:"List three items.",correct_answer:["First","Second","Third"],points:3},{question_type:"essay",prompt:"Explain your answer.",points:5}]},null,2),"application/json"));
    $("#export-draft-json").addEventListener("click", () => { if(state.draft) downloadText("academix-exam.json",JSON.stringify({schema_version:1,...state.draft},null,2),"application/json"); });
    $("#print-student-exam").addEventListener("click", () => printDraft(false));
    $("#print-answer-key").addEventListener("click", () => printDraft(true));
    $("#publish-quiz").addEventListener("click", publishQuiz);
    $("#export-grades").addEventListener("click", exportGrades);
    $("#refresh-academic-placement")?.addEventListener("click",async()=>{try{await loadAcademicDirectory();await loadUnassignedStudents();}catch(e){toast(e.message,"error");}});
    $("#placement-campus")?.addEventListener("change",populatePlacementColleges);$("#placement-college")?.addEventListener("change",populatePlacementPrograms);
    $("#force-assign-student")?.addEventListener("click",forceAssignStudent);$("#admin-grade-refresh")?.addEventListener("click",loadAdminGradeDirectory);
    $("#grade-filter-campus")?.addEventListener("change",()=>{const id=$("#grade-filter-campus").value,cols=academicDirectory.colleges.filter(x=>!id||x.campus_id===id);fillAcademicSelect("#grade-filter-college",cols,x=>x.college_name,"All colleges");const ids=new Set(cols.map(x=>x.id));fillAcademicSelect("#grade-filter-program",academicDirectory.programs.filter(x=>!id||ids.has(x.college_id)),x=>x.program_name+" ("+x.program_code+")","All programs");});
    $("#grade-filter-college")?.addEventListener("change",()=>{const id=$("#grade-filter-college").value;fillAcademicSelect("#grade-filter-program",academicDirectory.programs.filter(x=>!id||x.college_id===id),x=>x.program_name+" ("+x.program_code+")","All programs");});
    $("#teacher-grade-offering")?.addEventListener("change",loadTeacherGradeDirectory);$("#teacher-grade-refresh")?.addEventListener("click",loadTeacherGradeOfferings);
    $("#phase8-admin-refresh")?.addEventListener("click",loadPhase8Admin);
    $("#phase8-term-form")?.addEventListener("submit",async e=>{e.preventDefault();try{await savePhase8Rpc("academix_admin_save_term",{p_academic_year:$("#phase8-year").value.trim(),p_semester:$("#phase8-semester").value,p_starts_on:$("#phase8-start").value,p_ends_on:$("#phase8-end").value,p_is_active:$("#phase8-active").checked},"Academic term saved.");}catch(err){toast(err.message,"error");}});
    $("#phase8-course-form")?.addEventListener("submit",async e=>{e.preventDefault();try{await savePhase8Rpc("academix_admin_save_course",{p_course_code:$("#phase8-course-code").value.trim(),p_course_title:$("#phase8-course-title").value.trim(),p_units:Number($("#phase8-course-units").value)},"Course saved.");}catch(err){toast(err.message,"error");}});
    $("#phase8-offering-campus")?.addEventListener("change",()=>{const campus=$("#phase8-offering-campus").value,rows=academicDirectory.colleges.filter(x=>!campus||x.campus_id===campus);fillAcademicSelect("#phase8-offering-college",rows,x=>x.college_name,"Select college");$("#phase8-offering-college").disabled=!campus;fillAcademicSelect("#phase8-offering-program",[],x=>x.program_name,"Select program");$("#phase8-offering-program").disabled=true;});
    $("#phase8-offering-college")?.addEventListener("change",()=>{const college=$("#phase8-offering-college").value,rows=academicDirectory.programs.filter(x=>!college||x.college_id===college);fillAcademicSelect("#phase8-offering-program",rows,x=>x.program_name+" ("+x.program_code+")","Select program");$("#phase8-offering-program").disabled=!college;});
    $("#phase8-offering-form")?.addEventListener("submit",async e=>{e.preventDefault();try{await savePhase8Rpc("academix_admin_save_scoped_offering",{p_term_id:$("#phase8-offering-term").value,p_course_id:$("#phase8-offering-course").value,p_instructor_id:$("#phase8-instructor-id").value.trim(),p_campus_id:$("#phase8-offering-campus").value,p_college_id:$("#phase8-offering-college").value,p_program_id:$("#phase8-offering-program").value,p_year_level:Number($("#phase8-offering-year").value),p_section:$("#phase8-section").value.trim(),p_block_code:$("#phase8-offering-block").value.trim()},"Scoped class offering saved and matching students enrolled.");}catch(err){toast(err.message,"error");}});
    $("#phase8-enrollment-form")?.addEventListener("submit",async e=>{e.preventDefault();try{await savePhase8Rpc("academix_admin_enroll_student",{p_offering_id:$("#phase8-enrollment-offering").value,p_student_id:$("#phase8-student-id").value.trim()},"Student enrolled.");}catch(err){toast(err.message,"error");}});
    $("#phase8-band-form")?.addEventListener("submit",async e=>{e.preventDefault();try{await savePhase8Rpc("academix_admin_save_grade_band",{p_term_id:$("#phase8-band-term").value,p_label:$("#phase8-band-label").value.trim(),p_min_percentage:Number($("#phase8-band-min").value),p_max_percentage:Number($("#phase8-band-max").value),p_gwa_value:Number($("#phase8-band-gwa").value)},"GWA conversion band saved.");}catch(err){toast(err.message,"error");}});
    $("#phase8-teacher-offering")?.addEventListener("change",loadTeacherPhase8Roster);
    $("#phase8-teacher-refresh")?.addEventListener("click",loadTeacherPhase8Offerings);
    $("#refresh-student-courses")?.addEventListener("click",loadStudentCourseOutcomes);
    $("#previous-question").addEventListener("click", () => { if (state.currentExam?.exam_mode!=="sequential" && state.questionIndex > 0) { state.questionIndex--; renderQuestion(); } });
    $("#next-question").addEventListener("click", () => { const q=state.currentQuestions[state.questionIndex];if(state.currentExam?.exam_mode==="sequential" && state.answers[q?.id]===undefined)return toast("Select an answer before continuing.","error");if (state.questionIndex < state.currentQuestions.length - 1) { state.questionIndex++; renderQuestion(); } });
    $("#exam-form").addEventListener("submit", e => submitExam(e));
    $("#exit-exam").addEventListener("click", () => { toast("This assessment is in progress. Submit your answers before leaving; the timer continues and integrity events are recorded.", "error"); });
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
