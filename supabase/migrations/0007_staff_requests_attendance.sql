-- Adds two things Instructors asked for on top of 0001-0006:
--   1. Staff Requests: an Instructor can send a message to Managers, or
--      request time off, from inside the portal — Managers see and
--      decide on every request from a new "Requests" panel.
--   2. Attendance Records: a real "Take attendance" flow (pick a class
--      and a date, mark each student present/absent/late/excused) backed
--      by its own table, instead of only the old manually-entered
--      per-student counters on `students`.

-- ---------------------------------------------------------------------
-- 1. Staff Requests
-- ---------------------------------------------------------------------

create table if not exists public.staff_requests (
  id uuid primary key default gen_random_uuid(),
  instructor_name text not null,
  kind text not null check (kind in ('message', 'holiday')),
  subject text not null,
  message text,
  start_date date,
  end_date date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'read')),
  created_at timestamptz not null default now()
);

alter table public.staff_requests enable row level security;

create index if not exists idx_staff_requests_instructor on public.staff_requests(instructor_name);

drop policy if exists "staff requests read own or admin" on public.staff_requests;
create policy "staff requests read own or admin" on public.staff_requests
for select using (
  public.is_admin()
  or exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = staff_requests.instructor_name
  )
);

drop policy if exists "staff requests insert own" on public.staff_requests;
create policy "staff requests insert own" on public.staff_requests
for insert with check (
  exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = staff_requests.instructor_name
  )
);

-- Only a Manager can change a request's status (approve/deny/mark read) —
-- an Instructor can create and read their own requests but never edit
-- them after the fact, so the "sent" record stays trustworthy.
drop policy if exists "staff requests update admin" on public.staff_requests;
create policy "staff requests update admin" on public.staff_requests
for update using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. Attendance Records
-- ---------------------------------------------------------------------

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(student_id) on delete cascade,
  class_id text not null references public.classes(class_id) on delete cascade,
  session_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  marked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, class_id, session_date)
);

alter table public.attendance_records enable row level security;

create index if not exists idx_attendance_class_date on public.attendance_records(class_id, session_date);
create index if not exists idx_attendance_student on public.attendance_records(student_id);

drop policy if exists "attendance scoped read" on public.attendance_records;
create policy "attendance scoped read" on public.attendance_records
for select using (
  public.is_admin()
  or exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = attendance_records.class_id
  )
  or public.can_view_student(attendance_records.student_id, attendance_records.class_id)
);

drop policy if exists "attendance write admin instructor" on public.attendance_records;
create policy "attendance write admin instructor" on public.attendance_records
for all using (
  public.is_admin()
  or exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = attendance_records.class_id
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = attendance_records.class_id
  )
);

-- Upserting a day's attendance (Prefer: resolution=merge-duplicates from
-- the app) relies on this unique constraint plus the policy above; a
-- re-submitted day for the same class overwrites that day's rows instead
-- of duplicating them.
