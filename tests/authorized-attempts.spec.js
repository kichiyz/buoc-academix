const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261026_authorized_retakes_remedials.sql"), "utf8");

test("exam attempts are created by the server RPC", () => {
  expect(app).toContain('rpc("start_exam_attempt", { p_exam_id: exam.id })');
  expect(app).not.toContain('from("submissions").insert({ exam_id: exam.id, student_id: state.user.id })');
});

test("retakes and remedial attempts require teacher/admin authorization", () => {
  expect(migration).toContain("public.authorize_exam_attempt");
  expect(migration).toContain("public.start_exam_attempt");
  expect(migration).toContain("A teacher/admin must authorize your next attempt.");
  expect(migration).toContain("v_role not in ('teacher','admin')");
  expect(migration).toContain("unique(exam_id, student_id, attempt_number)");
  expect(app).toContain('["retake", "remedial"]');
});

test("existing in-progress attempts are reused and authorizations are consumed", () => {
  expect(migration).toContain("status='in_progress'");
  expect(migration).toContain("consumed_at=clock_timestamp()");
  expect(migration).toContain("attempt_type");
});

test("submission failure does not restart a timer that has expired", () => {
  expect(app).toContain("if (state.secondsLeft > 0) startTimer();");
  expect(app).not.toContain("Submission failed: ${e.message}. Your attempt may remain in progress; do not close this page.`, \"error\"); startTimer();");
});
