import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("audit log uses ASCII-safe separators", () => {
  assert.match(app, /label\.textContent=\x60\$\{log\.action\} - \$\{log\.outcome\|\|"success"\}\x60/);
  assert.match(app, /Actor: \$\{log\.actor_id\|\|"Unavailable"\} \|/);
  assert.doesNotMatch(app, /label\.textContent=\x60\$\{log\.action\} \\u00b7/);
});

test("audit reason and details are independently spaced readable blocks", () => {
  assert.match(app, /reason\.style\.cssText="display:block; margin-top:8px/);
  assert.match(app, /details\.style\.cssText="display:block; margin-top:8px/);
  assert.match(app, /Details:\\n\$\{JSON\.stringify\(log\.details,null,2\)\}/);
});

test("audit rendering fix is cache-busted in the deployed entry point", () => {
  assert.match(html, /style\\.css\\?v=layout-preview2/);
  assert.match(html, /app\\.js\\?v=layout-preview2/);
});

test("admin audit history is constrained to a scrollable region", () => {
  assert.match(app, /auditList\.classList\.add\("admin-audit-scroll"\)/);
  assert.match(readFileSync(new URL("../style.css", import.meta.url), "utf8"), /\.admin-audit-scroll\{[^}]*max-height:[^}]*overflow-y:auto/);
});

test("student preview supports previous and next question navigation", () => {
  assert.match(app, /previewQuestionIndex: 0/);
  assert.match(app, /data-preview-prev/);
  assert.match(app, /data-preview-next/);
  assert.match(app, /Question '\+\(index\+1\)\+' of '\+total/);
});

test("favicon uses a circular crop and entry point cache-busts the refreshed asset", () => {
  const favicon = readFileSync(new URL("../assets/buoc-favicon.svg", import.meta.url), "utf8");
  assert.match(favicon, /clipPath id="logo-circle"/);
  assert.match(html, /assets\/buoc-favicon\.svg\?v=2/);
});
