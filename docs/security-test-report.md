# Security Test Report

Date: 2026-09-06

## Result

Passed: 21 / 21 automated tests.

## Latest Update: A Failed Table Could Hide Every Other Tab's Data, Plus a Second Recursion Spot in Assignments

After the previous fix shipped, the Manager reported the 500s were
"still the same" on the live site, and separately that a newly-added
instructor didn't show up on the Instructors tab. Both traced back to
the same underlying fragility, found by reading `loadFromSupabase()`
(the function every tab's data comes from) closely rather than guessing:

**The real bug.** `loadFromSupabase()` fetched all ~14 tables with
`Promise.all(...)`. Four of them (`groups`, `group_members`,
`materials`, `attendance_records`/`staff_requests`) were already wrapped
in `.catch(() => [])` from earlier fixes, but the other nine —
including `instructors`, `students`, `classes`, and `assignments` — were
not. `Promise.all` rejects as soon as *any* one of its promises rejects,
so a single failing table (any one of those nine) aborted the *entire*
refresh. Because the code only reassigns `people`/`classes`/etc. on
success, an aborted refresh silently kept every tab showing whatever
was loaded the *previous* time — including right after adding a new
instructor: the write itself succeeded, but the follow-up reload that
should have shown it failed elsewhere and got thrown away wholesale, so
the new row was sitting in the database the whole time, just never
re-fetched. The only visible sign was a small "Demo fallback" label in
the sidebar, easy to miss while looking at a table.

**Fixed:** every one of the ~14 table fetches in `loadFromSupabase()` is
now wrapped individually. A table that fails keeps showing its last
successfully-loaded data (never blanked, never silently swapped for
something stale-and-wrong) while every table that *did* load refreshes
normally — so one bad table can no longer hide a real write on an
unrelated tab. The sidebar/topbar status text now also says exactly
which table(s) failed to load ("Everything loaded except: X, Y")
instead of a generic "Demo fallback," so a real failure is visible
instead of silent.

**Second finding while tracing this:** `assignments`'s read policy (in
`0006_instructor_operations.sql`) had the *same* pattern that caused the
groups/materials recursion bug — its group-scoped branch queried
`group_members` directly instead of through `can_view_group()`. Since
`assignments` was one of the nine tables with no `.catch()`, if this
ever threw (recursion or otherwise) on a live project, it would have
silently taken down every other tab's refresh with it, which lines up
exactly with both symptoms reported. Fixed the same way as the other
three tables, verified against a real local Postgres instance the same
way as the original fix (fresh full migration run, and a run against a
database that already had the *previous* version of `0008` applied) —
both a Manager, the assignment's own instructor, and an unrelated
instructor see exactly the right rows, no recursion error either way.
`supabase/migrations/0008_fix_group_recursion.sql` was updated in place
to include this — **if you already ran an earlier copy of `0008`,
running the updated one again is safe** (every statement is
create-or-replace / drop-and-recreate) and picks up the `assignments`
fix.

Re-verified: `node --check src/app.js`, `npm test` (21/21), `npm run
build`.

## Earlier Update: Fixed a Real RLS Recursion Bug (500s on Groups/Materials) and a Confusing 409 on Instructors

A Manager reported four errors from the live site: HTTP 500 on
`groups`, `group_members`, and `materials`, and HTTP 409 on `instructors`.
Both are now fixed and, unlike a plain code-review guess, both were
reproduced against a real Postgres database before being fixed, and
re-verified against the same database afterward.

**The 500s — root cause.** `0006_instructor_operations.sql` originally
scoped reads on `groups` with an `EXISTS` subquery against
`group_members`, and scoped reads on `group_members` with an `EXISTS`
subquery right back against `groups`. Postgres evaluates row-level
security for every table touched while answering a query — including a
table only touched inside another table's own policy — so reading
`groups` re-triggered `group_members`'s policy, which re-triggered
`groups`'s policy again. Postgres detects that cycle and refuses to
evaluate it, raising `infinite recursion detected in policy for relation
"groups"` (or `"group_members"`). PostgREST has no special handling for
that error, so it passes it straight through as an HTTP 500 with no
useful detail — exactly the blank 500s reported. `materials`'s read
policy queried `group_members` the same way, so any material scoped to a
group hit the identical error.

