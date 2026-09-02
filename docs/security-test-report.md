# Security Test Report

Date: 2026-09-02

## Result

Passed: 21 / 21 automated tests (one assertion updated to match the new
`issuableRolesFor()` behavior below; test count unchanged).

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
- A full inline-handler audit: every `onclick`/`onsubmit`/`oninput` in
  `src/app.js` (static and dynamically-built, e.g. the account row's
  generate/reset button) was cross-checked one-for-one against the
  functions exported on `window`, in both directions — this is the same
  class of bug as an earlier `setRole` regression that only a runtime
  check could catch. Two dead exports were found (`dismissContactNotice`,
  `dismissReviewNotice` had no button wired to them) and fixed by adding a
  dismiss button to both the contact and review success/error banners.
- A second Playwright pass clicked through every reachable control on the
  homepage in one run: all five nav anchor links (including the new "How
  it works" link) scroll to their section; the "book a trial class" popup
  opens on load, closes via its ✕ button, a click outside itself, and the
  Escape key, and its **Fill the form** button scrolls to and focuses the
  Contact form's name field; both the Contact and Leave-a-review forms
  submit and their dismiss buttons clear the notice; and Login -> "not
  connected yet" -> Back to homepage all round-trip cleanly. Zero console
  or page errors across the whole run.
- A third Playwright pass (this update) confirmed the popup no longer
  persists a dismissal anywhere: it shows on first load, is dismissible,
  and **reappears after a full page reload** — `sessionStorage` is no
  longer used for it at all, matching the "pop up appear with refresh"
  request. Zero console or page errors.
- A repeat of the full inline-handler audit (static, not just the earlier
  manual click-through) after adding the dashboard modals, Materials
  view, and all new `handleAdd*`/`openModal`/`closeModal` functions: every
  `onclick`/`onsubmit`/`onchange` call target in `src/app.js` was
  cross-checked against `window.*` exports in both directions. No dead
  handlers found.

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
  rejects an Instructor issuing anything but a Student account, rejects
  anyone but a Manager issuing a Manager (`School Admin`) account, and
  re-verifies that an Instructor's target student is in one of that
  instructor's own classes before issuing or resetting anything.
- Generated temporary passwords are 14 characters, include lower/upper/digit/symbol classes, exclude visually ambiguous characters, and are never repeated across 50 generations.
- `issuableRolesFor()` returns `["Manager", "Instructor", "Student"]` for
  a Manager and `["Student"]` for an Instructor — a Manager option is
  never offered to anyone but a Manager, in the UI or the underlying
  permission helper.
- Migration `0006`'s new instructor-write policies on `classes` and
  `students` are scoped with the same `profile.instructor_name = ...`
  join pattern already used by the existing (and already-tested)
  `assignments` write policy — an Instructor's insert/update is rejected
  by Postgres itself unless the row's `instructor` / `class_id` resolves
  back to their own `user_profiles.instructor_name`.
- `groups`, `group_members`, and `materials` read policies all resolve
  through `public.can_view_student()` for a Student/Parent, so the same
  scoping already relied on everywhere else in the schema (own record,
  linked children, own class) governs who can see a group's membership or
  a shared file — not a new, separately-reasoned-about check.

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

- A Manager session can create or reset a Manager, Instructor, or Student
  login. An Instructor session can create or reset a Student login **only
  for students in their own classes** — all of this is re-checked
  server-side (`api/create-account.js`) with the Supabase `service_role`
  key rather than trusted from the client. A "Manager" role is always
  aliased server-side to the underlying `School Admin` role; a second
  `Super Admin` is never issuable from anywhere in the app or the API.
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

## Not Yet Verified Live (Classes/Groups/Materials/Assignments, migration `0006`)

This environment cannot reach the project's Supabase or Vercel APIs at
all (an organization-level network policy rejects the connection outright
— confirmed with direct connection tests, not assumed), so the new
"Add class / instructor / student / manager / group / material /
assignment" flows could only be verified the way described above: syntax
checks (`node --check`), the full automated test suite (`npm test`,
21/21), a production build (`npm run build`), a static cross-check of
every new `onclick`/`onsubmit`/`onchange` handler against its `window.*`
export, and a Playwright pass confirming the popup-on-refresh change and
that the rest of the marketing homepage still has zero console errors.

What this update could **not** test end-to-end, because it requires a
live Supabase project and a live Vercel deployment: actually running
`0006_instructor_operations.sql`, creating a class/instructor/student/
manager/group/material/assignment through the new dashboard forms and
confirming the RLS policies behave as written (an Instructor's insert
being accepted for their own class and rejected for someone else's), and
downloading an uploaded file back out of the `materials` Storage bucket.
Please run migration `0006` and click through each new "Add ..." button
once as a Manager and once as an Instructor test account before relying
on this in production — and see the note at the bottom of
`0006_instructor_operations.sql` about the Materials Storage bucket being
scoped per-class rather than per-group, which is a deliberate scope
trade-off, not an oversight.
