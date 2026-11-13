import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const app = await readFile("app.js", "utf8");
const css = await readFile("style.css", "utf8");
const migration = await readFile("supabase/migrations/20261114000000_phase8_semester_evaluations_gwa.sql", "utf8");

test("students have a dedicated semestral instructor-evaluation workspace", () => {
  assert.match(html, /data-view="evaluations"/);
  assert.match(html, /id="view-evaluations"/);
  assert.match(app, /academix_student_evaluation_targets/);
  assert.match(app, /academix_student_submit_instructor_evaluation/);
  assert.match(migration, /Complete every required instructor evaluation/);
});

test("instructor evaluation submissions are one-per-instructor-per-student-per-term", () => {
  assert.match(migration, /unique \(term_id, student_id, instructor_id\)/);
  assert.match(migration, /p_ratings jsonb/);
  assert.match(migration, /clarity.*preparedness.*engagement.*feedback/s);
  assert.match(migration, /You have already evaluated this instructor for this semester/);
});

test("raw evaluation ratings are confidential and admin sees completion aggregates only", () => {
  assert.match(migration, /Students read their own evaluation completion/);
  assert.match(migration, /student_id=auth\.uid\(\)/);
  assert.match(migration, /academix_admin_evaluation_progress/);
  assert.match(migration, /completion_percent/);
  assert.match(migration, /Confidential student-to-instructor evaluation submissions/);
  assert.doesNotMatch(migration, /create policy[^;]+instructor_evaluations[^;]+for select[^;]+instructor_id=auth\.uid\(\)/is);
});

test("administrators can configure terms, courses, offerings, enrollments, and grade bands through protected RPCs", () => {
  for (const name of [
    "academix_admin_save_term", "academix_admin_save_course",
    "academix_admin_save_offering", "academix_admin_enroll_student",
    "academix_admin_save_grade_band"
  ]) {
    assert.ok(migration.includes("function public." + name), name + " must exist");
    assert.ok(migration.includes("grant execute on function public." + name), name + " must be granted to authenticated users");
  }
  assert.match(migration, /academix_is_active_admin\(\)/);
  assert.match(html, /id="phase8-term-form"/);
  assert.match(html, /id="phase8-course-form"/);
  assert.match(html, /id="phase8-offering-form"/);
  assert.match(html, /id="phase8-enrollment-form"/);
  assert.match(html, /id="phase8-band-form"/);
  assert.match(migration, /academix_admin_list_people/);
  assert.match(migration, /academix_can_read_offering/);
});

test("teachers can finalize only grades in their own offerings", () => {
  assert.match(html, /id="phase8-teacher-offering"/);
  assert.match(app, /academix_teacher_roster/);
  assert.match(app, /academix_teacher_set_final_grade/);
  assert.match(migration, /o\.instructor_id=auth\.uid\(\)/);
});

test("final GWA is server-gated until evaluations, grades, and conversion bands are complete", () => {
  assert.match(html, /id="phase8-gwa-panel"/);
  assert.match(app, /academix_student_semester_gwa/);
  assert.match(migration, /missing_evaluations/);
  assert.match(migration, /ungraded_courses/);
  assert.match(migration, /unmapped_grades/);
  assert.match(migration, /sum\(b\.gwa_value\*c\.units\)\/nullif\(sum\(c\.units\),0\)/);
  assert.match(migration, /no BU conversion values are hard-coded/);
});

test("individual assessment grades remain visible separately from the locked final GWA", () => {
  assert.match(app, /from\("grades"\)\.select/);
  assert.match(app, /await loadSemesterGwa\(\)/);
  assert.match(html, /id="grades-list"/);
});

test("Phase 8 workflows have responsive layouts and accessible status regions", () => {
  assert.match(html, /id="phase8-evaluation-status" class="empty-state"/);
  assert.match(html, /id="phase8-gwa-content"/);
  assert.match(css, /\.phase8-evaluation-list/);
  assert.match(css, /@media\(max-width:760px\)/);
});
