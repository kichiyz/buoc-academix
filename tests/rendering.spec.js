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
    .filter((url) => !/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(url));

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
  expect(ids).toContain("app-shell");
  expect(ids).toContain("admin-users-list");

  const appScript = await page.locator('script[src*="app.js"]').getAttribute("src");
  const stylesheet = await page.locator('link[rel="stylesheet"][href*="style.css"]').getAttribute("href");
  expect(appScript, "app.js should use a versioned URL to reduce stale-cache bugs").toMatch(/app\.js\?v=/);
  expect(stylesheet, "style.css should use a versioned URL to reduce stale-cache bugs").toMatch(/style\.css\?v=/);
});
