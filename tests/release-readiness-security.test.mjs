import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const generateQuiz = await readFile("supabase/functions/generate-quiz/index.ts", "utf8");
const schema = await readFile("supabase/schema.sql", "utf8");

test("AI quiz generation independently enforces active teacher or administrator authorization", () => {
  const authStart = generateQuiz.indexOf("const { data: authData, error: authError } = await supabase.auth.getUser()");
  const requestBody = generateQuiz.indexOf("const body = await req.json()");
  assert.notEqual(authStart, -1, "function must authenticate the caller");
  assert.ok(requestBody > authStart, "request body must be processed after authentication");
  const authorizationGate = generateQuiz.slice(authStart, requestBody);
  assert.match(authorizationGate, /from\("profiles"\)/);
  assert.match(authorizationGate, /select\("role,suspended_at"\)/);
  assert.match(authorizationGate, /eq\("id", authData\.user\.id\)/);
  assert.match(authorizationGate, /!\["teacher", "admin"\]\.includes\(profile\.role\)/);
  assert.match(authorizationGate, /profile\.suspended_at/);
  assert.match(authorizationGate, /}, 403\)/);
});

test("canonical schema uses valid dollar quoting for secure exam submission", () => {
  const start = schema.indexOf("create or replace function public.submit_exam(");
  const end = schema.indexOf("revoke all on function public.submit_exam", start);
  assert.notEqual(start, -1, "canonical schema must define submit_exam");
  assert.ok(end > start, "submit_exam definition must have a closing section");
  const submitExam = schema.slice(start, end);
  assert.match(submitExam, /\nAS \$\$\s*DECLARE/i);
  assert.match(submitExam, /\n\$\$;\s*$/);
  assert.doesNotMatch(submitExam, /\nAS \$\s*DECLARE/i);
});


test("Gemini quiz generation uses bounded retries for transient provider failures", () => {
  assert.match(generateQuiz, /const maxAttempts = 3/);
  assert.match(generateQuiz, /\[503, 504\]\.includes\(response\.status\)/);
  assert.match(generateQuiz, /const totalRequestBudgetMs = 110000/);
  assert.match(generateQuiz, /AbortSignal\.timeout\(attemptTimeoutMs\)/);
  assert.match(generateQuiz, /error\.name === "TimeoutError"/);
  assert.match(generateQuiz, /signal timed out\|timed out/i);
  assert.match(generateQuiz, /const retryDelaysMs = \[1500, 3000\]/);
  assert.match(generateQuiz, /response\.headers\.get\("retry-after"\)/);
  assert.match(generateQuiz, /retryAfterMs > 5000/);
  assert.match(generateQuiz, /let timeoutRetryUsed = false/);
  assert.match(generateQuiz, /Gemini is temporarily overloaded or unavailable after bounded retries/);
  assert.match(generateQuiz, /retryable: true/);
  assert.match(generateQuiz, /provider_status: response\.status/);
  assert.match(generateQuiz, /GEMINI_DIAGNOSTIC_PROBE/);
  assert.match(generateQuiz, /Gemini diagnostic probe:/);
  assert.match(generateQuiz, /AbortSignal\.timeout\(15000\)/);
  assert.match(generateQuiz, /Gemini quiz request configuration:/);
  assert.match(generateQuiz, /select\("role,suspended_at"\)/);
});

test("quiz-generation client timeout allows the bounded backend retry window", async () => {
  const app = await readFile("app.js", "utf8");
  assert.match(app, /Quiz generation timed out after 125 seconds/);
  assert.match(app, /125000\)/);
});
