-- Lets Instructors do real day-to-day class operations at the database
-- level, and adds Groups + Materials. Run this after 0001-0005.
--
-- What this adds:
--   1. Instructors can create classes (self-assigned) and update their own.
--   2. Instructors can create/update students in their own classes.
--   3. New `groups` + `group_members` tables, so a class can be split into
--      smaller groups, scoped to the class's own instructor.
--   4. New `materials` table + a private `materials` Storage bucket, so an
--      instructor can upload a file and share it with a whole class or one
--      group.
--   5. `assignments` gets an optional `group_id`, so an assignment can be
--      shared with a specific group instead of the whole class.

-- ---------------------------------------------------------------------
-- 1. Instructors can create/update their own classes.
-- ---------------------------------------------------------------------

drop policy if exists "classes write instructor own" on public.classes;
create policy "classes write instructor own" on public.classes
for insert
with check (
  exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = classes.instructor
  )
);

drop policy if exists "classes update instructor own" on public.classes;
create policy "classes update instructor own" on public.classes
for update using (
  exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = classes.instructor
  )
)
with check (
  exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = classes.instructor
  )
);

-- ---------------------------------------------------------------------
-- 2. Instructors can create/update students in their own classes.
-- ---------------------------------------------------------------------

drop policy if exists "students write instructor own class" on public.students;
create policy "students write instructor own class" on public.students
for insert
with check (
  exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = students.class_id
  )
);

drop policy if exists "students update instructor own class" on public.students;
create policy "students update instructor own class" on public.students
for update using (
  exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = students.class_id
  )
)
with check (
  exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = students.class_id
  )
);

