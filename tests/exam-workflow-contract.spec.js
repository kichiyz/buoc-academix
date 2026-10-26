import { test, expect } from "@playwright/test";

test("exam submission has a trusted server-side grading RPC migration", async ({ request }) => {
  const response = await request.get("/supabase/migrations/20261026_secure_exam_submission.sql");
  expect(response.ok(), "The exam workflow migration should be committed").toBeTruthy();
  const sql = await response.text();

  expect(sql).toContain("create or replace function public.submit_exam(");
  expect(sql).toContain("security definer");
  expect(sql).toContain("for update");
  expect(sql).toContain("auth.uid()");
  expect(sql).toContain("public.is_verified()");
  expect(sql).toContain("public.exam_assignments");
  expect(sql).toContain("public.questions");
  expect(sql).toContain("insert into public.grades");
  expect(sql).toContain("revoke all on function public.submit_exam(uuid, jsonb) from public");
  expect(sql).toContain("grant execute on function public.submit_exam(uuid, jsonb) to authenticated");
  expect(sql).not.toMatch(/return\s+jsonb_build_object\s*\([\s\S]*?correct_answer/i);
});

test("frontend submits answers only through the server-side grading RPC", async ({ request }) => {
  const response = await request.get("/app.js");
  expect(response.ok()).toBeTruthy();
  const js = await response.text();

  expect(js).toContain('state.supabase.rpc("submit_exam"');
  expect(js).toContain("p_submission_id: state.currentExam.submissionId");
  expect(js).toContain("p_answers: state.answers");
  expect(js).not.toMatch(/from\(["']questions["']\)[\s\S]{0,200}correct_answer/);
});
