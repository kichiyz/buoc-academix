import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css, migration, readme] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261115000000_final_launch_course_outcomes.sql", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8")
]);

test("assessment outcomes use the 75 percent passing threshold", () => {
  assert.match(app, /percentage\s*>=\s*75/);
  assert.match(app, /status-passed/);
  assert.match(app, /status-failed/);
  assert.match(app, /status-pending/);
});

test("teacher publishing clears the assessment authoring workspace after success", () => {
  assert.match(app, /function resetAssessmentAuthoring\s*\(/);
  assert.match(app, /resetAssessmentAuthoring\(\);\s*toast\("Assessment published/);
  assert.match(app, /json-authoring-input"\)\.value\s*=\s*""/);
});

test("student drop requests and teacher INC or DRP decisions are server-authorized", () => {
  assert.match(migration, /create table if not exists public\.course_enrollment_statuses/);
  assert.match(migration, /academix_student_request_course_drop/);
  assert.match(migration, /academix_teacher_set_course_outcome/);
  assert.match(migration, /A student drop request is required before you can approve DRP/);
  assert.match(app, /academix_student_course_outcomes/);
  assert.match(app, /academix_teacher_set_course_outcome/);
});

test("final course percentages automatically map to Passed or Failed at 75 percent", () => {
  assert.match(migration, /case when p_percentage>=75 then 'passed' else 'failed' end/);
  assert.match(app, /Passed \(75% or above\)/);
  assert.match(app, /Failed \(below 75%\)/);
});

test("INC blocks GWA and approved DRP courses are excluded from the GWA calculation", () => {
  assert.match(migration, /s\.outcome='inc'/);
  assert.match(migration, /Complete the requirements approved by your instructor/);
  assert.match(migration, /coalesce\(s\.outcome,'active'\)<>'drp'/);
});

test("launch interface includes circular supplied logo, theme switch, scrollable registries and reduced-motion support", () => {
  assert.match(html, /assets\/buoc-favicon\.svg/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /\.phase-two-list\{max-height:440px;overflow-y:auto/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.sidebar\{[^}]*position:sticky/);
});

test("obsolete phase labels are not shown in the website and role notice is scoped to unverified students", () => {
  assert.doesNotMatch(html, /PHASE\s+\d+\s*\//i);
  assert.match(app, /p\.role !== "student" \|\| Boolean\(p\.verified_at\)/);
});

test("README documents the final outcome rules and migration", () => {
  assert.match(readme, /75\.00% or above/);
  assert.match(readme, /20261115000000_final_launch_course_outcomes\.sql/);
});
