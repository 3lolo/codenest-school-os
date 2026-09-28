-- A student could always insert/update/delete their own submissions row
-- (0014's "submissions student or staff write" policy) with no regard for
-- the assignment's due_date at all -- the deadline was purely cosmetic, a
-- client-side status label ("exceeded") that never actually stopped a
-- late submit or resubmit. This closes that gap in RLS itself (so it
-- can't be bypassed by calling the API directly, matching how every other
-- authorization rule in this project works), while giving an instructor
-- (or Manager) a way to lift the deadline for one specific student via a
-- new assignment_reopens table.
--
-- Run this after 0001-0016.

create table if not exists public.assignment_reopens (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id text not null references public.students(student_id) on delete cascade,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);

alter table public.assignment_reopens enable row level security;
create index if not exists idx_assignment_reopens_student on public.assignment_reopens(student_id);

-- Read: the same people who could already see this student's submission
-- for this assignment -- the student themselves, that group's own
-- instructor, or any Manager.
drop policy if exists "assignment reopens scoped read" on public.assignment_reopens;
create policy "assignment reopens scoped read" on public.assignment_reopens
for select using (
  exists (
    select 1 from public.assignments a
    where a.id = assignment_reopens.assignment_id
      and public.can_view_student(assignment_reopens.student_id, a.group_id)
  )
);

-- Write (reopen, or close it again): only a Manager, or the assignment's
-- own group instructor -- never the student themselves, and never an
-- instructor for a group they don't own.
drop policy if exists "assignment reopens staff write" on public.assignment_reopens;
create policy "assignment reopens staff write" on public.assignment_reopens
for all using (
  exists (
    select 1 from public.assignments a
    where a.id = assignment_reopens.assignment_id
      and (public.is_admin() or public.instructor_owns_group(a.group_id))
  )
)
with check (
  exists (
    select 1 from public.assignments a
    where a.id = assignment_reopens.assignment_id
      and (public.is_admin() or public.instructor_owns_group(a.group_id))
  )
);

-- Re-create 0014's submissions write policy, adding the deadline gate to
-- the student-write branch only: a student can insert/update/delete their
-- OWN submission while the assignment has no due_date, while due_date
-- hasn't passed yet, or while an assignment_reopens row exists for them.
-- Staff (Manager / the group's own instructor) are unchanged -- they could
-- already write here at any time (e.g. recording a paper handed in in
-- person after the deadline), and that's still true.
drop policy if exists "submissions student or staff write" on public.submissions;
create policy "submissions student or staff write" on public.submissions
for all using (
  exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and (
        public.is_admin()
        or public.instructor_owns_group(a.group_id)
        or (
          exists (
            select 1 from public.user_profiles profile
            where profile.user_id = auth.uid()
              and profile.role = 'Student'
              and profile.student_id = submissions.student_id
          )
          and (
            a.due_date is null
            or current_date <= a.due_date
            or exists (
              select 1 from public.assignment_reopens r
              where r.assignment_id = a.id and r.student_id = submissions.student_id
            )
          )
        )
      )
  )
)
with check (
  exists (
    select 1 from public.assignments a
    join public.students s on s.student_id = submissions.student_id and s.group_id = a.group_id
    where a.id = submissions.assignment_id
      and (
        public.is_admin()
        or public.instructor_owns_group(a.group_id)
        or (
          exists (
            select 1 from public.user_profiles profile
            where profile.user_id = auth.uid()
              and profile.role = 'Student'
              and profile.student_id = submissions.student_id
          )
          and (
            a.due_date is null
            or current_date <= a.due_date
            or exists (
              select 1 from public.assignment_reopens r
              where r.assignment_id = a.id and r.student_id = submissions.student_id
            )
          )
        )
      )
  )
);
