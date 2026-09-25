# Hero Tech Academy

A real coding academy for kids — Hero Tech Academy runs live,
instructor-led coding courses for kids (ages 6–16). This project is both
the public marketing site families see and the internal school-operations
platform staff use to run it, deployed on Vercel and Supabase with real
per-person logins: every Manager, Instructor, and Student signs in with
their own username (email) and password. The whole site — marketing
pages and the staff/student dashboard alike — is fully translated into
**Arabic (the default), Italian, and English**, with proper right-to-left
layout for Arabic (see "Languages" below).

## Account Types (Internal — the School's Operations Side)

These are the logins staff and students use once they're enrolled — not
something sold to other schools. There is no Parent/Guardian account:
each student has their own single account, full stop.

- **Manager** (Super Admin / School Admin under the hood) — full school
  operations. Creates Manager, Instructor, and Student accounts, adds new
  instructor and student profiles (not just logins for existing ones),
  and is the only role that can create a **Group** (Groups are the sole
  class-like container — see "Groups, Materials, and Attendance" below).
  Also manages assignments, reports, settings, incoming Contact Requests,
  Reviews, and Work With Us opportunities. A Manager-issued "Manager"
  login is always the `School Admin` role under the hood — nobody can
  self-service a second `Super Admin` from the UI or the API. A Manager
  can also permanently **remove** any Instructor or Student — this
  deletes both their school record and their portal login in one step
  (see "Removing an Instructor or Student" below).
- **Instructor** — runs the group(s) a Manager assigned them to: can
  create new Student profiles and issue their logins (only for students
  in their own groups), upload Materials to their own group's page, and
  take Attendance for their own group, per session. An Instructor cannot
  create a Group themselves — only a Manager does that — and cannot
  delete a student directly; they can **request** one be removed from
  the Requests tab, scoped to a student in one of their own groups, for
  a Manager to decide on. An Instructor can also chat with the students
  in their own group — every message is visible to every Manager too
  (see "Group Chat" below).
- **Student** — signs in to see their own group, assignments, grades,
  materials, and their group's chat with their instructor. There is no
  separate family/parent login — a student's own account is the only way
  into the portal for them.

## Marketing Homepage

Opening the site shows the public homepage first — a hero pitched at
families ("Where Kids Learn to Code, Create, and Build Real Projects"), a
trust stats strip (**60+ students trained so far**, ages served, live
instructor-led format), a **How It Works** 3-step section, an **Our
Coding Programs** section broken out by age band (with a short skill-tag
list per track), a comparison section against generic alternatives
(pre-recorded video courses, one-off workshops), a **Gallery** of photos
and videos from previous sessions, a reviews section from students and
their families, a **Work With Us** careers section, a **Contact us /
Request a call** form, and links to the school's Facebook page and
WhatsApp — with a **Login** button in the header for staff/students who
already have portal accounts, a language switcher (Arabic / Italian /
English), and a "group of 5" offer popup (image + headline + one button)
that appears on every visit — including a plain page refresh — and jumps
straight to the Contact form.

- `programTracks`, `sampleReviews`, and `compareRows` in `src/app.js` hold
  starter content — real course tracks, real reviews, and real comparison
  points can replace it any time. None of it is labeled as "sample" on the
  live site itself; that context lives only in code comments for whoever
  edits the file next.
- `trustStats` in `src/app.js` holds the "60+ students trained" stat strip
  — update the numbers there as your real enrollment grows.
- **Gallery**: `galleryItems` in `src/app.js` starts empty on purpose — no
  stock or placeholder photos are shown in its place, just a friendly
  "coming soon" message, since showing fake "previous class" photos would
  be misleading. Add real photos/videos from actual sessions to
  `src/assets/gallery/` and list them in `galleryItems` (image and video
  entries are both supported — see the code comment right above it for
  the exact shape) whenever you have real ones to share.
- **The "group of 5" offer popup**
  (`src/assets/promo-different-start.jpg`, shown via the `promo-overlay`
  markup in `marketingScreen()`) shows on every visit to the homepage,
  including a plain page refresh — dismissing it only clears an
  in-memory flag for that page load, nothing is remembered in storage.
  Its copy tells visitors that a group of 5 signing up together only
  pays for 4, and its button scrolls straight to the real Contact form
  below — submissions land in the same **Contact Requests** panel every
  Manager already has, so there's nothing extra to check. Edit the offer
  copy in `src/i18n.js` (the `promo.title` / `promo.body` / `promo.cta`
  keys, in all three languages) and swap the image by replacing that
  file.
