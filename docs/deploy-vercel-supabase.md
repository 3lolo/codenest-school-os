# Publish on Vercel with Supabase

## 1. Create Supabase Project

1. Open Supabase and create a new project.
2. Go to SQL Editor.
3. For a demo with sample public data, run `supabase/migrations/0001_dashboard_foundation.sql`, then `supabase/seed.sql`.
4. For real school data with real per-person logins, also run, in order:
   - `supabase/migrations/0002_production_rls.sql`
   - `supabase/migrations/0003_auth_accounts.sql`
5. Go to Project Settings -> API.
6. Copy:
   - Project URL
   - anon public key
   - `service_role` secret key (Project Settings -> API -> Project API keys). Keep this one secret — it is only ever used server-side.

## 2. Push App to GitHub

Create a GitHub repository and upload the contents of this folder:

`outputs/coding-school-platform`

The repository root should contain `package.json`, `vercel.json`, `index.html`, `src/`, `api/`, `docs/`, and `supabase/`.

## 3. Deploy to Vercel

1. Open Vercel.
2. Add New Project.
3. Import the GitHub repository.
4. Framework Preset: Other.
5. Build Command: `npm run build`.
6. Output Directory: `dist`.

Everything under `/api` (the account-creation function) deploys
automatically as a Vercel Serverless Function alongside the static site —
no extra Vercel configuration is required.

## 4. Add Environment Variables in Vercel

Add these variables before deploying:

- `SUPABASE_URL`: your Supabase Project URL.
- `SUPABASE_ANON_KEY`: your Supabase anon public key.
- `SUPABASE_SERVICE_ROLE_KEY`: your Supabase `service_role` secret key. This
  is read only by `/api/create-account.js` on the server. It is never sent
  to the browser and must never be added to `src/config.js` or any
  `NEXT_PUBLIC_`/client-exposed variable.

Then click Deploy.

## 5. Confirm It Is Connected

Open the deployed site. You should land on a sign-in screen (not the old
role-switcher preview) once migrations 0002 and 0003 have been run and the
environment variables above are set.

If Supabase is not configured, or migrations 0002/0003 haven't been run
yet, the app falls back to demo mode using built-in sample data and the
role switcher, exactly as before.

## 6. Bootstrap the First Admin

Account creation in the app (Accounts & Logins) requires being signed in
as a Super Admin or School Admin — so the very first admin has to be
created by hand, once, directly in Supabase:

1. In the Supabase Dashboard, go to Authentication -> Users -> Add user.
   Enter your own email and a password, and check "Auto Confirm User".
2. Copy that new user's UUID from the Users list.
3. In the SQL Editor, run (replace the placeholders):

   ```sql
   insert into public.user_profiles (user_id, role, full_name, email, must_change_password)
   values ('<paste-the-user-uuid>', 'Super Admin', 'Your Name', 'you@example.com', false);
   ```

4. Open the deployed site and sign in with that email and password. You now
   have full access, including **Accounts & Logins**.

From there, use Accounts & Logins to issue a username (email) and a
one-time temporary password for every instructor and student — no more
manual SQL is needed for anyone else. Each person is asked to set their
own password the first time they sign in.

## 7. Run Tests Before Publishing

Run:

`npm test`

The tests check:

- Students cannot access admin settings, reports, families, or audit logs.
- Parents cannot access another student's record.
- Instructors only see students in their assigned classes.
- Only Super Admin and School Admin can reach the Accounts & Logins module.
- Global search does not leak staff, family, or unrelated student records.
- Production RLS avoids public read-all policies.
- Generated temporary passwords meet length/complexity requirements and are never repeated.

## How Separation Works

There are three layers now:

- Frontend role UX: the app hides unauthorized modules and filters visible rows by role.
- Supabase row-level security: the database rejects unauthorized reads and writes even if someone bypasses the frontend.
- Account issuance: only an authenticated Super Admin or School Admin can call `/api/create-account.js`, which itself re-checks the caller's role server-side (with the service role key) before creating or resetting anyone's login — the browser is never trusted to self-report who it is.

In production:

- A student profile is linked to exactly their own `student_id` via `user_profiles`.
- An instructor is linked via `user_profiles.instructor_name` matching `classes.instructor`.
- A parent uses `parent_student_links` and can only read linked children.
- School admins can manage school operations.
- Only super admins can read audit logs and change platform settings.

## Production Security Note

The first migration includes public read policies only so the sample dashboard can deploy immediately. Do not put real student or parent private data behind those public demo policies. For real data, run the production RLS and accounts migrations, require Supabase Auth, and test with separate accounts for student, parent, instructor, school admin, and super admin.
