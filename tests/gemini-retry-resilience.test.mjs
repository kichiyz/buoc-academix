import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("supabase/functions/generate-quiz/index.ts", "utf8");

test("Gemini retries transient 503/504 provider responses at most three times", () => {
  assert.match(source, /const maxAttempts = 3/);
  assert.match(source, /!\[503, 504\]\.includes\(response\.status\)/);
  assert.match(source, /attempt === maxAttempts/);
});

test("Gemini uses bounded exponential backoff and honors short Retry-After values", () => {
  assert.match(source, /const retryDelaysMs = \[1500, 3000\]/);
  assert.match(source, /response\.headers\.get\("retry-after"\)/);
  assert.match(source, /retryAfterMs > 5000/);
  assert.match(source, /Math\.max\(exponentialDelayMs, retryAfterMs\)/);
});

test("Gemini retry operation has a shared budget compatible with the client timeout", () => {
  assert.match(source, /const totalRequestBudgetMs = 110000/);
  assert.match(source, /remainingBudgetMs - reservedBackoffMs - 1000/);
  assert.match(source, /AbortSignal\.timeout\(attemptTimeoutMs\)/);
});

test("timeouts retain only one retry and do not loop indefinitely", () => {
  assert.match(source, /let timeoutRetryUsed = false/);
  assert.match(source, /timeoutRetryUsed \|\| attempt === maxAttempts/);
  assert.match(source, /timeoutRetryUsed = true/);
});

test("provider overload returns a retryable response with the actual HTTP status", () => {
  assert.match(source, /retryable: true/);
  assert.match(source, /provider_status: response\.status/);
  assert.match(source, /Gemini is temporarily overloaded or unavailable after bounded retries/);
});

test("authorization and role checks remain enforced before Gemini is called", () => {
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /\.select\("role,suspended_at"\)/);
  assert.match(source, /!\["teacher", "admin"\]\.includes\(profile\.role\)/);
  assert.ok(source.indexOf("supabase.auth.getUser()") < source.indexOf("fetch(endpoint"));
});