- Real reviews: any visitor can submit a review by clicking the **★ Leave
  a review** button next to the reviews heading, which opens the review
  form in a popup (rather than showing the form open by default).
  Submissions land as `pending` in a Supabase table (`reviews`, see
  migration `0005`) and are invisible to the public until a Manager
  approves them from the in-app **Reviews** panel. Approved reviews then
  appear on the homepage alongside the sample ones — every language
  renders correctly, including Arabic's right-to-left layout.
- "How We Compare" is a set of three side-by-side cards (not a table) —
  Hero Tech Academy, pre-recorded video courses, and one-off workshops —
  each listing the same feature checklist from `compareRows`, with the
  Hero Tech Academy card visually highlighted as the recommended option.
- Social links: `school.social.facebook` and `school.social.whatsapp` in
  `src/app.js` drive the Facebook/WhatsApp links shown in the nav,
  contact section, and footer.
- The contact form inserts into a Supabase table (`contact_requests`, see
  migration `0004`) so submissions show up for Managers in the
  **Contact Requests** panel inside the app. Without Supabase configured,
  both the contact form and the review form just show a local "thanks"
  message instead of failing.

## Languages (Arabic default, Italian, English)

Every screen — the marketing homepage and the whole staff/student
dashboard — is translated into Arabic, Italian, and English, using the
small i18n layer in `src/i18n.js`. Arabic is the default language a
first-time visitor sees, and it renders fully right-to-left (the page's
`dir` attribute switches automatically, and the layout — sidebar,
tables, chat bubbles, modals — mirrors correctly). A language switcher
(the globe-style pill group next to the theme toggle) is available on
every marketing page and every auth screen, and the chosen language is
remembered per-browser the same way the light/dark theme is. To add or
edit copy, find the relevant `"namespace.key"` entry in `src/i18n.js` and
edit it in all three language blocks (`en`, `ar`, `it`) — `t()` falls
back to English and then to the raw key if a translation is ever
missing, so a typo in one language degrades gracefully instead of
crashing the page.

## Groups, Materials, Attendance, and Chat (needs migration `0011`)

Once `0011_groups_replace_classes_drop_parent.sql` has run, **Groups**
is the one and only class-like container in the app — there is no
separate Classes tab, no school-wide Materials tab, and no school-wide
Attendance tab. Everything for a given group — its course, schedule,
room, roster, materials, and attendance — lives on that group's own
page:

- **Instructors** (its own **Instructors** tab in the sidebar, right
  above Students — Manager only): lists every instructor with their
  portal-access status, and **Add instructor** creates a real instructor
  record, issuing their first login in the same step if left checked. Do
  this first on a brand-new school — a group needs an instructor to
  assign, so this is the natural starting point.
- **Groups** (**Groups** in the sidebar -> **New group**, Manager only):
  create a group with a course, instructor, schedule, and room. Only a
  Manager can create or edit a group — an Instructor is assigned to one
  by a Manager but can never create one themselves, even for their own
  roster.
- **Students** (Groups, a group's own page, or Accounts & Logins ->
  **Add student**): creates a real student record in a chosen group and,
  if left checked, issues their first login. Instructors can only add
  students to their own groups.
- **Managers** (Accounts & Logins -> **Add manager**, Manager only):
  issues another Manager login — always the underlying `School Admin`
  role.
- **Materials**: open a group's own page and click **Upload materials**
  — visible only there, not as a separate sidebar tab. Instructors see
  this button only on a group they're assigned to; a Manager sees it on
  every group. Files land in a private Supabase Storage bucket; a
  student only ever sees the materials for their own group.
