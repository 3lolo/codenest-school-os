# CodeNest School OS

Coding school management platform for Vercel and Supabase, with a public
marketing homepage and real per-person login: every Manager, Instructor,
and Student signs in with their own username (email) and password.

## Account Types

- **Manager** (Super Admin / School Admin under the hood) — full school
  operations. Creates both Instructor and Student accounts, manages
  classes, reports, settings, and incoming Contact Requests.
- **Instructor** — manages their assigned classes and can create/reset
  **Student** accounts, but only for students in their own classes.
- **Student** — signs in to see their own assignments, attendance, and
  grades.

(There is also an optional Parent/Guardian role inherited from the
original build, kept for schools that want it — it isn't one of the three
account types issued from Accounts & Logins.)

## Marketing Homepage

Opening the site now shows a public homepage first — hero, a "who it's
for" breakdown of the three account types, a sample comparison section, a
sample reviews section, and a **Contact us / Request a call** form — with
a **Login** button in the header that takes visitors to the real sign-in
screen. Everything below is a swap-in-your-own-content template:

- `sampleReviews` and `compareRows` in `src/app.js` — replace with real
  testimonials and your actual competitive comparison whenever you have
  them.
- The contact form inserts into a Supabase table (`contact_requests`, see
  migration `0004`) so submissions show up for Managers in the
  **Contact Requests** panel inside the app. Without Supabase configured,
  it just shows a local "thanks" message.

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

- Visiting the site shows the marketing homepage first; click **Login** to
  reach the sign-in screen (or, without Supabase configured, straight into
  the demo/preview dashboard).
- Once Supabase Auth is wired up (migrations 0002-0004), the app shows a
  real sign-in screen instead of the demo role switcher.
- A Manager issues an Instructor's or Student's first username and
  password from **Accounts & Logins**. An Instructor can do the same, but
  only for Students in their own classes. The temporary password is shown
  once — share it with that person right away.
- Everyone is required to set their own password the first time they sign
  in with a temporary one.
- Without Supabase configured, the app runs in demo/preview mode with the
  original role switcher, unchanged.

## Security

See `docs/security-test-report.md` and `docs/deploy-vercel-supabase.md` before using real student data.
