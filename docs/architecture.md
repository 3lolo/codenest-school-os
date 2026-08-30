# Coding School Management Platform Architecture

## Stack

This first implementation is a self-contained frontend foundation using plain HTML, CSS, and JavaScript so it can run in a restricted workspace without package installation. The intended production evolution is:

- Frontend: React or Next.js with route-level authorization and accessible component primitives.
- Backend: Node.js/NestJS or Django with modular domains.
- Database: PostgreSQL.
- Queue: Redis-backed worker queue for notifications and long-running jobs.
- Storage: S3-compatible object storage with signed URLs and strict access checks.
- Email: Provider abstraction for SES, SendGrid, Postmark, or SMTP.

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
- Instructor: assigned classes, students in assigned classes, attendance,
  assignments, grading, related parent contact data. Can also create or
  reset **Student** logins, but only for students in their own classes.
- Student: own profile, own enrollments, own assignments, own grades, own
  attendance, learning resources.
- Parent or Guardian: only linked children and communications addressed to
  the family (kept for schools that want it; not one of the three issued
  account types).

Recommended implementation:

- Store atomic permissions such as `student.read`, `assignment.grade`, `settings.update`.
- Assign permissions to roles through `role_permissions`.
- Apply row-level ownership checks for students, parents, instructors, classes, and files.
- Log authorization-sensitive actions in `audit_logs`.

### Credential Issuance

Every Instructor and Student signs in with their own Supabase Auth
username (email) and password instead of a shared/preview identity:

- A **Manager** issues the first login for anyone from the Accounts &
  Logins panel — Instructor or Student. An **Instructor** can also open
  Accounts & Logins, but it only lists (and only lets them issue/reset
  logins for) students in their own classes.
- The server (`api/create-account.js`) re-verifies the caller's role with
  the `service_role` key before doing anything — the browser's claimed
  role is never trusted. When the caller is an Instructor, it additionally
  re-checks that the target student's `class_id` is one of that
  instructor's own classes before issuing or resetting anything.
- A temporary password is generated server-side (`api/_lib/password.js`),
  shown once in the UI, and never stored in plain text.
- Every new or reset account is flagged `must_change_password`; the person
  is forced onto a "set a new password" screen on their first sign-in.
- `user_profiles.student_id` / `user_profiles.instructor_name` link the
  auth user to their school record, which the existing row-level security
  policies (see `supabase/migrations/0002_production_rls.sql`) already key
  off of.

## Marketing Homepage

`src/app.js` renders a public marketing screen (`marketingScreen()`) as
the very first thing a visitor sees, before any login. It covers:

- Hero + a breakdown of the three account types.
- A sample "how it compares" section (`compareRows`) and sample reviews
  (`sampleReviews`) — both clearly labeled as sample content to replace.
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
only sample content left is the two clearly-labeled sections on the
marketing homepage itself (`sampleReviews`, `compareRows`).

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
