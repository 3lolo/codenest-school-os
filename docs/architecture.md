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

- Super Admin: full platform and settings access.
- School Admin: school operations except platform-level role/settings control.
- Instructor: assigned classes, students in assigned classes, attendance, assignments, grading, related parent contact data.
- Student: own profile, own enrollments, own assignments, own grades, own attendance, learning resources.
- Parent or Guardian: only linked children and communications addressed to the family.

Recommended implementation:

- Store atomic permissions such as `student.read`, `assignment.grade`, `settings.update`.
- Assign permissions to roles through `role_permissions`.
- Apply row-level ownership checks for students, parents, instructors, classes, and files.
- Log authorization-sensitive actions in `audit_logs`.

### Credential Issuance

Every instructor and student signs in with their own Supabase Auth
username (email) and password instead of a shared/preview identity:

- A Super Admin or School Admin issues the first login for a person from
  the Accounts & Logins panel. The server (`api/create-account.js`)
  re-verifies the caller's role with the `service_role` key before doing
  anything — the browser's claimed role is never trusted.
- A temporary password is generated server-side (`api/_lib/password.js`),
  shown once in the UI, and never stored in plain text.
- Every new or reset account is flagged `must_change_password`; the person
  is forced onto a "set a new password" screen on their first sign-in.
- `user_profiles.student_id` / `user_profiles.instructor_name` link the
  auth user to their school record, which the existing row-level security
  policies (see `supabase/migrations/0002_production_rls.sql`) already key
  off of.

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
