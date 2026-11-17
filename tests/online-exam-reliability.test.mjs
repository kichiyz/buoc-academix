import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app,html,css,migration]=await Promise.all([
  readFile("app.js","utf8"),readFile("index.html","utf8"),readFile("style.css","utf8"),
  readFile("supabase/migrations/20261117000023_online_exam_progress_recovery.sql","utf8")
]);

test("online exams autosave answers to Supabase and recover local progress on reload",()=>{
  assert.match(app,/rpc\("save_exam_progress"/);
  assert.match(app,/select\("started_at,status,answers"\)/);
  assert.match(app,/readLocalExamProgress\(submissionId\)/);
  assert.match(app,/scheduleExamProgressSave\(\)/);
  assert.match(app,/window\.addEventListener\("pagehide",writeLocalExamProgress\)/);
  assert.match(app,/window\.addEventListener\("online"/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.save_exam_progress/);
  assert.match(migration,/SET answers=coalesce\(answers,'\{\}'::jsonb\)\|\|p_answers/);
});

test("expired attempts grade only durable saved answers and unanswered objective items receive zero",()=>{
  assert.match(migration,/IF v_now<=v_deadline THEN[\s\S]*?ELSE[\s\S]*?coalesce\(v_submission\.answers,'\{\}'::jsonb\)/);
  assert.match(migration,/v_answers:=coalesce\(v_submission\.answers,'\{\}'::jsonb\)\|\|p_answers/);
  assert.match(migration,/v_status:=CASE WHEN v_manual THEN 'submitted'::public\.submission_status ELSE 'graded'::public\.submission_status END/);
  assert.match(migration,/INSERT INTO public\.grades/);
  assert.match(migration,/timed_out/);
});

test("submit remains available at the last question and exam controls fit mobile viewports",()=>{
  assert.match(app,/\$\("#submit-exam"\)\.disabled=Boolean\(state\.examSubmissionInFlight\)/);
  assert.match(html,/id="exam-save-status"/);
  assert.match(css,/\.exam-controls #submit-exam\{opacity:1/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/font-size:16px/);
});
