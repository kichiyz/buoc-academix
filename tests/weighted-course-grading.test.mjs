import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css, migration, readme] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261116000000_weighted_course_grading.sql", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8")
]);

test("course assessments use fixed midterm/final weights and normalized coursework", () => {
  assert.match(html, /Midterm examination \(20%\)/);
  assert.match(html, /Final examination \(25%\)/);
  assert.match(html, /Relative weight within coursework \(55%\)/);
  assert.match(migration, /grade_weight_percent = 20/);
  assert.match(migration, /grade_weight_percent = 25/);
  assert.match(migration, /b\.midterm_pct \* 0\.20 \+ b\.final_pct \* 0\.25 \+ b\.coursework_pct \* 0\.55/);
});

test("teachers publish assessments into an assigned offering and auto-assign enrolled students", () => {
  assert.match(html, /id="assessment-course-offering"/);
  assert.match(app, /academix_teacher_publish_course_assessment/);
  assert.match(migration, /INSERT INTO public\.exam_assignments\(exam_id, student_id\)/);
});

test("replacing a midterm or final archives the old assessment and preserves records", () => {
  assert.match(app, /replace the existing one\? The old exam will be archived/);
  assert.match(migration, /SET status = 'archived'/);
  assert.match(migration, /assessment_category = v_exam\.assessment_category/);
});

test("teachers can permanently delete their exams, with active attempts protected", () => {
  assert.match(app, /Delete assessment/);
  assert.match(app, /academix_teacher_delete_exam/);
  assert.match(migration, /status = 'in_progress'/);
  assert.match(migration, /Wait until all attempts are submitted before deleting it/);
});

test("teacher final-grade assignment displays period GWA and the computed final grade", () => {
  assert.match(app, /academix_teacher_assessment_grade_summary/);
  assert.match(app, /Midterm GWA/);
  assert.match(app, /Final exam GWA/);
  assert.match(app, /Computed final/);
  assert.match(migration, /academix_teacher_assessment_grade_summary/);
});

test("portal theme has balanced light and dark palettes and continuous ambient background", () => {
  assert.match(css, /--portal-blue:#174b69/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /body::before\{content:"";position:fixed/);
  assert.match(css, /\.teacher-home,.role-home\{background:transparent!important\}/);
});

test("README explains the complete weighted grading formula", () => {
  assert.match(readme, /Midterm examination = 20%/);
  assert.match(readme, /Final examination = 25%/);
  assert.match(readme, /share 55%/);
});