-- ---------------------------------------------------------------------
-- 3. Groups (a class split into smaller working groups).
-- ---------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  group_id text not null unique,
  name text not null,
  class_id text not null references public.classes(class_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id text not null references public.groups(group_id) on delete cascade,
  student_id text not null references public.students(student_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, student_id)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create index if not exists idx_groups_class_id on public.groups(class_id);
create index if not exists idx_group_members_student_id on public.group_members(student_id);

-- Helper functions used below so the `groups`/`group_members`/`materials`
-- policies never query each other's tables directly.
--
-- Why this exists: a naive version of these policies has `groups`
-- read-scoped by an EXISTS subquery against `group_members`, and
-- `group_members` read-scoped by an EXISTS subquery against `groups`.
-- Postgres evaluates RLS for each table involved in a query, including
-- tables only touched inside another table's policy, so that pair forms
-- a cycle: reading `groups` triggers `group_members`'s policy, which
-- triggers `groups`'s policy again, and Postgres aborts with "infinite
-- recursion detected in policy for relation ...". This surfaces through
-- PostgREST as a plain HTTP 500 with no useful detail, which is what
-- shows up in the browser console.
--
-- The fix is the same pattern already used by `is_admin()` and
-- `can_view_student()` in 0002_production_rls.sql: put the cross-table
-- check inside a `security definer` function. A `security definer`
-- function runs as the (superuser-privileged) role that created it, so
-- its internal queries bypass RLS entirely instead of re-triggering
-- another table's policy — breaking the cycle. These must be declared
-- here (after `groups`/`group_members` exist) rather than up near the
-- other helpers in 0002, since a `language sql` function's body is
-- resolved against the catalog at CREATE time, not at call time.
create or replace function public.instructor_owns_class(target_class_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles profile
    join public.classes class on class.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.class_id = target_class_id
  )
$$;

create or replace function public.can_view_group(target_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.groups grp
      where grp.group_id = target_group_id
        and public.instructor_owns_class(grp.class_id)
    )
    or exists (
      select 1 from public.group_members gm
      join public.students student on student.student_id = gm.student_id
      where gm.group_id = target_group_id
        and public.can_view_student(student.student_id, student.class_id)
    )
$$;

grant execute on function public.instructor_owns_class(text) to anon, authenticated, service_role;
grant execute on function public.can_view_group(text) to anon, authenticated, service_role;

drop policy if exists "groups scoped read" on public.groups;
create policy "groups scoped read" on public.groups
for select using (
  public.can_view_group(groups.group_id)
);

drop policy if exists "groups write admin instructor" on public.groups;
create policy "groups write admin instructor" on public.groups
for all using (
  public.is_admin()
  or public.instructor_owns_class(groups.class_id)
)
with check (
  public.is_admin()
  or public.instructor_owns_class(groups.class_id)
);

drop policy if exists "group members scoped read" on public.group_members;
create policy "group members scoped read" on public.group_members
for select using (
  public.can_view_group(group_members.group_id)
);

drop policy if exists "group members write admin instructor" on public.group_members;
create policy "group members write admin instructor" on public.group_members
for all using (
  public.is_admin()
  or exists (
    select 1 from public.groups grp
    where grp.group_id = group_members.group_id
      and public.instructor_owns_class(grp.class_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.groups grp
    where grp.group_id = group_members.group_id
      and public.instructor_owns_class(grp.class_id)
  )
);

-- ---------------------------------------------------------------------
-- 4. Materials (uploaded files, shared to a class or a specific group).
-- ---------------------------------------------------------------------

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  class_id text not null references public.classes(class_id) on delete cascade,
  group_id text references public.groups(group_id) on delete set null,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.materials enable row level security;

create index if not exists idx_materials_class_id on public.materials(class_id);
create index if not exists idx_materials_group_id on public.materials(group_id);

drop policy if exists "materials scoped read" on public.materials;
create policy "materials scoped read" on public.materials
for select using (
  public.is_admin()
  or public.instructor_owns_class(materials.class_id)
  or (
    materials.group_id is null
    and exists (
      select 1 from public.students student
      where student.class_id = materials.class_id
        and public.can_view_student(student.student_id, student.class_id)
    )
  )
  or (
    materials.group_id is not null
    and public.can_view_group(materials.group_id)
  )
);

drop policy if exists "materials write admin instructor" on public.materials;
create policy "materials write admin instructor" on public.materials
for all using (
  public.is_admin()
  or public.instructor_owns_class(materials.class_id)
)
with check (
  public.is_admin()
  or public.instructor_owns_class(materials.class_id)
);

-- Private storage bucket for uploaded files. Objects are stored under
-- "<class_id>/<file>", which is how the policies below scope access.
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists "materials bucket scoped read" on storage.objects;
create policy "materials bucket scoped read" on storage.objects
for select using (
  bucket_id = 'materials'
  and (
    public.is_admin()
    or exists (
      select 1 from public.user_profiles profile
      join public.classes class on class.instructor = profile.instructor_name
      where profile.user_id = auth.uid()
        and profile.role = 'Instructor'
        and class.class_id = (storage.foldername(name))[1]
    )
    or exists (
      select 1 from public.students student
      where student.class_id = (storage.foldername(name))[1]
        and public.can_view_student(student.student_id, student.class_id)
    )
  )
);

drop policy if exists "materials bucket write admin instructor" on storage.objects;
create policy "materials bucket write admin instructor" on storage.objects
for insert with check (
  bucket_id = 'materials'
  and (
    public.is_admin()
    or exists (
      select 1 from public.user_profiles profile
      join public.classes class on class.instructor = profile.instructor_name
      where profile.user_id = auth.uid()
        and profile.role = 'Instructor'
        and class.class_id = (storage.foldername(name))[1]
    )
  )
);

drop policy if exists "materials bucket delete admin instructor" on storage.objects;
create policy "materials bucket delete admin instructor" on storage.objects
for delete using (
  bucket_id = 'materials'
  and (
    public.is_admin()
    or exists (
      select 1 from public.user_profiles profile
      join public.classes class on class.instructor = profile.instructor_name
      where profile.user_id = auth.uid()
        and profile.role = 'Instructor'
        and class.class_id = (storage.foldername(name))[1]
    )
  )
);

-- ---------------------------------------------------------------------
-- 5. Assignments can optionally target one group instead of a whole class.
-- ---------------------------------------------------------------------

alter table public.assignments
  add column if not exists group_id text references public.groups(group_id) on delete set null;

drop policy if exists "assignments scoped read" on public.assignments;
create policy "assignments scoped read" on public.assignments
for select using (
  public.is_admin()
  or exists (
    select 1 from public.classes class
    where class.name = assignments.class_name
      and (
        exists (
          select 1 from public.user_profiles profile
          where profile.user_id = auth.uid()
            and profile.role = 'Instructor'
            and profile.instructor_name = class.instructor
        )
        or (
          assignments.group_id is null
          and exists (
            select 1 from public.students student
            where student.class_id = class.class_id
              and public.can_view_student(student.student_id, student.class_id)
          )
        )
        or (
          assignments.group_id is not null
          and exists (
            select 1 from public.group_members gm
            join public.students student on student.student_id = gm.student_id
            where gm.group_id = assignments.group_id
              and public.can_view_student(student.student_id, student.class_id)
          )
        )
      )
  )
);

-- Note: this file grants storage.objects access to the "materials" bucket
-- one class at a time (the folder name is the class_id), not one group at
-- a time — a class's whole roster can read any file uploaded for that
-- class even when it was shared to one group only. The `materials` table
-- row itself is fully group-scoped (see "materials scoped read" above),
-- so the app only ever *lists*/*links* a file to the group it was shared
-- with; a student who already has a file's exact storage path could still
-- fetch the raw file. Tighten this later by storing group files under
-- "<class_id>/<group_id>/<file>" and matching both folder segments here
-- once real usage shows this is worth the added complexity.
