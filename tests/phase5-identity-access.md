# Phase 5 — Identity & Access acceptance tests

Run only against the isolated local/test Supabase environment. Do not run destructive account tests against production.

## Required setup

1. Apply `supabase/migrations/20261028_phase5_identity_access.sql` to the isolated test database.
2. Deploy the `admin-control` Edge Function to that same test project.
3. Configure Edge Function secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key must never be placed in the browser or committed.
4. Use separate test accounts for an administrator, teacher, and student.

## Acceptance tests

- [ ] Unauthenticated calls to `admin-control` return 401.
- [ ] Student and teacher calls to `admin-control` return 403.
- [ ] Administrator account search returns account metadata without exposing password hashes or tokens.
- [ ] A role change succeeds only for an administrator and writes actor, target, action, reason, and timestamp to `admin_audit_log`.
- [ ] An administrator cannot change their own role.
- [ ] The last administrator cannot be demoted or suspended.
- [ ] Suspension records a reason, sets the profile suspension timestamp, and bans the Auth account.
- [ ] A suspended account cannot sign in/refresh after the Auth ban takes effect and cannot start exams because `is_verified()` returns false.
- [ ] Reactivation clears the profile suspension fields and removes the Auth ban.
- [ ] Verification changes are audited.
- [ ] Teacher-request approval/rejection updates the request record and is audited.
- [ ] Account deletion requires the UI's typed `DELETE` confirmation, removes the Auth user, and leaves an audit event identifying the deleted target.
- [ ] Audit listing is restricted to an active administrator.
- [ ] Request tampering (different target IDs, arbitrary roles, unsupported actions, self-targeting) does not bypass server authorization.
- [ ] Existing Phase 4 retake tests still pass, including preserving the original graded submission.

## Safety notes

- The branch is a development change only; it is not merged into `main` and has not been deployed.
- The migration and Edge Function must be tested together before merging.
- Verify the installed Supabase Auth version's ban/unban behavior in the isolated test project.
- Review the cascade behavior for account deletion before testing with any non-disposable account.
