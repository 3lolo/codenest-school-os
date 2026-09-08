# Coding School Management Platform Architecture

## Stack

This first implementation is a self-contained frontend foundation using plain HTML, CSS, and JavaScript so it can run in a restricted workspace without package installation. The intended production evolution is:

- Frontend: React or Next.js with route-level authorization and accessible component primitives.
- Backend: Node.js/NestJS or Django with modular domains.
- Database: PostgreSQL.
- Queue: Redis-backed worker queue for notifications and long-running jobs.
- Storage: S3-compatible object storage with signed URLs and strict access checks.
- Email: Provider abstraction for SES, SendGrid, Postmark, or SMTP.

## Currently Shipped vs. Aspirational

Most of this document (from here through "Application Domains",
"Notification Architecture", and the `/families` / `/communications` /
`/notifications` / `/audit-logs` entries under "API Boundaries") describes
a possible *future* production backend — none of it is built. What's
actually shipped today is the vanilla-JS + Supabase app described in the
"RBAC Model" and later sections ("Credential Issuance", "Groups,
Materials, and Group-Scoped Assignments", "Attendance and Staff
Requests", "Marketing Homepage").

As of 2026-09-08 the shipped app's sidebar has 14 tabs: Dashboard,
Instructors, Students, Classes, Assignments, Attendance, Requests
(Staff Requests), Reports, Materials, Accounts & Logins, Contact
Requests, Reviews, Work With Us (Opportunities), and Settings. Four
tabs that once existed in the UI — Families, Messages/Communications,
Notifications, and an Audit Log — were removed: none of them had a
working button or a backing table anywhere in the shipped schema,
confirmed by grepping the full codebase. See
`docs/security-test-report.md` for details. This document's
Notification Architecture / families / audit-log sections below are
kept as design notes for if those get built for real later — they are
not a description of removed functionality regressing, since none of
it was ever implemented in the first place.

Two features live only in the "shipped" half of this document, added
in `0009_opportunities_and_removal_requests.sql`:

- **Opportunities (Work With Us)**: `public.opportunities`, Manager
  write, anyone-read-if-open. Powers a public section on the marketing
  homepage. See "Opportunities (Work With Us)" below.
- **Removal and removal requests**: a Manager can delete an Instructor
  or Student record and login outright, via `api/remove-account.js`.
  An Instructor cannot — they submit a `staff_requests` row of kind
  `removal`, scoped by RLS to a student in one of their own classes,
  which a Manager approves from the Requests panel. See "Removal and
  Removal Requests" below.

## Application Domains

- Identity and access: users, roles, permissions, invitations, sessions, password resets.
- School structure: schools, academic years, programs, courses, modules, classes, cohorts.
- People: students, families, guardians, instructors, admins.
- Academics: enrollments, attendance, assignments, submissions, grades, progress.
- Communication: announcements, direct messages, communication history.
- Notifications: notification preferences, notification events, email templates, email logs.
- Finance and documents: payments, fees, invoices, student documents, assignment files.
- Governance: audit logs, settings, security events.

## RBAC Model

Authorization must be enforced server-side on every sensitive request.

The product exposes exactly three account *types* that get issued from
Accounts & Logins — **Manager**, **Instructor**, **Student** — displayed
that way in the UI (`roleLabel()` in `src/security.js`). Underneath, the
role column still stores the original five-tier values so RLS keeps its
existing granularity:

- Super Admin / School Admin (both shown as **Manager**): full school
  operations. Only Super Admin can reach platform Settings and Audit Logs.
  A Manager can also issue a login for another **Manager** — always
  created as the underlying `School Admin` role, never a second
  `Super Admin`, so nobody can self-service the top tier from the UI or
  the API.
- Instructor: assigned classes, students in assigned classes, attendance,
  assignments, grading, related parent contact data. Can create new
  classes (self-assigned), create new Student profiles and issue their
  logins, create Groups within their own classes, upload Materials, and
  create Assignments — all scoped to their own classes at the database
  level (`supabase/migrations/0006_instructor_operations.sql`), not just
  in the UI.
- Student: own profile, own enrollments, own assignments, own grades, own
  attendance, learning resources shared with their class or their group.
- Parent or Guardian: only linked children and communications addressed to
  the family (kept for schools that want it; not one of the three issued
  account types).

Recommended implementation:

- Store atomic permissions such as `student.read`, `assignment.grade`, `settings.update`.
- Assign permissions to roles through `role_permissions`.
- Apply row-level ownership checks for students, parents, instructors, classes, and files.
- Log authorization-sensitive actions in `audit_logs`.

### Credential Issuance

Every Manager, Instructor, and Student signs in with their own Supabase
Auth username (email) and password instead of a shared/preview identity:

- A **Manager** issues the first login for anyone from the Accounts &
  Logins panel — Manager, Instructor, or Student. An **Instructor** can
  also open Accounts & Logins, but it only lists (and only lets them
  issue/reset logins for) students in their own classes.
- The server (`api/create-account.js`) re-verifies the caller's role with
  the `service_role` key before doing anything — the browser's claimed
  role is never trusted. When the caller is an Instructor, it additionally
  re-checks that the target student's `class_id` is one of that
  instructor's own classes before issuing or resetting anything. A
  "Manager" role from the client is always aliased server-side to the
  underlying `School Admin` role, and only an existing Manager can issue
  one — an Instructor cannot, no matter what the request claims.
- Creating a brand-new Instructor or Student *profile* (not just a login
  for one that already exists) is a separate step: the "Add instructor" /
  "Add class" / "Add student" forms in the dashboard insert directly into
  `instructors` / `classes` / `students` using the signed-in user's own
  Supabase session — allowed only where RLS already permits it (Manager
  for any row, Instructor only for rows tied to their own classes; see
  `0002_production_rls.sql` and `0006_instructor_operations.sql`) — and
  then optionally call the same account-issuance endpoint to give that
  new profile its first login.
- A temporary password is generated server-side (`api/_lib/password.js`),
  shown once in the UI, and never stored in plain text.
- Every new or reset account is flagged `must_change_password`; the person
  is forced onto a "set a new password" screen on their first sign-in.
- `user_profiles.student_id` / `user_profiles.instructor_name` link the
  auth user to their school record, which the existing row-level security
  policies (see `supabase/migrations/0002_production_rls.sql`) already key
  off of. A Manager account has no such record — it's linked by `email`
  alone.

### Groups, Materials, and Group-Scoped Assignments

Added in `supabase/migrations/0006_instructor_operations.sql`:

- **Groups** (`groups`, `group_members`): an Instructor (or Manager) can
  split a class into smaller groups and assign students to them. Reads
  and writes are scoped to the class's own instructor (or a Manager); a
  Student/Parent can read a group only if one of their own linked
  students is a member of it. The read/write policies on both tables,
  and on `materials` below, are backed by two `security definer` helper
  functions, `public.instructor_owns_class()` and `public.can_view_group()`
  — they exist specifically so `groups`'s policy and `group_members`'s
  policy never query each other's table directly. An earlier version did
  exactly that (a plain `EXISTS` subquery in each direction), which
  Postgres detects as a policy-evaluation cycle and rejects with
  `infinite recursion detected in policy for relation "groups"` — a real
  bug that shipped in the original `0006`, fixed in the current version
  of that file and, for projects that already ran the old one, by
  `0008_fix_group_recursion.sql`. See `docs/security-test-report.md` for
  how this was reproduced and verified against a real Postgres instance.
- **Materials** (`materials` table + a private `materials` Storage
  bucket): an Instructor (or Manager) uploads a file, tags it with a
  class and optionally one group, and it becomes downloadable to whoever
  the `materials` table's RLS policy says can see that class/group (its
  group-scoped branch goes through `can_view_group()` for the same
  recursion-avoidance reason as above). The Storage bucket itself is only
  scoped one class at a time (objects live under `<class_id>/<file>`),
  not per-group — see the note at the bottom of the migration for what
  that trade-off means and how to tighten it later if it matters in
  practice.
