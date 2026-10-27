# Phase 4 — Isolated test environment

## Goal

Run test accounts, draft exams, attempts, submissions, and grades in a test system that cannot write to production. The production site must remain pointed at the production Supabase project.

## Implemented in this branch

- The app rejects an invalid environment label.
- The app blocks startup if `environment: "TEST"` is paired with the known production Supabase URL.
- `academix-config.test.template.js` provides a placeholder-only configuration for a separate test deployment.
- The UI's environment badge is informational only. The actual isolation boundary is the separate Supabase project and its credentials/RLS policies.

These code changes are on branch `phase-4/isolation-guard`; they are not deployed to the production site.

## Required setup (manual Supabase step)

1. Create a **new Supabase project** dedicated to testing, such as `buoc-academix-test`. Do not use the production project.
2. In that new project, apply the reviewed canonical schema and required migrations in dependency order. Review each migration before running it; a file existing in GitHub does not mean it has been applied.
3. Configure the test project's Auth redirect URLs for the test deployment URL.
4. Deploy a separate copy of the frontend from this branch (or a separate test repository). In that copy, create `academix-config.js` from `academix-config.test.template.js` and replace the placeholders with the **test project's** URL and publishable/anon key.
5. Keep the root production `academix-config.js` unchanged and pointed at production.
6. Use only test accounts and synthetic exam data. Do not copy real student records or live exam content into the test project.
7. Deploy the test site, sign in with a test-only account, create a test exam/attempt/submission, and confirm those rows exist only in the test project's tables.
8. Confirm production still uses its existing project URL and that test configuration fails closed if accidentally pointed at that URL.

## Smoke-test checklist

- [ ] Test deployment uses a distinct Supabase project ref from production.
- [ ] Test config uses `environment: "TEST"` and the test project's publishable/anon key.
- [ ] Changing test config's URL to the known production URL causes startup to be blocked.
- [ ] Test users, exams, submissions, and grades exist only in the test project.
- [ ] Production site's config has not been changed by this branch.
- [ ] No service-role key or AI provider secret is present in frontend files or Git history.
- [ ] RLS policies have been reviewed and verified in the test project.

## Limits

This branch does **not** provision a Supabase project, copy/apply database schema, deploy a test site, or prove data separation. Those steps require Supabase dashboard/CLI access and an end-to-end test. Until the checklist passes, Phase 4 remains in progress and the system should not be treated as safely isolated.
