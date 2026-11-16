import { test, expect } from "@playwright/test";

const viewports = [
  { name: "small phone", width: 320, height: 740 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1365, height: 900 },
];

test("home page loads and core local assets respond", async ({ page, request }) => {
  const response = await page.goto("/");
  expect(response?.ok(), "index.html should return a successful response").toBeTruthy();
  await expect(page.locator("body")).toBeVisible();

  const html = await request.get("/");
  const markup = await html.text();
  const localAssets = [...markup.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((match) => match[1])
    .filter((url) => !/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(url))
    // This file is generated only by the local sandbox launcher and is intentionally absent in CI.
    .filter((url) => !url.startsWith("academix-config.local.js"));

  for (const asset of localAssets) {
    const url = new URL(asset, "http://127.0.0.1:4173/");
    if (url.origin !== "http://127.0.0.1:4173") continue;
    const assetResponse = await request.get(url.pathname + url.search);
    expect(assetResponse.ok(), `Local asset should load: ${asset}`).toBeTruthy();
  }
});

test("page has no duplicate IDs at startup", async ({ page }) => {
  await page.goto("/");
  const duplicates = await page.evaluate(() => {
    const counts = new Map();
    document.querySelectorAll("[id]").forEach((node) => {
      counts.set(node.id, (counts.get(node.id) || 0) + 1);
    });
    return [...counts.entries()].filter(([, count]) => count > 1);
  });
  expect(duplicates, "Every HTML id must be unique").toEqual([]);
});

test("responsive layouts do not create document-wide horizontal overflow", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(
      dimensions.documentWidth,
      `Document overflows horizontally at ${viewport.name}: ${JSON.stringify(dimensions)}`,
    ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(
      dimensions.bodyWidth,
      `Body overflows horizontally at ${viewport.name}: ${JSON.stringify(dimensions)}`,
    ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }
});

test("startup has no uncaught page errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(errors, "Uncaught JavaScript errors should not occur at startup").toEqual([]);
});

test("core page containers and asset cache versions exist", async ({ page }) => {
  await page.goto("/");
  const ids = await page.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids).toContain("auth-view");
  expect(ids).toContain("dashboard-view");
  expect(ids).toContain("admin-users-list");

  const appScript = await page.locator('script[src*="app.js"]').getAttribute("src");
  const stylesheet = await page.locator('link[rel="stylesheet"][href*="style.css"]').getAttribute("href");
  expect(appScript, "app.js should use a versioned URL to reduce stale-cache bugs").toMatch(/app\.js\?v=/);
  expect(stylesheet, "style.css should use a versioned URL to reduce stale-cache bugs").toMatch(/style\.css\?v=/);
});


test("print documents load the local BU seal and reserve non-overlapping A4 header/footer space", async ({ request }) => {
  const [appResponse, stylesheetResponse, seal] = await Promise.all([
    request.get("/app.js"),
    request.get("/style.css"),
    request.get("/assets/bicol-university-seal-print.jpg"),
  ]);
  const app = await appResponse.text();
  const stylesheet = await stylesheetResponse.text();

  expect(appResponse.ok(), "The application script should load").toBeTruthy();
  expect(stylesheetResponse.ok(), "The stylesheet should load").toBeTruthy();
  expect(seal.ok(), "The locally hosted Bicol University seal must load").toBeTruthy();
  expect(app).toContain('new URL("assets/bicol-university-seal.png",window.location.href).href');
  expect(app).toContain("@page{size:A4 portrait;margin:20mm 17mm 20mm 17mm}");
  expect(app).toContain(".masthead{display:flex;gap:4mm;padding-bottom:5mm;margin-bottom:3.5mm;min-height:31mm;overflow:visible}");
  expect(app).toContain(".seal{flex:0 0 27mm;width:27mm;height:27mm;max-width:27mm;object-fit:contain;object-position:center;align-self:center}");
  expect(app).toContain(".signature-row{break-inside:avoid;page-break-inside:avoid;margin:13mm 8mm 0;gap:18mm}");
  expect(app).toContain(".signature-field{height:76.2mm;min-height:76.2mm;padding:0 0 2mm}");
  expect(app).toContain(".end-note{break-inside:avoid;page-break-inside:avoid;margin:7mm 0 0;padding-top:2.5mm}");
  expect(app).not.toContain("position:fixed;top:-15mm");
  expect(app).not.toContain("position:fixed;bottom:-15mm");
  expect(app).not.toContain('class="running-footer"');
  expect(app).toContain('class="end-note"');
  expect(app).toContain("document.fonts?.ready");
  expect(app).toContain("img.decode()");
  expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
  expect(stylesheet).toContain("@keyframes academix-ambient-drift");
});
