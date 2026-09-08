-- Two things the Manager asked for on top of 0001-0008:
--   1. Opportunities ("Work With Us"): a Manager can post and remove job
--      openings. Anyone (even signed-out visitors) can read the ones marked
--      "open" — that's what powers the homepage's Work With Us section.
--      Only a Manager can create, edit, or delete a row.
--   2. Student removal requests: a Manager can remove any Instructor or
--      Student outright (already possible under 0002's "students write
--      admin" / "instructors admin write" policies — this migration adds
--      nothing new for that). An Instructor cannot delete a student
--      directly; they can only *request* one be removed, scoped to a
--      student in one of their own classes, and a Manager decides from the
--      existing Requests panel. This extends `staff_requests` (0007) with
--      a third `kind` and two columns identifying the target student.
--
-- Run this after 0001-0008.

-- ---------------------------------------------------------------------
-- 1. Opportunities
-- ---------------------------------------------------------------------

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  employment_type text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.opportunities enable row level security;

create index if not exists idx_opportunities_status on public.opportunities(status);

drop policy if exists "opportunities public read open" on public.opportunities;
create policy "opportunities public read open" on public.opportunities
for select using (status = 'open');

drop policy if exists "opportunities admin read all" on public.opportunities;
create policy "opportunities admin read all" on public.opportunities
for select using (public.is_admin());

drop policy if exists "opportunities admin write" on public.opportunities;
create policy "opportunities admin write" on public.opportunities
for all using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. Student removal requests (extends staff_requests from 0007)
-- ---------------------------------------------------------------------

-- `target_student_id` is what the app actually uses to perform the removal
-- once a Manager approves it. `target_student_name` is a plain snapshot
-- taken at request time purely so the request stays readable in the
-- Requests panel after the student record is gone — like `instructor_name`
-- elsewhere in this table, neither column is a real foreign key, since a
-- request is a historical record that should survive the row it pointed to
-- being deleted, not disappear or block the deletion.
alter table public.staff_requests add column if not exists target_student_id text;
alter table public.staff_requests add column if not exists target_student_name text;

alter table public.staff_requests drop constraint if exists staff_requests_kind_check;
alter table public.staff_requests add constraint staff_requests_kind_check
  check (kind in ('message', 'holiday', 'removal'));

-- Re-create the insert policy so a removal request additionally has to name
-- a real student in one of the requesting instructor's own classes — an
-- Instructor can ask that *their own* roster be trimmed, never anyone
-- else's.
drop policy if exists "staff requests insert own" on public.staff_requests;
create policy "staff requests insert own" on public.staff_requests
for insert with check (
  exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = staff_requests.instructor_name
  )
  and (
    staff_requests.kind <> 'removal'
    or exists (
      select 1 from public.students student
      join public.classes class on class.class_id = student.class_id
      where student.student_id = staff_requests.target_student_id
        and class.instructor = staff_requests.instructor_name
    )
  )
);
