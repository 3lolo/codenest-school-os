-- Two things on top of 0001-0013:
--   1. An instructor (or Manager) can attach one file to an assignment when
--      creating it (an instruction sheet, a starter file, etc). Reuses the
--      existing private "materials" bucket/RLS from
--      0011_groups_replace_classes_drop_parent.sql — the file just lives
--      under that same group's folder, so anyone who could already read
--      that group's materials can read this too. No new bucket/policy
--      needed for the attachment itself, only two new nullable columns.
--   2. A real per-student "submissions" table, so the dashboard can show a
--      per-student status ("not yet" / "uploaded" / "deadline passed")
--      instead of only the assignment-level `submissions`/`total`
--      counters, and so a student can actually deliver a file for an
--      assignment. Grading itself still goes through the existing `grades`
--      table (0010/0011) — submissions only tracks the delivered file.
--
-- Run this after 0001-0013.

alter table public.assignments
  add column if not exists attachment_path text,
  add column if not exists attachment_name text;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id text not null references public.students(student_id) on delete cascade,
  file_path text not null,
  file_name text not null,
  submitted_at timestamptz not null default now(),
  constraint submissions_unique_per_student unique (assignment_id, student_id)
);

alter table public.submissions enable row level security;
create index if not exists idx_submissions_assignment on public.submissions(assignment_id);
create index if not exists idx_submissions_student on public.submissions(student_id);

-- Read: the same people who could already see this student's info for
-- this assignment's group — the student themselves, that group's own
-- instructor, or any Manager (reuses can_view_student(), same helper the
-- grades/materials/attendance policies already use).
drop policy if exists "submissions scoped read" on public.submissions;
create policy "submissions scoped read" on public.submissions
for select using (
  exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and public.can_view_student(submissions.student_id, a.group_id)
  )
);

-- Write: a student can only ever create/replace/delete their OWN
-- submission (their own profile.student_id must match the row), for an
-- assignment whose group they're actually a member of — the WITH CHECK's
-- join back through `students` closes the same "point at someone else's
-- student_id" gap 0010's grades policy comment calls out. An instructor
-- who owns the assignment's group, or any Manager, can also write here
-- (e.g. recording a paper handed in in person, or removing an
-- inappropriate upload) but still can't impersonate a different student's
-- submission as their own.
drop policy if exists "submissions student or staff write" on public.submissions;
create policy "submissions student or staff write" on public.submissions
for all using (
  exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and (
        public.is_admin()
        or public.instructor_owns_group(a.group_id)
        or exists (
          select 1 from public.user_profiles profile
          where profile.user_id = auth.uid()
            and profile.role = 'Student'
            and profile.student_id = submissions.student_id
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
        or exists (
          select 1 from public.user_profiles profile
          where profile.user_id = auth.uid()
            and profile.role = 'Student'
            and profile.student_id = submissions.student_id
        )
      )
  )
);

-- Private bucket for delivered submission files, kept separate from
-- "materials" on purpose: materials' own storage RLS grants read to
-- anyone who can see the group at all, which would let one student read
-- a classmate's submitted homework if submissions lived there too. Here,
-- objects are stored as "<assignment_id>/<student_id>/<file>", and the
-- policies below re-derive the assignment's group from the first path
-- segment so they can reuse the exact same can_view_student() check the
-- table policies above use — only that student, their instructor, or a
-- Manager can read or write a given object.
insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

drop policy if exists "submissions bucket scoped read" on storage.objects;
create policy "submissions bucket scoped read" on storage.objects
for select using (
  bucket_id = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id::text = (storage.foldername(name))[1]
      and public.can_view_student((storage.foldername(name))[2], a.group_id)
  )
);

drop policy if exists "submissions bucket scoped write" on storage.objects;
create policy "submissions bucket scoped write" on storage.objects
for insert with check (
  bucket_id = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id::text = (storage.foldername(name))[1]
      and public.can_view_student((storage.foldername(name))[2], a.group_id)
  )
);

drop policy if exists "submissions bucket scoped update" on storage.objects;
create policy "submissions bucket scoped update" on storage.objects
for update using (
  bucket_id = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id::text = (storage.foldername(name))[1]
      and public.can_view_student((storage.foldername(name))[2], a.group_id)
  )
)
with check (
  bucket_id = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id::text = (storage.foldername(name))[1]
      and public.can_view_student((storage.foldername(name))[2], a.group_id)
  )
);

drop policy if exists "submissions bucket scoped delete" on storage.objects;
create policy "submissions bucket scoped delete" on storage.objects
for delete using (
  bucket_id = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id::text = (storage.foldername(name))[1]
      and public.can_view_student((storage.foldername(name))[2], a.group_id)
  )
);
