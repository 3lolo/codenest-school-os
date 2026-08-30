# Implementation Plan

## Status

Phases 1 and 2 are implemented and finalized: three account types
(Manager / Instructor / Student) with real per-person Supabase Auth
logins, an Instructor-scoped account-issuance flow, row-level security,
and a public marketing homepage (hero, account-type breakdown, sample
comparison, sample reviews, and a Contact us / Request a call form) in
front of the sign-in screen. See `docs/architecture.md` and
`docs/deploy-vercel-supabase.md`. Phases 3 and 4 below remain the roadmap
for future work.

## Phase 1: Product Foundation

- Role-aware dashboard and navigation.
- Student, family, class, assignment, attendance, communication, report, notification, settings, and audit modules.
- Seeded operational data for realistic UX.
- Architecture notes and normalized PostgreSQL schema.
- Public marketing homepage with a Login button, account-type overview,
  comparison and reviews sections, and a Contact us / Request a call form.

## Phase 2: Backend

- Add PostgreSQL migrations from `schema.sql`.
- Implement authentication with hashed passwords, activation links, session management, CSRF protection, and rate limiting.
- Add permission middleware and row-level authorization helpers.
- Build modular APIs for students, families, courses, classes, assignments, submissions, attendance, notifications, reports, and settings.
- Manager and Instructor account issuance (`api/create-account.js`),
  scoped so an Instructor can only create/reset logins for students in
  their own classes.
- Public, insert-only Contact Requests table feeding an in-app leads panel.

## Phase 3: Automation

- Add domain event dispatcher.
- Add notification service, queue, worker, email templates, retry logic, and delivery logs.
- Generate activation links when students or guardians are created.
- Emit audit events for sensitive lifecycle changes.

## Phase 4: Production Hardening

- Add file upload validation, private object storage, signed URL access, malware scanning hooks, and file audit logs.
- Add reporting exports.
- Add monitoring, structured logging, test coverage, and backup/restore procedures.
- Add accessibility and cross-browser QA pass.
