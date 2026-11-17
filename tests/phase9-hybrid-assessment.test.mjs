import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("hybrid assessment frontend is loaded and mounted from the authenticated app session", async () => {
  const [index, app, module] = await Promise.all([
    read("../index.html"), read("../app.js"), read("../hybrid-assessment.js")
  ]);
  assert.match(index, /hybrid-assessment\.js/);
  assert.match(app, /AcademixHybridAssessment\?\.mount/);
  assert.match(module, /profile\.role==="teacher"/);
  assert.match(module, /profile\.role==="student"/);
  assert.match(module, /profile\.role==="admin"/);
});

test("printed assessment backend uses private storage and instructor-scoped authorization", async () => {
  const sql = await read("../supabase/migrations/20261117000010_phase9_hybrid_printed_assessments.sql");
  for (const name of [
    "printed_assessment_batches", "printed_assessment_scans",
    "academix_teacher_register_signature", "academix_create_printed_assessment_batch",
    "academix_register_printed_assessment_scan", "academix_teacher_auto_grade_printed_scan",
    "academix_teacher_save_printed_grading", "academix_teacher_publish_printed_grade",
    "academix_student_printed_assessment_results", "academix_admin_printed_assessment_overview"
  ]) assert.ok(sql.includes(name), `Missing backend contract: ${name}`);
  assert.match(sql, /public\.is_verified\(\)/);
  assert.match(sql, /authorization_code_hash/);
  assert.match(sql, /digest\(v_code,'sha256'\)/);
  assert.match(sql, /instructor_name_snapshot/);
  assert.match(sql, /signature_visually_confirmed/);
  assert.match(sql, /CREATE POLICY "Printed assessment owners upload"/);
  assert.match(sql, /public=false/);
});

test("automatic grading remains provisional and requires per-question review and instructor publication", async () => {
  const sql = await read("../supabase/migrations/20261117000010_phase9_hybrid_printed_assessments.sql");
  const module = await read("../hybrid-assessment.js");
  assert.match(sql, /status='needs_review'/);
  assert.match(sql, /status='graded'/);
  assert.match(sql, /status='published'/);
  assert.match(sql, /Only the assigned instructor who graded this paper may approve it/);
  assert.match(module, /Run automatic OMR grading/);
  assert.match(module, /Save manual \/ reviewed scores/);
  assert.match(module, /Approve and publish grade/);
  assert.match(module, /signature_visually_confirmed:true/);
});

test("OMR recognizer flags uncertain marks and maps bubbles to answer-key values", async () => {
  const module = await read("../hybrid-assessment.js");
  assert.match(module, /uncertain_count/);
  assert.match(module, /requires_teacher_review:true/);
  assert.match(module, /Array\.isArray\(q\.options\)\?q\.options\[selected\]/);
  assert.match(module, /manual_question_paper/);
});


test("online examination startup remains server-authorized and does not expose the answer key", async () => {
  const app = await read("../app.js");
  const start = app.slice(app.indexOf("async function startExam("), app.indexOf("let workflowReturnFocus"));
  assert.doesNotMatch(start, /correct_answer/, "the student question payload must not include answer-key fields");
  assert.ok(start.indexOf('rpc("get_exam_questions"') < start.indexOf('rpc("start_exam_attempt"'),
    "questions must load before an attempt starts so loading time is not deducted");
  assert.match(start, /submission\.status !== "in_progress"/);
  assert.match(start, /Date\.parse\(submission\.started_at\)/);
  assert.match(app, /rpc\("submit_exam"/);
  assert.match(app, /p_answers: state\.answers/);
  assert.match(app, /state\.startingExam \|\| state\.currentExam/);
});

test("online examination preserves all existing question types and navigation modes", async () => {
  const app = await read("../app.js");
  const html = await read("../index.html");
  const render = app.slice(app.indexOf("function renderQuestion()"), app.indexOf("let academicDirectory"));
  for (const type of ["multiple_choice", "true_false", "identification", "short_answer", "enumeration", "essay"]) {
    assert.ok(render.includes(type), `Missing online exam question type: ${type}`);
  }
  assert.match(render, /exam_mode === "sequential"/);
  assert.match(render, /question-navigator/);
  assert.match(html, /id="question-container"/);
  assert.match(html, /id="previous-question"/);
  assert.match(html, /id="next-question"/);
  assert.match(html, /id="submit-exam"/);
  assert.match(html, /id="exam-timer"/);
});

test("online examination timer uses the server deadline and submission cannot run twice", async () => {
  const app = await read("../app.js");
  assert.match(app, /state\.examDeadlineAt = startedAtMs \+ durationSeconds \* 1000/);
  assert.match(app, /state\.examDeadlineAt - Date\.now\(\)/);
  assert.match(app, /state\.examSubmissionInFlight\) return/);
  assert.match(app, /Retry submission/);
  assert.match(app, /state\.submissionFailed = true/);
  assert.match(app, /i!==total-1&&!state\.submissionFailed/);
  assert.match(app, /state\.examDeadlineAt=null/);
});