- **Assignments** gained an optional `group_id` so a single assignment
  can target one group instead of the whole class; the existing
  Instructor-write policy on `assignments` did not need to change, only
  the read policy did.

### Attendance and Staff Requests

Added in `supabase/migrations/0007_staff_requests_attendance.sql`:

- **Attendance** (`attendance_records`): one row per student per class
  per day, written by the "Take attendance" modal via a PostgREST upsert
  (`Prefer: resolution=merge-duplicates`, keyed on the table's
  `unique (student_id, class_id, session_date)` constraint), so
  re-submitting a day overwrites it instead of duplicating rows. Reads
  and writes are scoped the same way as `materials`/`assignments` — a
  Manager sees everything, an Instructor only their own classes, and a
  Student/Parent only through `public.can_view_student()`. The Attendance
  tab's older per-student counters on `students` (`attendance`,
  `absences`, `late`) are untouched by this — they're a separate,
  manually-maintained summary, not derived from `attendance_records` yet.
- **Staff Requests** (`staff_requests`): an Instructor sends a `message`
  or a `holiday` request (with optional start/end dates); a Manager reads
  every request (`public.is_admin()`) and is the only one who can change
  its `status` (`pending` / `approved` / `denied` / `read`) — an
  Instructor can insert and read their own requests but has no update
  policy at all, so a sent request can't be edited or its decision
  overwritten after the fact.

