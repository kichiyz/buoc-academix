# BUOC AcademiX

BUOC AcademiX is a browser-based assessment platform for the Bicol University community. It provides role-based Student, Teacher, and Developer workspaces, assessment authoring, exam delivery, results views, and administrative operations.

> **Release notice:** A successful GitHub Pages deployment does not by itself mean the platform is approved for institutional use. Complete the release checks below before inviting real students or using live examinations.

## Application structure

GitHub Pages serves the frontend from the repository root:

- `index.html` — application markup and page structure
- `style.css` — responsive interface styles
- `app.js` — client-side application behavior
- `academix-config.js` — public Supabase URL, publishable key, and environment label
- `academix-build.js` — deployment build metadata
- `supabase/schema.sql` — canonical database schema
- `supabase/migrations/` — ordered database migrations, including `20261115000000_final_launch_course_outcomes.sql` for course INC/DRP decisions and the 75% final-course outcome rule
- `supabase/functions/` — server-side Supabase Edge Functions
- `supabase/tests/` — database regression tests
- `tests/` — frontend and application regression tests
- `docs/` — operational and environment documentation

The obsolete nested `buoc-academix/` starter copy has been removed. Keep the root frontend and root `supabase/` directory as the canonical application sources.

## Configuration and secrets

The committed `academix-config.js` is downloaded by every browser and must contain only the Supabase project URL, a publishable/anon key, and a non-secret environment label. A publishable key is not a substitute for correct Row Level Security.

Never commit:
- Supabase service-role or secret keys
- AI provider API keys
- Database passwords, access tokens, or private credentials
- Real student records, answer keys, or private examination content

Store privileged credentials as Supabase Edge Function secrets. Do not put them in HTML, CSS, frontend JavaScript, or GitHub Pages artifacts.

## Local development

Use the repository's local Supabase configuration and a local static server. Do not point local/test workflows at production unless the specific test is explicitly read-only and authorized.

Typical checks:

```powershell
node --check app.js
node --test tests/*.test.mjs
npx playwright test
supabase.cmd test db
supabase.cmd db lint --local
```

Run the relevant checks for the files changed. Playwright and Supabase CLI checks require their local dependencies and services.

## GitHub Pages deployment

The Pages workflow deploys the root frontend. Review the workflow run after merging changes to `main`; verify the deployed commit and test the live site after the deployment completes.

## Release checklist

- [ ] Confirm the production Supabase URL and publishable key are correct.
- [ ] Confirm all required migrations have been reviewed and applied to the intended project, including the final launch course-outcomes migration.
- [ ] Verify RLS policies and server-side authorization for every role and privileged action.
- [ ] Verify student signup, email confirmation, institutional verification, and password recovery redirects.
- [ ] Verify teacher authoring, publishing, assignment, submissions, grading, and results end to end.
- [ ] Verify student exam access, timed attempts, submission deadlines, retakes/remedials, and results.
- [ ] Verify administrative account controls and audit records.
- [ ] Verify Edge Functions are deployed and their secrets are configured.
- [ ] Run frontend and database regression suites.
- [ ] Test the live site on desktop and mobile after deployment.
- [ ] Obtain any required institutional authorization before representing the platform as an official Bicol University service.

## Academic result rules

- Assessment outcomes are calculated from the graded percentage: **Passed** at 75.00% or above; **Failed** below 75.00%.
- Course-level **INC** (Incomplete) and **DRP** (Dropped) are separate academic outcomes. INC is assigned by the instructor when completion is permitted. DRP requires a student drop request and instructor approval.
- The GWA conversion bands are institution-configured in the active academic term. The 75% assessment pass threshold does not replace the configured percentage-to-GWA conversion table.
- Light and dark appearance preferences are stored locally in the current browser; they do not affect authentication or permissions.

## Launch notes

The final launch interface uses the supplied circular BUOC favicon asset throughout the brand marks, responsive navigation, persistent account navigation, scrollable administrative registries, and reduced-motion-aware transitions. Review the newest release pull request and apply any new SQL migration to the intended Supabase project before testing course INC/DRP actions.

## Institutional affiliation

BUOC AcademiX is an independent project unless and until the relevant university offices formally authorize its use or endorsement.
