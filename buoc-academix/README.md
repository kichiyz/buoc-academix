# BUOC AcademiX

A responsive static frontend starter for a Supabase-powered assessment platform.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. Configure Auth email confirmation and password policies.
4. In `app.js`, replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your project URL and publishable/anon key.
5. Deploy the Edge Function:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set LLM_API_KEY=YOUR_SERVER_SIDE_KEY
   supabase secrets set LLM_API_URL=https://api.openai.com/v1/chat/completions
   supabase secrets set LLM_MODEL=gpt-4o-mini
   supabase secrets set ALLOWED_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io
   supabase functions deploy generate-quiz
   ```
6. Enable the `generate-quiz` function's JWT verification. Do not disable authentication.
7. Publish this repository with GitHub Pages.

## Important security work before production

This is a starter scaffold, not a production-certified or flawless exam system. Review and finish the following before real student use:

- Create a trusted administrator workflow to approve verified BU accounts and assign teacher/admin roles. Never accept role selection from signup metadata.
- Add a `submit_exam` PostgreSQL RPC (or authenticated Edge Function) that locks the attempt, validates the assignment, grades objective answers server-side, writes `submissions` and `grades` atomically, and prevents duplicate/late submissions. The frontend calls this RPC, but the SQL function is intentionally not included as a fake implementation.
- The `questions` table contains answer keys. PostgreSQL RLS is row-level, not column-level. In production, revoke direct student `SELECT` access to `questions` and expose safe question fields through a secured view/RPC; teachers can retain access. The example safe RPC shows the intended response shape, but the current broad question policy must be tightened before live use.
- Add explicit assignment management, roster import, attempt rules, audit logs, rate limits, storage bucket policies, and backups.
- The CSV export query may need its profile relationship alias adjusted to match the foreign-key names in your project.
- Validate generated questions with faculty review. AI output can be wrong.
- Configure allowed origins and rate limiting on the Edge Function. Do not trust browser-provided claims.
- Use original/licensed BUOC artwork and authorized mascot assets. This starter uses abstract aura motifs rather than embedding a Pokémon image.

## GitHub Pages

The frontend is static. Supabase SQL and Edge Functions are deployed to Supabase separately. Never put `service_role` keys or AI provider keys in `index.html`, `style.css`, or `app.js`.
