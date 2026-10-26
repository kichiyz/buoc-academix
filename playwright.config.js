const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  timeout: 20_000,
  expect: { timeout: 5_000 },
});
