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
  assert.match(html, /style\.css\?v=phase7-auditdisplay3/);
  assert.match(html, /app\.js\?v=phase7-auditdisplay3/);
});
