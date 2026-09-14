-- Two new features on top of 0001-0009:
--   1. Grades: a real per-student, per-assignment score, entered by the
--      class's Instructor (or a Manager), visible to that student, their
--      parent, their Instructor, and Managers. Nothing here changes the
--      existing `students.avg_grade` summary field — that stays as-is.
--   2. Class chat: one shared group conversation per class. Anyone with
--      a real reason to see that class already has one — its Instructor,
--      every Student in it, and their Parents — plus any Manager. Scoped
--      with the same `security definer` helper-function pattern 0002 and
--      0008 already use, so nothing here can hit the recursion bug 0008
--      fixed. A Manager can delete a message (moderation); nobody can
--      edit one once sent.
--
-- Run this after 0001-0009.

create or replace function public.can_access_class_chat(target_class_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.instructor_owns_class(target_class_id)
    or exists (
      select 1 from public.user_profiles profile
      join public.students s on s.student_id = profile.student_id
      where profile.user_id = auth.uid()
        and profile.role = 'Student'
        and s.class_id = target_class_id
    )
    or exists (
      select 1 from public.parent_student_links link
      join public.students s on s.student_id = link.student_id
      where link.parent_user_id = auth.uid()
        and s.class_id = target_class_id
    )
$$;

grant execute on function public.can_access_class_chat(text) to anon, authenticated, service_role;

-- ===================== Grades =====================

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id text not null references public.students(student_id) on delete cascade,
  score numeric not null,
  max_score numeric not null default 100,
  feedback text,
  graded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grades_max_score_check check (max_score > 0),
  constraint grades_score_check check (score >= 0 and score <= max_score),
  constraint grades_unique_per_student unique (assignment_id, student_id)
);

alter table public.grades enable row level security;
create index if not exists idx_grades_student on public.grades(student_id);
create index if not exists idx_grades_assignment on public.grades(assignment_id);

drop policy if exists "grades scoped read" on public.grades;
create policy "grades scoped read" on public.grades
for select using (
  exists (
    select 1 from public.students s
    where s.student_id = grades.student_id
      and public.can_view_student(s.student_id, s.class_id)
  )
);

-- Deliberately joins `students` on both the assignment's class AND
-- `grades.student_id` — checking only "does this instructor own the
-- assignment's class" is not enough on its own: an instructor could then
-- grade a student who ISN'T in that class at all, just by pointing an
-- insert at one of their own assignment_ids with someone else's
-- student_id. Requiring the target student to actually belong to the
-- assignment's class closes that gap.
drop policy if exists "grades write instructor admin" on public.grades;
create policy "grades write instructor admin" on public.grades
for all using (
  public.is_admin()
  or exists (
    select 1 from public.assignments a
    join public.classes c on c.name = a.class_name
    join public.students s on s.student_id = grades.student_id and s.class_id = c.class_id
    where a.id = grades.assignment_id
      and public.instructor_owns_class(c.class_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.assignments a
    join public.classes c on c.name = a.class_name
    join public.students s on s.student_id = grades.student_id and s.class_id = c.class_id
    where a.id = grades.assignment_id
      and public.instructor_owns_class(c.class_id)
  )
);

-- ===================== Class chat =====================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  class_id text not null references public.classes(class_id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null,
  sender_role text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_check check (length(trim(body)) > 0 and length(body) < 4000)
);

alter table public.messages enable row level security;
create index if not exists idx_messages_class_created on public.messages(class_id, created_at);

drop policy if exists "messages scoped read" on public.messages;
create policy "messages scoped read" on public.messages
for select using (public.can_access_class_chat(messages.class_id));

-- The WITH CHECK ties `sender_name`/`sender_role` to the caller's own
-- profile row (the same pattern 0009's "staff requests insert own" policy
-- uses for `instructor_name`) so nobody can post a message that displays
-- as coming from someone else.
drop policy if exists "messages scoped insert" on public.messages;
create policy "messages scoped insert" on public.messages
for insert with check (
  sender_user_id = auth.uid()
  and public.can_access_class_chat(messages.class_id)
  and exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.full_name = messages.sender_name
      and profile.role = messages.sender_role
  )
);

drop policy if exists "messages admin delete" on public.messages;
create policy "messages admin delete" on public.messages
for delete using (public.is_admin());
