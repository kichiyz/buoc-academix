# BUOC AcademiX

**BUOC AcademiX** is a starter platform for creating AI-assisted quizzes and practical examinations for the Bicol University community.

## Project structure

The frontend files are in the repository root so GitHub Pages can serve `index.html` directly:

- `index.html` — application interface
- `style.css` — responsive dark-purple and gold theme
- `app.js` — browser-side application logic
- `buoc-academix/supabase/schema.sql` — initial database schema and row-level security setup
- `supabase/migrations/20261027_exam_attempts.sql` — database migration for initial attempts, authorized retakes, and remedial attempts
- `buoc-academix/supabase/functions/generate-quiz/index.ts` — server-side quiz generation function

The earlier `buoc-academix/` directory may contain duplicate starter files. The root files are the intended GitHub Pages entry point.

## GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Choose branch **main** and folder **/(root)**, then click **Save**.
4. Wait for the deployment workflow to finish. GitHub will show the published site URL in the Pages section.

## Supabase setup

1. Create a Supabase project and keep its database password in a password manager.
2. In the SQL Editor, review and run `supabase/schema.sql` (or your canonical schema file if already applied).
3. Then review and run `supabase/migrations/20261027_exam_attempts.sql` to enable the `start_exam_attempt` and `authorize_exam_attempt` RPCs used by the app.
4. Deploy the Edge Function in `buoc-academix/supabase/functions/generate-quiz/` using the Supabase CLI.
5. Configure the required Supabase URL and publishable/anon key in the frontend only after checking the project settings and RLS policies.
6. Add the LLM provider API key as a **Supabase Edge Function secret**. Never put it in `app.js`, HTML, CSS, or any public repository file.

## Security and readiness notes

- This repository is public. Do not commit passwords, access tokens, service-role keys, private student data, or LLM API keys.
- A Supabase publishable/anon key is intended for client-side use only when Row Level Security (RLS) and policies are correctly configured.
- Do not use real student records or real examinations until authorization, access control, answer-key protection, submission/grading logic, and data retention have been reviewed and tested.
- This is a starter scaffold, not a production-ready or institutionally approved system. The database policies, quiz generation, and grading flow require end-to-end testing before use.
- The app is not officially affiliated with or endorsed by Bicol University unless separately authorized.

## Local development

You can open `index.html` directly for a basic interface preview. For authentication, database access, and AI generation, configure Supabase and deploy the Edge Function first. A local static server is recommended during development.

## License

No license has been added yet. Unless a license is added, standard copyright restrictions apply to reuse of this code.