### Removal and Removal Requests

Added in `supabase/migrations/0009_opportunities_and_removal_requests.sql`,
on top of the "students write admin" / "instructors admin write" RLS
policies `0002_production_rls.sql` already granted a Manager (those
already covered plain `DELETE` at the database level — this migration
adds nothing new there):

- **Direct removal** (`instructorsView()` / `studentProfile()` in
  `src/app.js`, both gated by `canRemoveAccounts()` in `src/security.js`,
  Manager-only): calls `api/remove-account.js`, which re-verifies the
  caller is a Manager server-side with the `service_role` key — the same
  rule `api/create-account.js` follows for issuing logins, never trusting
  a role claimed by the browser — then deletes the person's auth user (if
  a login was ever issued; this cascades to their `user_profiles` row)
  and their `students`/`instructors` row, in that order. Removing an
  Instructor is blocked with a 409 if `classes.instructor` still
  references them, since that's a plain text match rather than a real
  foreign key and the database wouldn't otherwise stop it. Removing a
  Student needs no such guardrail: `attendance_records`,
  `group_members`, and `parent_student_links` all reference
  `students.student_id` with `on delete cascade`, verified against a
  real local Postgres instance (seed a student with an attendance
  record, a group membership, and a parent link, delete the student as
  an authenticated Manager, confirm all three are gone).
- **Removal requests** (`staff_requests.kind = 'removal'`): an
  Instructor cannot delete a student directly — RLS grants them no
  `DELETE` policy on `students` at all — so they submit a `staff_requests`
  row carrying `target_student_id`/`target_student_name` (plain text
  snapshots, not real foreign keys, for the same reason
  `instructor_name` elsewhere in this table isn't one: the request is a
  historical record that should survive the student row it named being
  deleted, not disappear or block the deletion). The insert policy
  additionally requires, when `kind = 'removal'`, that the named student
  actually belongs to a class taught by the requesting instructor —
  verified against a real Postgres instance: a same-class removal
  request succeeds, a request naming a different instructor's student is
  rejected by RLS before it ever reaches the table. Approving one (from
  `staffRequestRow()`'s "Approve & remove" button, still the Manager's
  own session) calls `api/remove-account.js` exactly as a direct removal
  would, then marks the request `approved` only if that removal actually
  succeeded — a failed removal leaves the request `pending` rather than
  silently marking it decided.

## Marketing Homepage

`src/app.js` renders a public marketing screen (`marketingScreen()`) as
the very first thing a visitor sees, before any login. It is pitched at
parents and prospective students — Hero Tech Academy is a real coding
academy for kids, not a platform sold to other schools; the Manager /
Instructor / Student roles described elsewhere in this doc are the
internal operations side, not the homepage's sales pitch. It covers:

- Hero copy aimed at parents ("Where Kids Learn to Code, Create, and
  Build Real Projects"), a `trustStats` strip (60+ students trained so
  far, ages served, live instructor-led format), a "How It Works" 3-step
  section (`howItWorks`), and an "Our Coding Programs" section
  (`programTracks`, with a short skill-tag list per track) broken out by
  age band. None of this is labeled "sample" on the live site itself —
  that context lives only in code comments for whoever edits the file
  next — so replace the copy with the school's real curriculum whenever
  it's ready, without it ever looking like placeholder content to a
  visiting parent.
- A "how it compares" section (`compareRows`) — against generic
  alternatives (pre-recorded video courses, one-off workshops) from a
  parent's buying perspective.
