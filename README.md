# Hero Tech Academy

A real coding academy for kids — Hero Tech Academy runs live,
instructor-led coding courses for kids (ages 6–16). This project is both
the public marketing site parents see and the internal school-operations
platform staff use to run it, deployed on Vercel and Supabase with real
per-person logins: every Manager, Instructor, and Student signs in with
their own username (email) and password.

## Account Types (Internal — the School's Operations Side)

These are the logins staff and students use once they're enrolled — not
something sold to other schools:

- **Manager** (Super Admin / School Admin under the hood) — full school
  operations. Creates Manager, Instructor, and Student accounts, adds new
  instructor and student profiles (not just logins for existing ones),
  manages classes, groups, materials, assignments, reports, settings,
  incoming Contact Requests, and Reviews. A Manager-issued "Manager"
  login is always the `School Admin` role under the hood — nobody can
  self-service a second `Super Admin` from the UI or the API.
- **Instructor** — manages their assigned classes: can create new classes
  (self-assigned), create new Student profiles and issue their logins
  (only for students in their own classes), split a class into Groups,
  upload Materials for a class or a specific group, and create
  Assignments (optionally scoped to one group).
- **Student** — signs in to see their own assignments, attendance,
  grades, and any Materials shared with their class or their group.

(There is also an optional Parent/Guardian role inherited from the
original build, kept in case it's useful later — it isn't one of the
three account types issued from Accounts & Logins.)

## Marketing Homepage

Opening the site shows the public homepage first — a hero pitched at
parents ("Where Kids Learn to Code, Create, and Build Real Projects"), a
trust stats strip (**60+ students trained so far**, ages served, live
instructor-led format), a **How It Works** 3-step section, an **Our
Coding Programs** section broken out by age band (with a short skill-tag
list per track), a comparison section against generic alternatives
(pre-recorded video courses, one-off workshops), a reviews section from
parents and students, a **Contact us / Request a call** form, and links
to the school's Facebook page and WhatsApp — with a **Login** button in
the header for staff/students/parents who already have portal accounts,
and a "book a trial class" popup (image + one button) that appears on
every visit — including a plain page refresh — and jumps straight to the
Contact form.

- `programTracks`, `sampleReviews`, and `compareRows` in `src/app.js` hold
  starter content — real course tracks, real reviews, and real comparison
  points can replace it any time. None of it is labeled as "sample" on the
  live site itself; that context lives only in code comments for whoever
  edits the file next.
- `trustStats` in `src/app.js` holds the "60+ students trained" stat strip
  — update the numbers there as your real enrollment grows.
- The homepage popup (`src/assets/promo-different-start.jpg`, shown via
  the `promo-overlay` markup in `marketingScreen()`) shows on every visit
  to the homepage, including a plain page refresh — dismissing it only
  clears an in-memory flag for that page load, nothing is remembered in
  storage. Its **Fill the form** button scrolls straight to the real
  Contact form below — submissions land in the same **Contact Requests**
  panel every Manager already has, so there's nothing extra to check.
  Swap the image or copy any time by editing that file and the
  `promo-modal-body` text in `src/app.js`.
- Real reviews: any visitor can submit a review from the **Leave a
  review** form on the homepage. Submissions land as `pending` in a
  Supabase table (`reviews`, see migration `0005`) and are invisible to
  the public until a Manager approves them from the in-app **Reviews**
  panel. Approved reviews then appear on the homepage alongside the
  sample ones — English and Arabic both render correctly (`dir="auto"`).
- Social links: `school.social.facebook` and `school.social.whatsapp` in
  `src/app.js` drive the Facebook/WhatsApp links shown in the nav,
  contact section, and footer.
- The contact form inserts into a Supabase table (`contact_requests`, see
  migration `0004`) so submissions show up for Managers in the
  **Contact Requests** panel inside the app. Without Supabase configured,
  both the contact form and the review form just show a local "thanks"
  message instead of failing.

## Classes, Groups, Materials, and Assignments (needs migration `0006`)

