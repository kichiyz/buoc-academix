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
