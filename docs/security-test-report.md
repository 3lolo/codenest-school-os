# Security Test Report

Date: 2026-08-30

## Result

Passed: 21 / 21 automated tests.

Commands run:

- `npm test`
- `npm run build`
- `node --check src/app.js`
- `node --check src/security.js`
- `node --check src/supabaseAuth.js`
- `node --check api/create-account.js`
- `node --check api/_lib/password.js`
- `node --check build.mjs`
- Headless-browser smoke test (Playwright) of: the Hero Tech Academy
  marketing homepage rendering with no JS/console errors and the full-width
  layout (nav, hero, reviews, contact, footer all spanning the page rather
  than being squeezed into the dashboard's sidebar column); the Facebook
  and WhatsApp links in the nav, contact section, and footer resolving to
  the correct URLs (including the WhatsApp `wa.me` link built from the
  configured phone number); the reviews section rendering both English and
  Arabic sample reviews with correct right-to-left text direction; the
  "Leave a review" form submitting successfully and showing the pending-
  approval message when Supabase isn't configured; clicking **Login**
  without Supabase configured showing the "not connected yet" screen
  (confirming there is no demo dashboard, no fake sample data, and no role
  switcher anywhere in the app); "Back to homepage" returning to the
  marketing page; and submitting the Contact us form.

## What Was Tested

- Student role cannot access settings, audit logs, reports, or family directory.
- Parent role cannot access settings, audit logs, reports, or family directory.
- Instructor role cannot access settings, audit logs, or family directory.
- School Admin can access reports but not platform settings.
- Super Admin can access settings and audit logs.
- Managers (Super Admin, School Admin) and Instructors can reach Accounts
  & Logins; Students and Parents cannot.
- Only Managers can reach the Contact Requests (leads) module.
- Only Managers can reach the Reviews moderation module; Instructors,
  Students, and Parents cannot.
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
- Reviews migration (`0005`) only allows public **insert of `pending`
  rows** and public **read of `approved` rows** — pending/rejected reviews
  are never publicly readable, and only a Manager can change a review's
  status.
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
  moves to the real sign-in screen when Supabase is configured, or to a
  plain "not connected yet" screen when it isn't. There is no demo mode
  and no built-in sample data anywhere in the shipped app — every list
  (students, classes, assignments, etc.) starts empty until Supabase
  provides real rows.
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
- `reviews` accepts anonymous **inserts of `pending` rows only** (the
  public "Leave a review" form), with non-empty/length checks in the
  insert policy itself. Anonymous/authenticated reads are restricted to
  `status = 'approved'`; `public.is_admin()` (a Manager) can additionally
  select all rows (any status) and update a row's status.

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
the accounts migration (`0003`), the contact-requests migration (`0004`),
and the reviews migration (`0005`), and require Supabase Auth before
adding private student or parent records, issuing real logins, or
collecting real contact-form or review submissions.
