# Implementation Plan

## Phase 1: Product Foundation

- Role-aware dashboard and navigation.
- Student, family, class, assignment, attendance, communication, report, notification, settings, and audit modules.
- Seeded operational data for realistic UX.
- Architecture notes and normalized PostgreSQL schema.

## Phase 2: Backend

- Add PostgreSQL migrations from `schema.sql`.
- Implement authentication with hashed passwords, activation links, session management, CSRF protection, and rate limiting.
- Add permission middleware and row-level authorization helpers.
- Build modular APIs for students, families, courses, classes, assignments, submissions, attendance, notifications, reports, and settings.

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