test("motion remains enabled by default and respects reduced-motion preferences", async () => {
  const css = await read("../style.css");
  assert.match(css, /@keyframes academix-ambient-drift/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /prefers-reduced-motion:\s*no-preference/);
});


test("printed assessment, answer key, OMR sheet, and manual grading use actual question point values", async () => {
  const app = await read("../app.js");
  const hybrid = await read("../hybrid-assessment.js");
  assert.ok(app.includes("questions.reduce((sum,q)=>sum+(Number(q.points)||0),0)"));
  assert.ok(app.includes("MARKING TOTAL"));
  assert.ok(app.includes("Total attainable score is"));
  assert.ok(hybrid.includes("Total possible score:"));
  assert.ok(hybrid.includes("omr-points"));
  assert.ok(hybrid.includes("Current score:"));
  assert.ok(hybrid.includes("x.score>questionById.get(x.question_id)"));
  assert.ok(hybrid.includes("Manual grading:"));
});

test("printed assessment batch RPC resolves pgcrypto from the Supabase extensions schema", async () => {
  const migration = await read("../supabase/migrations/20261117000011_phase9_pgcrypto_batch_fix.sql");
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/i);
  assert.match(migration, /ALTER FUNCTION public\.academix_create_printed_assessment_batch\(uuid, text\)/);
  assert.match(migration, /SET search_path = public, extensions, pg_temp/i);
});

test("authorized OMR and manual answer sheets use the BU seal and collision-safe print layouts", async () => {
  const module = await read("../hybrid-assessment.js");
  assert.match(module, /function printAnswerSheet\(\)/);
  assert.match(module, /function printManualAnswerSheet\(\)/);
  assert.match(module, /assets\/Bicol University Logo\.png/);
  assert.match(module, /alt=\"Official Bicol University seal\"/);
  assert.match(module, /overflow-wrap:anywhere/);
  assert.match(module, /manual-question-heading/);
  assert.match(module, /omr-row/);
  assert.match(module, /printButton\.addEventListener\(\"click\",isOmr\?printAnswerSheet:printManualAnswerSheet\)/);
});

test("approved authorized paper grading replaces an existing online submission and gradebook score", async () => {
  const migration = await read("../supabase/migrations/20261117000012_phase9_paper_grade_replaces_online_grade.sql");
  assert.match(migration, /UPDATE public\.submissions[\s\S]*score=v_scan\.score/);
  assert.match(migration, /UPDATE public\.grades[\s\S]*score=v_scan\.score/);
  assert.match(migration, /replaced_existing_online_attempt/);
  assert.doesNotMatch(migration, /already has an online or printed attempt/);
  assert.match(migration, /Only the assigned instructor who graded this paper may approve it/);
});

test("OMR and conventional print formats support true/false, multiple-choice options, and written response types", async () => {
  const module = await read("../hybrid-assessment.js");
  assert.match(module, /q\.question_type==="true_false"\?\["True","False"\]/);
  assert.match(module, /\["T","F"\]/);
  assert.match(module, /omr-booklet-options/);
  assert.match(module, /ASSESSMENT QUESTION BOOKLET/);
  assert.match(module, /Record your answer by shading the corresponding bubble on the OMR answer sheet/);
  assert.match(module, /q\.question_type==="true_false"\?\["True","False"\]/);
  assert.match(module, /manual-options/);
  assert.match(module, /Written response · manual scoring/);
  for (const type of ["identification", "enumeration", "short_answer", "essay"]) {
    assert.ok(module.includes(type), `Missing printed or manual-review support for ${type}`);
  }
});

test("handwritten responses are never guessed by OMR and remain available for instructor scoring", async () => {
  const module = await read("../hybrid-assessment.js");
  assert.match(module, /handwritten_response_requires_instructor/);
  assert.match(module, /does not guess handwritten identification, enumeration, short-answer, or essay responses/);
  assert.match(module, /Open the original uploaded scan or PDF/);
  assert.match(module, /Instructor-awarded score for question/);
  assert.match(module, /Save manual \/ reviewed scores/);
  assert.match(module, /manual_pdf/);
  assert.match(module, /requires_teacher_review:true/);
});