This was not a configuration problem, a missing migration, or a data
issue — it was a genuine bug in how migration `0006` wrote those three
policies, present since that migration was first written, that only
shows up once real Instructor/Student accounts start reading Groups or
group-scoped Materials.

**How it was verified, not guessed.** This sandbox cannot reach the
project's real Supabase instance (see "Not Yet Verified Live" below), so
instead of reasoning about the SQL by hand, a real local PostgreSQL 16
instance was used to build a faithful stand-in for Supabase's runtime:
stub `auth`/`storage` schemas matching Supabase's own (`auth.users`,
`auth.uid()`, `storage.buckets`/`objects`), the real `anon`/
`authenticated`/`service_role` roles Supabase uses, every migration file
from this repo loaded verbatim in order (`0001` through `0007`), and
realistic seed data (one instructor, one class, one student, one group,
one group member, one material). Running the exact failing queries as
that signed-in Instructor (`SET ROLE authenticated; SET
request.jwt.claim.sub = '<uuid>'`) reproduced the user's precise error
message. The fix below was then applied to that same database and the
same queries were re-run — no more recursion error, and the Instructor
saw exactly their own class's group, its one member, and its material
(a second, unrelated Instructor with no ties to that class correctly saw
zero rows, not an error). The same sequence was repeated from a
completely fresh database running the *current* migration files start to
finish, and separately, against a database that had only the *old,
buggy* `0006` applied followed by the new `0008` patch — both paths
verified clean.

**The fix.** Same pattern this codebase already uses for `is_admin()`
and `can_view_student()` (`0002_production_rls.sql`): move the
cross-table check into a `security definer` SQL function.
`security definer` functions run as their (superuser-privileged) owner,
so their internal queries bypass RLS entirely instead of re-triggering
another table's policy, breaking the cycle. Two new functions,
`instructor_owns_class()` and `can_view_group()`, now back the read *and*
write policies on `groups`, `group_members`, and `materials`.

- `supabase/migrations/0006_instructor_operations.sql` was edited in
  place so a **brand-new** Supabase project that hasn't run it yet gets
  the correct version directly — nothing to patch afterward.
- `supabase/migrations/0008_fix_group_recursion.sql` is a new, additive
  migration for a project (like the one that reported this) that already
  ran the old, buggy `0006`. It only creates/replaces the two functions
  and re-creates the affected policies — it's safe to run once, and safe
  to run again if needed. **Run this migration in Supabase's SQL Editor
  to apply the fix to your live project.**

**The 409 on `instructors` — separate issue, also fixed.** This one
was a real unique-constraint violation, not a bug: `instructors.email`
has been `unique` since `0001_dashboard_foundation.sql`, so re-submitting
"Add instructor" with an email already in use is correctly rejected by
Postgres with HTTP 409. The bug was on the frontend: `supabaseInsert()`
in `src/app.js` showed the raw Postgres error text
(`duplicate key value violates unique constraint "instructors_email_key"`)
verbatim in the modal, which is accurate but not something a Manager
should have to parse. `supabaseInsert()` and `supabaseUpsert()` now
detect a 409 and, when the error identifies which field collided (email,
a `group_id`, a `class_id`, etc.), show a plain message like `That email
("ali@example.com") is already in use — please use a different one.`
instead — the same underlying rule, a clearer message.

Re-verified: `node --check src/app.js`, `npm test` (21/21), `npm run
build`, and the static onclick/onsubmit/onchange-to-`window.*` export
audit (no new handlers were added by this fix).

## Earlier Update: Attendance, Staff Requests, Students Tab, and Diagnosing an RLS Error

A Manager reported two errors while testing as an Instructor test
account: `No API key found in request` and `new row violates row-level
security policy for table "classes"` while trying "Add a class."

Investigated both:

- Audited every direct-to-Supabase `fetch()` call in `src/app.js` (there
  are 10) and confirmed every single one sends the `apikey` header —
  none were missing it. That error therefore did not come from this
  app's own rendered UI (the account-issuance API's raw upstream error
  text is never shown to the browser either — only a friendly
  `body.error` string is). It's most likely either a Vercel
  `SUPABASE_ANON_KEY` configuration issue (worth double-checking) or a
  request made outside the app (curl/Postman/the URL bar) while testing.
  Documented the distinction and what to check in the README so it's
  diagnosable without needing me to reproduce it.
