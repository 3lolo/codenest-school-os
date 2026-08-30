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
  operations. Creates both Instructor and Student accounts, manages
  classes, reports, settings, incoming Contact Requests, and Reviews.
- **Instructor** — manages their assigned classes and can create/reset
  **Student** accounts, but only for students in their own classes.
- **Student** — signs in to see their own assignments, attendance, and
  grades.

(There is also an optional Parent/Guardian role inherited from the
original build, kept in case it's useful later — it isn't one of the
three account types issued from Accounts & Logins.)

## Marketing Homepage

Opening the site shows the public homepage first — a hero pitched at
parents ("Where Kids Learn to Code, Create, and Build Real Projects"), a
trust stats strip (**60+ students trained so far**, ages served, live
instructor-led format), an **Our Coding Programs** section broken out by
age band, a comparison section against generic alternatives (pre-recorded
video courses, one-off workshops), a reviews section from parents and
students, a **Contact us / Request a call** form, and links to the
school's Facebook page and WhatsApp — with a **Login** button in the
header for staff/students/parents who already have portal accounts.

- `programTracks`, `sampleReviews`, and `compareRows` in `src/app.js` hold
  clearly-labeled starter content ("Sample programs" / "Sample review" /
  "Sample comparison" tags) — replace with your real course tracks,
  competitors, and (as real reviews come in) let the sample reviews fall
  away naturally.
- `trustStats` in `src/app.js` holds the "60+ students trained" stat strip
  — update the numbers there as your real enrollment grows.
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

- A Manager issues an Instructor's or Student's first username and
  password from **Accounts & Logins**. An Instructor can do the same, but
  only for Students in their own classes. The temporary password is shown
  once — share it with that person right away.
- Everyone is required to set their own password the first time they sign
  in with a temporary one.

## Security

See `docs/security-test-report.md` and `docs/deploy-vercel-supabase.md` before using real student data.
