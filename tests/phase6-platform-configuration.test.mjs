import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const app = await readFile("app.js", "utf8");
const css = await readFile("style.css", "utf8");
const config = await readFile("academix-config.js", "utf8");
const buildFallback = await readFile("academix-build.js", "utf8");
const pagesWorkflow = await readFile(".github/workflows/pages-deploy.yml", "utf8");

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

test("Pages build generates public metadata and the Developer Center displays every field", () => {
  assert.match(pagesWorkflow, /Generate public deployment metadata/);
  assert.match(pagesWorkflow, /BUILD_COMMIT/);
  assert.match(pagesWorkflow, /BUILD_BRANCH/);
  assert.match(pagesWorkflow, /builtAt: new Date\(\)\.toISOString\(\)/);
  assert.match(pagesWorkflow, /window\.ACADEMIX_BUILD/);
  assert.match(app, /window\.ACADEMIX_BUILD/);
  assert.match(buildFallback, /window\.ACADEMIX_BUILD = Object\.freeze\(\{\}\)/);
  assert.match(app, /platform-build-branch/);
  assert.match(app, /build\.environment \|\| APP_ENVIRONMENT/);
  assert.match(html, /id="platform-build-branch"/);
  assert.match(html, /academix-build\.js\?v=phase6-build1/);
  assert.match(pagesWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(config, /service_role|secret|private_key/i);
});

test("missing deployment metadata is displayed explicitly instead of guessed", () => {
  assert.match(app, /Not supplied by deployment/);
  assert.doesNotMatch(html, /<dd>phase-6\/platform-configuration<\/dd>/);
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
  assert.match(html, /app\.js\?v=phase6-platform2/);
});
