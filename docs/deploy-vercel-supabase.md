# Publish on Vercel with Supabase

This is the complete, from-zero guide: push the code to GitHub, create the
Supabase project and run its migrations, deploy to Vercel, and bootstrap
your first Manager login.

## 0. What You're Deploying

- A public marketing homepage (hero, account-type breakdown, a sample
  comparison section, sample reviews, and a Contact us / Request a call
  form) with a **Login** button.
- Three account types issued from inside the app: **Manager** (full school
  operations), **Instructor** (their own classes, and can create/reset
  **Student** logins for their own students only), and **Student**.
- A serverless function (`/api/create-account.js`) that issues real
  Supabase Auth logins, and a Postgres schema with row-level security.

## 1. Push the Code to GitHub

From inside this project folder:

```bash
git init                      # if it isn't already a repo
git add .
git commit -m "Initial commit: CodeNest School OS"
```

Then create an empty repository on GitHub (no README/license, so it stays
empty) and push:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If you'd rather not use the command line, GitHub Desktop, or the GitHub
web UI's "upload files" flow both work the same way — the repository root
just needs to contain `package.json`, `vercel.json`, `index.html`, `src/`,
`api/`, `docs/`, and `supabase/`.

## 2. Create the Supabase Project

1. Open Supabase and create a new project.
2. Go to SQL Editor.
3. For a quick look with sample public data only, run
   `supabase/migrations/0001_dashboard_foundation.sql`, then
   `supabase/seed.sql`, and stop here for now.
4. For a real school with real per-person logins (recommended before you
   invite anyone), also run, **in this exact order**:
   - `supabase/migrations/0002_production_rls.sql`
   - `supabase/migrations/0003_auth_accounts.sql`
   - `supabase/migrations/0004_contact_requests.sql`
5. Go to Project Settings -> API.
6. Copy:
   - Project URL
   - anon public key
   - `service_role` secret key (Project Settings -> API -> Project API
     keys). Keep this one secret — it is only ever used server-side.

## 3. Deploy to Vercel

1. Open Vercel.
2. Add New Project.
3. Import the GitHub repository you pushed in step 1.
4. Framework Preset: **Other**.
5. Build Command: `npm run build`.
6. Output Directory: `dist`.

Everything under `/api` (the account-creation function) deploys
automatically as a Vercel Serverless Function alongside the static site —
no extra Vercel configuration is required.

## 4. Add Environment Variables in Vercel

Add these variables before deploying (Project Settings -> Environment
Variables):

- `SUPABASE_URL`: your Supabase Project URL.
- `SUPABASE_ANON_KEY`: your Supabase anon public key.
- `SUPABASE_SERVICE_ROLE_KEY`: your Supabase `service_role` secret key.
  This is read only by `/api/create-account.js` on the server. It is never
  sent to the browser and must never be added to `src/config.js` or any
  `NEXT_PUBLIC_`/client-exposed variable.

Then click Deploy.

## 5. Confirm It Is Connected

Open the deployed site. You should land on the marketing homepage; click
**Login**. You should reach a real sign-in screen (not the demo role
switcher) once migrations 0002-0004 have been run and the environment
variables above are set.

If Supabase is not configured, or migrations 0002-0004 haven't been run
yet, clicking **Login** drops straight into demo/preview mode using
built-in sample data and the role switcher, exactly as before.

## 6. Bootstrap the First Manager

Account creation in the app (Accounts & Logins) requires being signed in
as a Manager (Super Admin or School Admin) — so the very first Manager has
to be created by hand, once, directly in Supabase:

1. In the Supabase Dashboard, go to Authentication -> Users -> Add user.
   Enter your own email and a password, and check "Auto Confirm User".
2. Copy that new user's UUID from the Users list.
3. In the SQL Editor, run (replace the placeholders):

   ```sql
   insert into public.user_profiles (user_id, role, full_name, email, must_change_password)
   values ('<paste-the-user-uuid>', 'Super Admin', 'Your Name', 'you@example.com', false);
   ```

4. Open the deployed site, click **Login**, and sign in with that email
   and password. You now have full Manager access, including
   **Accounts & Logins** and **Contact Requests**.

From there:

- Use **Accounts & Logins** to issue a username (email) and a one-time
  temporary password for every Instructor and Student — no more manual
  SQL is needed for anyone else. Each person is asked to set their own
  password the first time they sign in.
- Once an Instructor account exists and signs in, that Instructor sees
  their own **Accounts & Logins** panel, scoped to only the students in
  their own classes, and can issue/reset those students' logins directly.
- Submissions from the homepage's Contact us / Request a call form appear
  under **Contact Requests**.

## 7. Run Tests Before Publishing

Run:

```bash
npm test
```

The tests check:

- Students cannot access admin settings, reports, families, or audit logs.
- Parents cannot access another student's record.
- Instructors only see students in their assigned classes.
- Managers (Super Admin and School Admin) and Instructors can reach
  Accounts & Logins; Students and Parents cannot.
- Only Managers can reach Contact Requests.
- Global search does not leak staff, family, or unrelated student records.
- Production RLS avoids public read-all policies, and the Contact
  Requests table only allows public **insert**, never public read/update.
- `api/create-account.js` re-verifies the caller's role server-side and
  rejects an Instructor issuing anything but a Student login outside their
  own classes.
- Generated temporary passwords meet length/complexity requirements and
  are never repeated.

## How Separation Works

There are three layers:

- Frontend role UX: the app hides unauthorized modules and filters
  visible rows by role (an Instructor's Accounts & Logins list only shows
  their own students, for example).
- Supabase row-level security: the database rejects unauthorized reads
  and writes even if someone bypasses the frontend.
- Account issuance: only an authenticated Manager or Instructor can call
  `/api/create-account.js`, which itself re-checks the caller's role
  server-side (with the service role key) before creating or resetting
  anyone's login — the browser is never trusted to self-report who it is.
  When the caller is an Instructor, the function also re-verifies the
  target student is in one of that instructor's own classes before doing
  anything.

In production:

- A student profile is linked to exactly their own `student_id` via `user_profiles`.
- An instructor is linked via `user_profiles.instructor_name` matching `classes.instructor`.
- A parent uses `parent_student_links` and can only read linked children.
- Managers can manage school operations.
- Only Super Admin can read audit logs and change platform settings.
- Anyone (even signed out) can insert into `contact_requests` from the
  homepage form; only Managers can read or update those rows.

## Production Security Note

The first migration includes public read policies only so the sample
dashboard can deploy immediately. Do not put real student or parent
private data behind those public demo policies. For real data, run the
production RLS, accounts, and contact-requests migrations, require
Supabase Auth, and test with separate accounts for Student, Parent,
Instructor, and Manager.
