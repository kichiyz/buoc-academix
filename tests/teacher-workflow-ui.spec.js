import { test, expect } from "@playwright/test";

test("teacher workflow dialog is present, accessible, and hidden at startup", async ({ page }) => {
  await page.goto("/");

  const dialog = page.locator("#workflow-modal");
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-labelledby", "workflow-modal-title");
  await expect(page.locator("#workflow-modal-title")).toHaveText("Manage assessment");
  await expect(page.locator("#workflow-modal-close")).toHaveAccessibleName("Close dialog");
  await expect(dialog).toBeHidden();
});

test("teacher assignment and attempt authorization no longer use browser prompts", async ({ request }) => {
  const response = await request.get("/app.js");
  expect(response.ok()).toBeTruthy();
  const js = await response.text();

  const assignmentStart = js.indexOf("async function manageAssignments(exam)");
  const authorizationStart = js.indexOf("async function authorizeAttempt(exam)");
  const questionStart = js.indexOf("function renderQuestion()");

  expect(assignmentStart, "Assignment workflow should exist").toBeGreaterThanOrEqual(0);
  expect(authorizationStart, "Attempt authorization workflow should exist").toBeGreaterThan(assignmentStart);
  expect(questionStart, "Next workflow boundary should exist").toBeGreaterThan(authorizationStart);

  const assignmentWorkflow = js.slice(assignmentStart, authorizationStart);
  const authorizationWorkflow = js.slice(authorizationStart, questionStart);

  expect(assignmentWorkflow).toContain("openWorkflowModal(");
  expect(assignmentWorkflow).toContain("Save assignments");
  expect(assignmentWorkflow).not.toMatch(/\bprompt\s*\(/);
  expect(authorizationWorkflow).toContain("openWorkflowModal(");
  expect(authorizationWorkflow).toContain("Authorize attempt");
  expect(authorizationWorkflow).not.toMatch(/\bprompt\s*\(/);
});

test("teacher workflow dialogs include mobile layout and dismissal handling", async ({ page, request }) => {
  await page.goto("/");
  const stylesheet = await page.locator('link[rel="stylesheet"][href*="style.css"]').getAttribute("href");
  expect(stylesheet).toBeTruthy();

  const response = await request.get(stylesheet);
  expect(response.ok()).toBeTruthy();
  const css = await response.text();
  expect(css).toContain(".workflow-modal");
  expect(css).toContain(".workflow-modal-card");
  expect(css).toMatch(/@media\s*\(max-width:\s*600px\)/);

  const appResponse = await request.get("/app.js");
  expect(appResponse.ok()).toBeTruthy();
  const js = await appResponse.text();
  expect(js).toContain('event.key === "Escape"');
  expect(js).toContain("data-workflow-close");
  expect(js).toContain("workflowReturnFocus");
});
