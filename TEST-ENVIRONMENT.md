# Isolated Test Environment

The sandbox runs a separate Supabase stack in Docker on this computer. It does not create or modify a hosted Supabase project. The production configuration remains unchanged.

## Requirements
- Docker Desktop running (WSL2/Linux containers)
- Supabase CLI available in PowerShell
- Python 3 for the static frontend server

## Start
1. Pull the latest repository changes.
2. Open PowerShell in the repository root.
3. Run: .\scripts\start-test-environment.ps1
4. Open http://127.0.0.1:4173 if it does not open automatically.

The script starts local Supabase, reads the local API URL and publishable/anon key, verifies the URL is localhost, and writes academix-config.local.js. That generated file is ignored by Git. The local config sets TEST mode and points only to localhost:54321.

## Stop
Run .\scripts\stop-test-environment.ps1. This stops the local Supabase stack and removes the generated local browser config.

## Safety and data
- Auth users, database rows, storage objects, and test submissions are stored in the local Docker database.
- Use synthetic test accounts and test data only. Never use real student records or grades.
- Never put service-role keys or AI provider secrets in browser files.
- The deployed GitHub Pages site does not load the local config and remains on its production configuration.
- The app rejects TEST mode if it is pointed at the known production Supabase URL.
- The dashboard health check tests the local Auth endpoint only; it is not proof that every exam workflow passes.
- Local data is disposable. To rebuild the local database after reviewing your local migrations, run supabase db reset from the repository root.

## Troubleshooting
- Start Docker Desktop if the script reports that Docker is unavailable.
- Run supabase status to inspect local services.
- If ports 54320–54324 are occupied, stop the conflicting local service and retry.
