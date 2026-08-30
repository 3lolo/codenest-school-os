-- Adds what's needed to issue a real username (email) + password login
-- for every instructor and student, on top of the production RLS
-- migration (0002_production_rls.sql). Run this after 0002.

alter table public.user_profiles
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists must_change_password boolean not null default true;

create unique index if not exists idx_user_profiles_email_unique
  on public.user_profiles (lower(email))
  where email is not null;

create index if not exists idx_user_profiles_student_id
  on public.user_profiles (student_id)
  where student_id is not null;

create index if not exists idx_user_profiles_instructor_name
  on public.user_profiles (instructor_name)
  where instructor_name is not null;

-- Admins (Super Admin and School Admin) need to see every account so the
-- Accounts & Logins panel can list who already has portal access.
-- Previously only Super Admin could read all profiles.
drop policy if exists "profiles read own or admin" on public.user_profiles;
create policy "profiles read own or admin" on public.user_profiles
for select using (user_id = auth.uid() or public.is_admin());

-- A signed-in user is allowed to clear their own "must change password"
-- flag after they pick a new password on first login, but must never be
-- able to edit their own role/student_id/instructor_name (that would be a
-- privilege escalation). A locked-down function is safer than a generic
-- UPDATE policy on user_profiles.
create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_profiles
  set must_change_password = false
  where user_id = auth.uid();
$$;

grant execute on function public.mark_password_changed() to authenticated;
