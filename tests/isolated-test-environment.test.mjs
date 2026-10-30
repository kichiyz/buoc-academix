import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const app = await readFile("app.js", "utf8");
const config = await readFile("academix-config.js", "utf8");
const start = await readFile("scripts/start-test-environment.ps1", "utf8");
const stop = await readFile("scripts/stop-test-environment.ps1", "utf8");
const localConfig = await readFile(".gitignore", "utf8");

test("Developer Center reports local sandbox status instead of a planned placeholder", () => {
  assert.match(html, /id="test-environment-status"/);
  assert.match(html, /id="check-test-environment"/);
  assert.doesNotMatch(html, /data-feature="Isolated Test Environment"/);
  assert.match(app, /renderTestEnvironmentStatus/);
  assert.match(app, /auth\/v1\/health/);
});

test("TEST mode accepts only localhost Supabase and rejects production URL", () => {
  assert.match(app, /APP_ENVIRONMENT === "TEST" && \/\^http:/);
  assert.match(app, /APP_ENVIRONMENT === "TEST" && normalizedSupabaseUrl === PRODUCTION_SUPABASE_URL/);
  assert.match(app, /environmentConfigSafe/);
  assert.match(config, /environment: "PRODUCTION"/);
  assert.match(config, /otkgtwwxmmdmiavmpyqo\.supabase\.co/);
});

test("local start script verifies Docker, Supabase and localhost before generating ignored config", () => {
  assert.match(start, /docker info/);
  assert.match(start, /supabase start/);
  assert.match(start, /supabase status -o env/);
  assert.match(start, /127\\.0\\.0\\.1/);
  assert.match(start, /academix-config\.local\.js/);
  assert.match(stop, /supabase stop/);
  assert.match(stop, /Remove-Item "academix-config\.local\.js"/);
  assert.match(localConfig, /academix-config\.local\.js/);
});

test("local sandbox documentation warns against real student data", async () => {
  const docs = await readFile("TEST-ENVIRONMENT.md", "utf8");
  assert.match(docs, /Never use real student records or grades/);
  assert.match(docs, /production configuration remains unchanged/);
});
