import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, migration] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261113000000_phase7_assessment_foundation.sql", import.meta.url), "utf8"),
]);

test("AI quiz generation is locked in the UI and Edge Function without deleting its implementation", async () => {
  assert.match(html, /AI quiz generation is locked/);
  assert.match(html, /Locked · not deleted/);
  assert.match(app, /async function generateQuiz\(/);\n  const edge = await readFile(new URL("../supabase/functions/generate-quiz/index.ts", import.meta.url), "utf8");\n  assert.match(edge, /AI_GENERATION_ENABLED.*!== "true"/);
  assert.doesNotMatch(app, /#generator-form["']\)\.addEventListener\(["']submit["'],\s*generateQuiz/);
});

test("manual JSON editor, import, guide, and live student preview are present", () => {
  assert.match(html, /id="json-authoring-input"/);
  assert.match(html, /id="import-json-file"/);
  assert.match(html, /New to JSON\?/);
  assert.match(html, /id="student-preview"/);
  assert.match(app, /function validateJsonAuthoring\(/);
  assert.match(app, /function renderStudentPreview\(/);
});

test("free-roam and sequential navigation are wired into the student attempt", () => {
  assert.match(html, /value="freeroam"/);
  assert.match(html, /value="sequential"/);
  assert.match(app, /exam_mode/);
  assert.match(app, /Select an answer before continuing/);
});

test("assessment metadata migration is additive and validates supported modes and weights", () => {
  assert.match(migration, /add column if not exists exam_mode/);
  assert.match(migration, /'freeroam','sequential'/);
  assert.match(migration, /grade_weight_percent/);
  assert.match(migration, /visual_data jsonb/);
});
