import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("workspace navigation uses consistent, role-specific assessment labels", async () => {
  const [html, app] = await Promise.all([read("../index.html"), read("../app.js")]);
  assert.match(html, /> Assessments<\/button>/);
  assert.match(html, /> Assessment Studio<\/button>/);
  assert.match(html, /> Developer Center<\/button>/);
  assert.match(app, /My Assessments/);
  assert.match(app, /Assessment Library/);
  assert.match(app, /Gradebook/);
  assert.match(app, /Administrator/);
});

test("teacher assessment list batches question metadata instead of issuing one query per exam", async () => {
  const app = await read("../app.js");
  const start = app.indexOf("async function loadTeacherPublishedAssessments()");
  const end = app.indexOf("async function loadExams()", start);
  const loader = app.slice(start, end);
  assert.match(loader, /\.from\("questions"\)\.select\("exam_id"\)\.in\("exam_id",examIds\)/);
  assert.match(loader, /questionCounts\.get\(exam\.id\)/);
  assert.doesNotMatch(loader, /\.select\("id",\{count:"exact",head:true\}\)\.eq\("exam_id",exam\.id\)/);
  assert.match(loader, /console\.warn\("Could not load assessment question counts:/);
});

test("frontend cache versions are advanced together after the interface update", async () => {
  const html = await read("../index.html");
  assert.match(html, /style\.css\?v=phase9-interface2/);
  assert.match(html, /hybrid-assessment\.js\?v=phase9-interface2/);
  assert.match(html, /app\.js\?v=phase9-interface2/);
});
