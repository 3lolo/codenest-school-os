# Security Test Report

Date: 2026-08-30

## Result

Passed: 19 / 19 automated tests.

Commands run:

- `npm test`
- `npm run build`
- `node --check src/app.js`
- `node --check src/security.js`
- `node --check src/supabaseAuth.js`
- `node --check api/create-account.js`
- `node --check api/_lib/password.js`
- `node --check build.mjs`
- Headless-browser smoke test (Playwright) of: the marketing homepage
  rendering with no JS errors; clicking **Login** entering demo mode;
  switching the demo role switcher to Instructor and confirming
  **Accounts & Logins** (relabeled "Student Logins" for that role) appears
  and shows the scoped view; and submitting the Contact us form.

## What Was Tested

- Student role cannot access settings, audit logs, reports, or family directory.
- Parent role cannot access settings, audit logs, reports, or family directory.
- Instructor role cannot access settings, audit logs, or family directory.
- School Admin can access reports but not platform settings.
- Super Admin can access settings and audit logs.
- Managers (Super Admin, School Admin) and Instructors can reach Accounts
  & Logins; Students and Parents cannot.
- Only Managers can reach the Contact Requests (leads) module.
- `roleLabel()` presents Super Admin/School Admin as "Manager" in the UI
  without changing the underlying role values RLS depends on.
- `canManageAnyAccounts()` / `issuableRolesFor()`: Managers can issue
  Instructor and Student logins; Instructors can issue Student logins
  only.
- Student can only see their own student record.
- Parent can only see linked children.
- Instructor can only see students in assigned classes.
- Global search removes unauthorized student, family, and staff records.
- Production Supabase RLS migration (`0002`) uses authenticated policies
  and avoids public read-all policies.
- Contact Requests migration (`0004`) only allows public **insert** (for
  the homepage form) — never public read or update.
- `api/create-account.js` re-derives the caller's role from their own
  authenticated profile row (never trusts a role claimed by the browser),
  rejects an Instructor issuing anything but a Student account, and
  re-verifies that an Instructor's target student is in one of that
  instructor's own classes before issuing or resetting anything.
- Generated temporary passwords are 14 characters, include lower/upper/digit/symbol classes, exclude visually ambiguous characters, and are never repeated across 50 generations.

## Separation Model

Frontend:

- Navigation is generated from role permissions.
- Student lists are filtered through `canViewStudent`.
- Search results are filtered before display.
- The marketing homepage is the first thing every visitor sees; **Login**
  moves to the real sign-in screen when Supabase is configured, or into
  the demo/preview role switcher when it isn't.
- An Instructor's Accounts & Logins view is filtered to their own students
  via `filterStudentsForViewer` — the same helper used everywhere else in
  the app to scope an instructor's view.

Database:

- Production policies use Supabase Auth through `auth.uid()`.
- Students are linked to their own `student_id`.
- Parents are linked through `parent_student_links`.
- Instructors are linked through assigned classes.
- Managers have wider operational access.
- Only Super Admin can read audit logs or update platform settings.
- `user_profiles` is readable by its owner or an admin only; writes to role/student/instructor linkage are restricted to the service-role account creation endpoint, never to a generic authenticated-write policy, to prevent self-escalation.
- `contact_requests` accepts anonymous **inserts only** (the public
  homepage form), with basic non-empty/length checks in the insert
  policy itself; only `public.is_admin()` (a Manager) can select or
  update rows.

Account issuance:

- A Manager session can create or reset an Instructor or Student login. An
  Instructor session can create or reset a Student login **only for
  students in their own classes** — both are re-checked server-side
  (`api/create-account.js`) with the Supabase `service_role` key rather
  than trusted from the client.
- The Instructor scoping check cross-references `students.class_id`
  against the classes returned for `classes.instructor = <caller's
  instructor_name>`; a mismatch (or a caller with no linked instructor
  record) is rejected with a 403 before any account is touched.
- New and reset accounts are marked `must_change_password`; the temporary password is shown once in the admin UI and is never persisted in plain text.
- A dedicated `mark_password_changed()` Postgres function (not a generic UPDATE policy) is the only way a signed-in user can clear their own `must_change_password` flag, so a user cannot use that same access to change their own role.

## Important Publishing Note

The first Supabase migration is for demo publishing with sample public
data. For real school data, run the production RLS migration (`0002`),
the accounts migration (`0003`), and the contact-requests migration
(`0004`), and require Supabase Auth before adding private student or
parent records, issuing real logins, or collecting real contact-form
submissions.