- A reviews section that renders `[...state.publicReviews, ...sampleReviews]`
  — real, Manager-approved reviews first, then starter reviews (three
  English, two Arabic) as filler until enough real ones exist, with no
  "sample" label shown to visitors either way. Quotes render with
  `dir="auto"` so Arabic and English both display with correct text
  direction.
- A public "Leave a review" form (`handleReviewSubmit()`) that inserts
  into `public.reviews` (migration `0005_reviews.sql`) using the anon key
  under an insert-only RLS policy restricted to `status = 'pending'`.
  Managers moderate submissions from the in-app **Reviews** panel
  (`reviewsView()` / `setReviewStatus()`), gated by `public.is_admin()`;
  only `status = 'approved'` rows are ever publicly readable
  (`loadPublicReviews()`).
- A **Work With Us** section (`state.publicOpportunities`, loaded by
  `loadPublicOpportunities()`) that lists every `public.opportunities`
  row with `status = 'open'`, readable by anyone under RLS (no anon key
  even required to be signed in for). Managers post and remove openings
  from the in-app **Work With Us** panel (`opportunitiesView()`), gated
  by `public.is_admin()` the same way Reviews is — `for all`, not just
  update, since a Manager can delete a posting outright, not only change
  its status. There's no separate application table: an interested
  visitor is pointed at the existing Contact form (`#contact`), so an
  application lands in the same **Contact Requests** panel every other
  inquiry does.
- Facebook and WhatsApp links (`socialLinksHtml()`, driven by
  `school.social.facebook` / `school.social.whatsapp`) shown in the nav,
  the contact section, and the footer.
- A Contact us / Request a call form that inserts into
  `public.contact_requests` (migration `0004_contact_requests.sql`) using
  the anon key under an insert-only RLS policy. Managers read submissions
  from the in-app **Contact Requests** panel (`leadsView()`), gated by
  `public.is_admin()`.

Clicking **Login** moves to the real Supabase sign-in screen when
Supabase is configured. There is no demo/preview mode — until Supabase is
connected, **Login** shows a plain "not connected yet" screen instead of a
dashboard, and every list in the app (students, classes, assignments,
etc.) starts empty rather than shipping with fabricated sample rows. The
homepage's own starter content (`programTracks`, `howItWorks`,
`sampleReviews`, `compareRows`, `trustStats`) is the only content that
ships before Supabase has real rows to show — update it (especially the
`trustStats` numbers) as real enrollment grows past the current 60+
students trained. The homepage popup (`promo-overlay` in
`marketingScreen()`) shows on every visit, including a plain page
refresh — it does not remember a dismissal in storage — so update
`src/assets/promo-different-start.jpg` and the modal copy any time
without worrying about visitors having "already seen" the old version.

## Notification Architecture

Application event -> Notification service -> Queue -> Email worker -> Email provider.

Core behavior:

- UI handlers create domain events; they do not send email directly.
- Notification service resolves recipients, preferences, templates, and idempotency keys.
- Queue worker sends email or in-app notifications asynchronously.
- Failed deliveries record provider error details, retry count, next retry time, and final status.
- Templates support variables such as `student_name`, `parent_name`, `assignment_name`, `due_date`, `course_name`, `school_name`, and `portal_url`.

Example events:

- `student.created`: create invitation, send welcome email, audit event.
- `parent.created`: link children, send portal activation email, audit event.
- `assignment.published`: notify students and, if enabled, guardians.
- `attendance.threshold_reached`: notify admin and linked guardians.
- `grade.published`: notify student and optionally guardians.

## API Boundaries

- `/auth`: login, logout, refresh, activation, password reset.
- `/users`: user lifecycle, role assignment, account status.
- `/students`: profiles, academic summary, family links.
- `/families`: guardians, children, emergency contacts.
- `/courses`: programs, courses, modules.
- `/classes`: cohorts, schedules, instructors, enrollments.
- `/attendance`: attendance sessions, marks, thresholds, reports.
- `/assignments`: assignment lifecycle, publication, attachments.
- `/submissions`: uploads, grading, feedback, late status.
- `/communications`: announcements, direct messages, history.
- `/notifications`: notification center, preferences, templates, delivery logs.
- `/reports`: enrollment, attendance, academic, communication, finance exports.
- `/settings`: school configuration.
- `/audit-logs`: immutable audit stream.

All APIs should use schema validation, consistent error responses, rate limiting where needed, and permission middleware.