Once `0006_instructor_operations.sql` has run, a Manager or Instructor can
do real day-to-day class operations from the dashboard instead of just
viewing pre-loaded data:

- **Instructors** (its own **Instructors** tab in the sidebar, right
  above Students — Manager only): lists every instructor with their
  classes and portal-access status, and **Add instructor** creates a real
  instructor record, issuing their first login in the same step if left
  checked. Do this first on a brand-new school — classes need an
  instructor to assign, so this is the natural starting point.
- **Classes** (Courses and Classes -> **New class**): create a class and
  self-assign an instructor. Instructors can only create classes assigned
  to themselves; Managers pick from any existing instructor.
- **Students** (Courses and Classes or Accounts & Logins -> **Add
  student**): creates a real student record in a chosen class and, if
  left checked, issues their first login. Instructors can only add
  students to their own classes.
- **Managers** (Accounts & Logins -> **Add manager**, Manager only):
  issues another Manager login — always the underlying `School Admin`
  role.
- **Groups** (a class tile's **Manage groups** button): split a class
  into smaller groups and pick which students belong to each one.
- **Materials** (**Materials** in the sidebar -> **Upload material**):
  upload a file for a class, optionally scoped to one group, into a
  private Supabase Storage bucket; students/parents only ever see the
  materials their own class or group RLS policy allows.
- **Assignments** (Assignment Center -> **New assignment**): create an
  assignment for a class, optionally scoped to one group.

**Order matters on a brand-new school**: Add an instructor first, then a
class (it needs an instructor to assign), then students/groups/materials/
assignments (they need a class to belong to). If you open "Add a class"
with zero instructors yet, or "Add a student"/"Upload material"/"New
assignment" with zero classes yet, the dashboard shows what to create
first instead of a dead-end empty dropdown — click through that prompt
rather than assuming the button is broken.

All of this is enforced with real row-level security, not just hidden
buttons — see "Groups, Materials, and Group-Scoped Assignments" in
`docs/architecture.md` for exactly which policies back each action.

## Local Checks

```bash
npm test
npm run build
```

`npm run build` produces a static site in `dist/`. Serving `dist/` with
`npm run preview` (or any static file server) is fine for browsing the UI,
but the "Generate login" / "Reset password" actions in Accounts & Logins
call a Vercel serverless function (`/api/create-account.js`) that a plain
static server cannot run. Use `vercel dev` locally, or the deployed Vercel
URL, to exercise that flow end to end.

## Supabase

Run these in Supabase SQL Editor, in order:

1. `supabase/migrations/0001_dashboard_foundation.sql`
2. `supabase/seed.sql`

For real school data with real logins, also run, in order:

3. `supabase/migrations/0002_production_rls.sql`
4. `supabase/migrations/0003_auth_accounts.sql`
5. `supabase/migrations/0004_contact_requests.sql`
6. `supabase/migrations/0005_reviews.sql`
7. `supabase/migrations/0006_instructor_operations.sql` — adds Groups,
   Materials, and lets Instructors create their own classes/students (see
   "Classes, Groups, Materials, and Assignments" above). Safe to run any
   time after `0002`; everything already using this app keeps working
   without it, it just won't have these newer features yet.

Then follow "Bootstrap the first admin" in `docs/deploy-vercel-supabase.md`
so someone can sign in and start issuing Instructor/Student credentials.

## Vercel

Set these environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, used exclusively by
  `/api/create-account.js` to create and reset logins. Never expose this
  key to the browser or add it to `src/config.js`.

Vercel settings:

- Framework: Other
- Build command: `npm run build`
- Output directory: `dist`

Vercel automatically deploys everything under `/api` as serverless
functions regardless of the static output directory, so no extra
configuration is needed for account creation to work once deployed.

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
  but only for Students in their own classes. The temporary password is
  shown once — share it with that person right away.
- Everyone is required to set their own password the first time they sign
  in with a temporary one.

## Security

See `docs/security-test-report.md` and `docs/deploy-vercel-supabase.md` before using real student data.