- The RLS violation on "classes" is real and traced to its actual cause:
  the form was showing a fixed instructor name with no dropdown (the
  Instructor-role branch of "Add a class"), meaning the account testing
  it was signed in as an Instructor — and an Instructor's insert into
  `classes` only became legal once migration `0006` added the
  `"classes write instructor own"` policy. If `0006` hasn't been run yet
  on the live project, this exact error is expected, not a code bug.
  Flagged this prominently in the README's Supabase section.

Also this update: a real Students-tab "New student" button (opens the
same Add Student form used elsewhere), a class filter, a client-side CSV
export, clickable rows that load a student's profile (now including
their class and Groups), a working "Take attendance" flow
(`attendance_records`, migration `0007`), and a Staff Requests feature
letting an Instructor message Managers or request time off
(`staff_requests`, same migration) with Manager-only approve/deny/mark-
read actions.

Re-verified: `node --check` on every touched file, `npm test` (21/21),
`npm run build`, and the static onclick/onsubmit/onchange-to-
`window.*` export audit (38 calls, 37 exports — the two "missing" hits
are false positives from the regex matching `escapeJs(...)` and
`document.getElementById(...)` inside handler-string source text, not
real dead handlers).

## Earlier Update: Instructors Tab + Fixed a Real Bootstrap Dead End

A Manager reported "I cannot add student." Tracing it through: the "Add
student" form required picking an existing class from a dropdown, and the
"Add class" form required picking an existing instructor from a dropdown
— on a brand-new school with nothing created yet, both dropdowns start
empty, so a required `<select>` with zero options can never be submitted.
That's a real usability dead end, not a permissions bug (a Manager's
Supabase session was never actually blocked by RLS from any of these
inserts).

Fixed by:

- Adding a dedicated **Instructors** tab (Manager-only, positioned above
  Students in the sidebar) with its own **Add instructor** entry point
  that has no dependency on anything else existing first — this is now
  the natural first step on a new school.
- When "Add a class" is opened with zero instructors, or "Add a
  student"/"Upload material"/"New assignment" is opened with zero classes
  available to the current viewer, the modal now shows a plain-language
  explanation and a button straight to the form that unblocks it
  (`emptyDependencyNotice()` in `src/app.js`), instead of a dead-end empty
  required dropdown that looks like a broken button.
- Instructor logins moved off the general Accounts & Logins panel onto
  the new Instructors tab, so a Manager has one obvious place per account
  type: Instructors tab for instructors, Accounts & Logins for students
  and other managers.

Re-verified after this change: `node --check` on every touched file,
`npm test` (21/21), `npm run build`, the static onclick/onsubmit/onchange
-to-`window.*` export cross-check (no dead handlers), and a Playwright
pass confirming the marketing homepage and popup-on-refresh behavior are
unaffected with zero console errors. The dependency-notice branches
themselves (what a Manager actually sees stepping through Instructors ->
Classes -> Students with a fresh, empty school) still need a live
click-through against a real Supabase project — see "Not Yet Verified
Live" below, which now also covers this.

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

## Not Yet Verified Live (Classes/Groups/Materials/Assignments/Attendance/Staff Requests, migrations `0006`-`0007`)

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
Please run migrations `0006` and `0007` and click through each new
"Add ..." button, "Take attendance", and "New request" once as a Manager
and once as an Instructor test account before relying on this in
production — and see the note at the bottom of
`0006_instructor_operations.sql` about the Materials Storage bucket being
scoped per-class rather than per-group, which is a deliberate scope
trade-off, not an oversight.

**Update:** the specific read policies on `groups`, `group_members`, and
`materials` referenced above *have* since been verified for real — not
against live Supabase (still unreachable from this sandbox), but against
a real local PostgreSQL 16 instance built to faithfully stand in for it
(the actual migration files, the real `anon`/`authenticated`/
`service_role` roles, stub `auth`/`storage` schemas). See "Latest Update"
above for what that caught (a genuine RLS recursion bug) and how it was
fixed. Everything else in this section — Classes, Assignments,
Attendance, Staff Requests, and the Materials Storage bucket itself —
is still only verified the way described above (syntax checks, the
automated suite, a build, and a static handler audit), not against a
real database, so the same click-through on a live project remains the
right way to confirm those specifically before relying on them in
production.
