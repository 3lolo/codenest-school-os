# CodeNest School OS

Coding school management platform foundation for Vercel and Supabase, with
real per-person login: every instructor and student signs in with their own
username (email) and password, issued by a school admin from the app.

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

For real school data with real logins, also run:

3. `supabase/migrations/0002_production_rls.sql`
4. `supabase/migrations/0003_auth_accounts.sql`

Then follow "Bootstrap the first admin" in `docs/deploy-vercel-supabase.md`
so someone can sign in and start issuing instructor/student credentials.

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

- Once Supabase Auth is wired up (migrations 0002 and 0003), the app shows
  a real sign-in screen instead of the demo role switcher.
- A Super Admin or School Admin issues an instructor's or student's first
  username and password from the **Accounts & Logins** panel. The
  temporary password is shown once — share it with that person right away.
- Everyone is required to set their own password the first time they sign
  in with a temporary one.
- Without Supabase configured, the app runs in demo/preview mode with the
  original role switcher, unchanged.

## Security

See `docs/security-test-report.md` and `docs/deploy-vercel-supabase.md` before using real student data.