- **Attendance**: also on a group's own page (Manager, or that group's
  own Instructor only) — pick a date (defaults to today), mark each
  student Present/Absent/Late/Excused, and **Save attendance**.
  Re-opening the same group and date shows what was already marked (it
  overwrites that day's rows instead of duplicating them) so correcting
  a mistake is just re-saving. There is no school-wide Attendance tab —
  an Instructor only ever takes attendance for their own group, one
  session at a time.
- **Assignments** (Assignment Center -> **New assignment**): create an
  assignment for a group.
- **Group Chat** (**Chat** in the sidebar): an Instructor chats with the
  students in their own group; a Manager can see and post in every
  group's chat (picking which group from a dropdown), so nothing an
  Instructor says to students happens outside a Manager's visibility. A
  Student only sees their own group's chat.

**Order matters on a brand-new school**: Add an instructor first, then a
group (it needs an instructor to assign), then students/materials/
assignments (they need a group to belong to). If you open "New group"
with zero instructors yet, or "Add a student"/"Upload materials"/"New
assignment" with zero groups yet, the dashboard shows what to create
first instead of a dead-end empty dropdown — click through that prompt
rather than assuming the button is broken.

All of this is enforced with real row-level security, not just hidden
buttons — see `docs/architecture.md` for exactly which policies back
each action.

**Seeing `new row violates row-level security policy for table "..."`?**
That means the row-level security migration those buttons depend on
hasn't been run yet in Supabase's SQL Editor — it's not a bug in the
button, and it's not something retrying fixes. Run the migrations listed
under **Supabase** below, in order, especially `0011` (Groups replacing
Classes, and removing the Parent role/tables).

## Students Tab

The Students list (sidebar -> **Students**) has a **New student** button
(same "Add a student" form as Groups/Accounts & Logins), a group filter
dropdown, and an **Export CSV** button that downloads the
currently-filtered list. Click any row to load that student into the
profile panel on the right — it also shows their group.

## Staff Requests — Instructors Messaging Managers (needs migration `0007`; removal requests need `0009` and `0011`)

**Requests** in the sidebar: an Instructor's **New request** button
sends a quick **Message**, a **Time off request** (with start/end
dates), or a **Student removal** request (pick a student from a
dropdown scoped to the instructor's own groups) straight to every
Manager. Managers see every request here with **Approve** / **Deny** /
**Mark read** actions — for a removal request, **Approve** is labeled
**Approve & remove** and actually deletes the student's record and
login in the same click (see "Removing an Instructor or Student"
below); denying or marking it read does nothing to the student. An
Instructor sees only their own requests and the status a Manager gave
them — they can send a new one but can't edit or delete a sent request,
so it stays a reliable record of what was actually asked and decided.

## Removing an Instructor or Student (needs migration `0009`)

A Manager can permanently remove any Instructor (from the **Remove**
button on the Instructors tab) or Student (from the **Remove student**
button on that student's profile panel on the Students tab). Both go
through `api/remove-account.js`, a server endpoint that re-verifies the
caller is actually a Manager before doing anything — the same rule
`api/create-account.js` already follows for issuing logins — and does
two things in one step: deletes the person's portal login, if one was
ever issued, and deletes their school record. Everything that pointed at
that record (attendance, grades) is cleaned up automatically by the
database.

An Instructor never gets a Remove button anywhere — the only path for
them is the removal *request* described above, and even an approved
request is carried out under the Manager's own session, never the
requesting instructor's.

Removing an Instructor who still has groups assigned is blocked with a
clear message asking the Manager to reassign or delete those groups
first, rather than silently leaving groups pointing at nobody.

## Work With Us — Opportunities (needs migration `0009`)

**Work With Us** in the sidebar (Manager only): **Add opportunity**
posts a job opening (title, location, type, description) that appears
immediately on the public marketing homepage's **Work With Us** section
— visible to every visitor, signed in or not. Each posting can be
**Closed** (hidden from the public page, kept in the list for later) or
**Reopened**, and **Remove** deletes it outright.

Clicking **View details & apply** on a posting opens that opportunity's
own page — its own URL (`#opportunity-<id>`, so it can be copied and
shared directly, and survives a page refresh), with the full
description and a **How to apply** section. That section shows a
`mailto:` link, pre-filled with a subject line naming the role, to
whatever address is set as **Careers email** in **Settings → Work With
Us**. Until a Careers email is set, applicants are pointed at the
existing Contact form instead, with a note to mention which role
they're applying for — there's no separate résumé/application upload
pipeline, on purpose, so every inquiry lands in the one Contact
Requests panel a Manager already checks.

## Sidebar Tabs — What's Here and Why (as of 2026-09-25)

The sidebar currently has these tabs, all of them backed by a real table
and a real write path: **Dashboard, Instructors, Students, Groups,
Assignments, Grades, Chat, Requests, Reports, Accounts & Logins, Contact
Requests, Reviews, Work With Us, Settings, Profile** (Work With Us and
Settings are Manager-only; see "Account Types" above for what each role
can see). There is no separate Classes, Materials, or Attendance tab —
those live on a group's own page now (see "Groups, Materials,
Attendance, and Chat" above) — and there is no Parent/family tab or
account type at all: a student's own single account is the only login
tied to them.

Tabs that used to exist here — **Families**, **Messages**,
**Notifications**, **Audit Log**, and the standalone **Classes**,
**Materials**, and **Attendance** tabs — were removed: the first four
after a full-codebase check found none of them had a single working
button or any table they could write to (placeholders left over from an
earlier draft), and the latter three because Groups absorbed everything
they did (a group's own page is now the one place to manage its
materials and attendance, and Groups itself replaced Classes as the
sole class-like container — see migration `0011`). If a real family
directory, staff messaging, notification center, or audit trail is
wanted later, that's new work to scope, not something to "turn back on."

Two tabs that looked similarly unfinished had a real table to attach to,
so they were fixed instead of removed:

- **Reports** — Export CSV now downloads a real file built from the
  numbers already on the page. The PDF export and "schedule a report"
  buttons were removed rather than left as dead buttons, since no export
  pipeline for those exists yet.
- **Settings** — Save changes now really saves (school name, portal URL,
  absence threshold, due-soon hours, upload limit, parent-assignment
  emails) to the `school_settings` table.

See `docs/security-test-report.md` for the full list of what was checked
and how.

## Local Checks

```bash
npm test
npm run build
```

`npm run build` produces a static site in `dist/`. Serving `dist/` with
`npm run preview` (or any static file server) is fine for browsing the UI,
but the "Generate login" / "Reset password" actions in Accounts & Logins
and the "Remove" actions on Instructors/Students call Vercel serverless
functions (`/api/create-account.js`, `/api/remove-account.js`) that a
plain static server cannot run. Use `vercel dev` locally, or the deployed
Vercel URL, to exercise those flows end to end.

## Supabase

Run these in Supabase SQL Editor, in order:

1. `supabase/migrations/0001_dashboard_foundation.sql`
2. `supabase/seed.sql`

For real school data with real logins, also run, in order:

3. `supabase/migrations/0002_production_rls.sql`
4. `supabase/migrations/0003_auth_accounts.sql`
5. `supabase/migrations/0004_contact_requests.sql`
6. `supabase/migrations/0005_reviews.sql`
7. `supabase/migrations/0006_instructor_operations.sql` — adds
   sub-groups and Materials, and lets Instructors create their own
   classes/students (superseded by `0011` below, which merges classes
   into Groups — see "Groups, Materials, Attendance, and Chat" above).
   Safe to run any time after `0002`; everything already using this app
   keeps working without it, it just won't have these newer features
   yet.
8. `supabase/migrations/0007_staff_requests_attendance.sql` — adds the
   Attendance and Staff Requests tables/policies described above. Also
   safe to run any time after `0002`.
9. `supabase/migrations/0008_fix_group_recursion.sql` — **run this if you
   already ran `0006` before this fix landed, and re-run it again if you
   ran an earlier copy of `0008` before 2026-09-06.** The original `0006`
   shipped with a real bug: reading Groups, group-scoped Materials, or a
   group-scoped Assignment could fail with `infinite recursion detected
   in policy for relation "groups"` (an HTTP 500 in the browser) — and
   because that failure wasn't isolated to just those tabs, it could
   silently block *every* tab's data from refreshing (a newly-added
   Instructor not showing up after "Add instructor" was one symptom of
   this, not a separate bug). This patch fixes the database side of it
   in place — safe to run once, and harmless to run again, including if
   you already ran an earlier copy of this same file. If you're setting
   up a brand-new project today, the current `0006` already has this fix
   baked in, so running `0008` afterward is a no-op but still safe.
10. `supabase/migrations/0009_opportunities_and_removal_requests.sql` —
    adds the `opportunities` table (Work With Us) and extends
    `staff_requests` with the "removal" kind (see "Removing an
    Instructor or Student" and "Work With Us" above). Safe to run any
    time after `0007`; everything already using this app keeps working
    without it, it just won't have these two features yet.
11. `supabase/migrations/0010_grades_and_chat.sql` — adds the `grades`
    and `messages` tables (see "Group Chat" above and the Grades tab).
    Safe to run any time after `0006`.
12. `supabase/migrations/0011_groups_replace_classes_drop_parent.sql` —
    **required.** Merges the old `classes` table into `groups` (course,
    instructor, schedule, room, and status all move onto `groups`
    itself), renames every other table's `class_id` column to
    `group_id` with a real foreign key, drops the old sub-group
    (`group_members`) layer since Groups is now the single flat
    container, and removes the Parent role and its tables
    (`parents`, `parent_student_links`) entirely — including from the
    `user_profiles.role` check constraint, so a Parent login can no
    longer even be created. This is the migration that takes the app
    from "Classes + optional sub-groups + an unused Parent role" to
    "Groups only, no Parent role" as described throughout this README.
    Back up first if you have real production data — this one drops
    columns and tables, not just adds them.

Then follow "Bootstrap the first admin" in `docs/deploy-vercel-supabase.md`
so someone can sign in and start issuing Instructor/Student credentials.

**Every migration from `0002` onward must actually be run** for its
feature to work — the app can't detect a skipped migration and warn you;
it just surfaces whatever Postgres/PostgREST says. Two errors you'll see
if one is missing or if RLS is doing its job correctly against an
unauthorized request:

- `new row violates row-level security policy for table "..."` — either
  a migration that adds a needed policy hasn't run yet, or (working as
  intended) the signed-in user genuinely isn't allowed to write that row
  (e.g. an Instructor trying to insert a group assigned to a *different*
  instructor).
- `No API key found in request` / `No apikey request header or url param
  was found` — this is Supabase rejecting a request that has no `apikey`
  header at all. Every direct Supabase call in `src/app.js` always sends
  one (`config.supabaseAnonKey`), so seeing this from inside the app
  itself would mean `SUPABASE_ANON_KEY` isn't actually reaching the
  deployed site — double-check it's set in Vercel's environment variables
  and that you redeployed after adding it. If you saw this while testing
  the API directly (curl, Postman, the URL bar) rather than through the
  app's own UI, it just means that particular request needs an `apikey`
  header added.
- A plain HTTP 500 on `groups`, `group_members`, or `materials` (visible
  in the browser console as `Failed to load resource: the server
  responded with a status of 500`) — this was a real bug in the original
  `0006_instructor_operations.sql`, not something wrong with your setup.
  Run `supabase/migrations/0008_fix_group_recursion.sql` to fix it; see
  `docs/security-test-report.md` for the root cause.

## Vercel

Set these environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, used exclusively by
  `/api/create-account.js` (create and reset logins) and
  `/api/remove-account.js` (remove an instructor or student and revoke
  their login). Never expose this key to the browser or add it to
  `src/config.js`.

Vercel settings:

- Framework: Other
- Build command: `npm run build`
- Output directory: `dist`

Vercel automatically deploys everything under `/api` as serverless
functions regardless of the static output directory, so no extra
configuration is needed for account creation to work once deployed.

## Auto Sign-Out After 3 Minutes Idle

Once signed in, the app watches for mouse movement, clicks, keystrokes,
scrolling, and touch — if none of that happens for **3 minutes**, it signs
the person out automatically and shows "You were signed out after 3
minutes of inactivity" on the login screen. This protects a shared or
public computer (a classroom, a library) from being left logged in to a
real Manager/Instructor/Student account. It only runs while someone is
actually signed in — never on the public marketing homepage or the login
screen itself, and it doesn't fire from background activity, only real
input. There's no setting to change the 3-minute window from the UI yet;
it's the `IDLE_TIMEOUT_MS` constant near the auth handlers in
`src/app.js`.

## Logging In

There is no demo mode. Visiting the site always shows the marketing
homepage first; clicking **Login**:

- Goes to a real Supabase sign-in screen once `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` are set in Vercel and migrations 0002-0004 have run.
- Otherwise shows a plain "this portal isn't connected yet" message — never
  a fake dashboard or sample data.

Once connected:

- A Manager issues a Manager's, Instructor's, or Student's first username
  and password from **Accounts & Logins**. An Instructor can do the same,
  but only for Students in their own groups. The temporary password is
  shown once — share it with that person right away.
- Everyone is required to set their own password the first time they sign
  in with a temporary one.

## Security

See `docs/security-test-report.md` and `docs/deploy-vercel-supabase.md` before using real student data.
