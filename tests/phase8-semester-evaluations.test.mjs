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
  assert.match(migration, /as \$phase8\$/);
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

test("students can view cumulative unit-weighted GWA and provisional BU Latin-honors standing", async () => {
  const cumulativeMigration = await readFile("supabase/migrations/20261122000000_student_cumulative_gwa_latin_honors.sql", "utf8");
  assert.match(html, /id="phase8-cumulative-gwa-panel"/);
  assert.match(html, /Cumulative GWA &amp; Latin Honors Outlook/);
  assert.match(app, /academix_student_cumulative_gwa/);
  assert.match(app, /toFixed\(4\)/);
  assert.match(cumulativeMigration, /SUM\(gwa_value \* units\) \/ NULLIF\(SUM\(units\), 0\)/);
  assert.match(cumulativeMigration, /ROUND\(v_gwa, 4\)/);
  assert.match(cumulativeMigration, /gwa_value > 3\.00/);
  assert.match(cumulativeMigration, /outcome NOT IN \('drp','inc'\)/);
  assert.match(cumulativeMigration, /regular load/i);
  assert.match(cumulativeMigration, /Registrar verification/i);
});

test("semester GWA clearly identifies limited course coverage and explains conversion", () => {
  const start = app.indexOf("async function loadSemesterGwa");
  const end = app.indexOf("async function loadCumulativeGwa", start);
  const renderer = app.slice(start, end);
  assert.match(renderer, /SEMESTER GWA/);
  assert.match(renderer, /finalized course/);
  assert.match(renderer, /This result currently reflects only 1 course/);
  assert.match(renderer, /grading bands configured for this academic term/);
  assert.match(renderer, /Converted GWA/);
  assert.doesNotMatch(renderer, /FINAL GWA ·/);
});

test("quiz cards are labeled by assessment category instead of calling every assessment an exam", () => {
  assert.match(app, /assessmentCategoryLabel\(exam\.assessment_category\)/);
  assert.match(app, /Assigned \+category\.toLowerCase\(\)/);
  assert.match(app, /assessment_category/);
});
test("teacher published assessments are scoped to assigned course offerings and split by type", () => {
  assert.match(app, /loadTeacherPublishedAssessments/);
  assert.match(app, /eq\("teacher_id",state\.user\.id\)/);
  assert.match(app, /course_offering_id/);
  assert.match(app, /academic_campuses\(campus_name\)/);
  assert.match(app, /academic_colleges\(college_name\)/);
  assert.match(app, /year_level/);
  assert.match(app, /Midterm &amp; final examinations/);
  assert.match(app, /Quizzes &amp; coursework/);
  assert.match(html, /id="teacher-assessment-filters"/);
  assert.match(html, /id="teacher-published-exams"/);
  assert.match(html, /id="teacher-published-coursework"/);
  assert.match(html, /id="teacher-unscoped-assessments"/);
  assert.match(css, /\.teacher-assessment-filters/);
});
