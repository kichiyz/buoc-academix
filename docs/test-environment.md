# Phase 4 — Isolated test environment

## Status and boundary

The production frontend is configured through `academix-config.js`. For a real test environment, use a **separate Supabase project** and a separate deployed copy of this frontend. Do not switch the live production site's config to test values while students are using it. The environment badge is informational; the separate database/project is what prevents test submissions from entering production tables.

## Setup

1. In Supabase, create a new project dedicated to testing (for example, `buoc-academix-test`). Use a distinct database password.
2. In the test project SQL Editor, apply the reviewed schema and migrations in dependency order. At minimum, review the canonical schema and every file under `supabase/migrations/`; do not assume a migration has been applied just because it exists in GitHub.
3. Configure the test project's Auth settings and redirect URLs for the test site's exact URL. Do not reuse production student data or production credentials.
4. Make a separate deployment copy/repository or branch output for the test site. In that copy only, edit `academix-config.js`:
   - `environment: "TEST"`
   - `supabaseUrl`: the test project's Project URL
   - `supabasePublishableKey`: the test project's publishable/anon key
5. Verify the visible badge says `ENVIRONMENT: TEST`, then create test-only accounts and test-only exams. Confirm submissions and grades appear only in the test Supabase project.
6. Keep the production site's `academix-config.js` pointed at the production project. Never put Supabase service-role keys or AI provider keys in this file or in any frontend file.

## Important implementation note

This first Phase 4 change makes frontend environment selection explicit and adds a visible environment indicator. It does **not** automatically provision a second Supabase project, copy database schema, or enforce a test/production flag inside one shared database. Those tasks require Supabase dashboard/CLI access and a separately configured deployment. Until those checks are complete, treat Phase 4 as in progress and do not use real student records for testing.

## Smoke-test checklist

- [ ] Test site shows `ENVIRONMENT: TEST`.
- [ ] Test site's config URL matches the test project, not production.
- [ ] Test project's schema/migrations are applied and RLS is enabled.
- [ ] Test users, exams, submissions, and grades exist only in the test project.
- [ ] Production site still points to the production project.
- [ ] No service-role or provider secrets exist in frontend files or Git history.
