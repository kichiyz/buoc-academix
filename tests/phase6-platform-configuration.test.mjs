import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const app = await readFile("app.js", "utf8");
const css = await readFile("style.css", "utf8");
const config = await readFile("academix-config.js", "utf8");

test("Platform Operations is part of the administrator Developer Center", () => {
  assert.match(html, /id="platform-configuration"/);
  assert.match(html, /PHASE 6 \/ PLATFORM CONFIGURATION/);
  assert.match(app, /state\.profile\?\.role !== "admin"/);
});

test("service health uses public Auth health and authenticated RLS-scoped profile access", () => {
  assert.match(app, /\/auth\/v1\/health/);
  assert.match(app, /from\("profiles"\)\.select\("id"\)/);
  assert.match(app, /Request timed out; provider status is unknown/);
  assert.match(app, /Browser\/network request failed; provider status is unknown/);
});

test("deployment metadata is never fabricated when the build pipeline does not supply it", () => {
  assert.match(app, /window\.ACADEMIX_BUILD/);
  assert.match(app, /Not supplied by deployment/);
  assert.doesNotMatch(config, /service_role|secret|private_key/i);
});

test("UI flags are browser-local and cannot replace authorization checks", () => {
  assert.match(app, /localStorage\.getItem\("academix\.ui\."/);
  assert.match(app, /localStorage\.setItem\("academix\.ui\."/);
  assert.match(html, /LOCAL ONLY/);
  assert.match(html, /never grant access or change backend authorization/);
  assert.match(css, /platform-hide-diagnostic-hints/);
});

test("provider links use known official dashboards and safe new-tab attributes", () => {
  assert.match(html, /https:\/\/supabase\.com\/dashboard\/project\//);
  assert.match(html, /https:\/\/github\.com\/kichiyz\/buoc-academix\/actions/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("Phase 6 asset cache versions are active", () => {
  assert.match(html, /style\.css\?v=phase6-platform1/);
  assert.match(html, /app\.js\?v=phase6-platform1/);
});
