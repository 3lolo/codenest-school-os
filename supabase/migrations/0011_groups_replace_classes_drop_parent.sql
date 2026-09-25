-- Big structural migration on top of 0001-0010:
--
--   1. `groups` becomes the ONE class-like container. It absorbs every
--      field `classes` used to own (course, instructor, schedule, room,
--      status, completion) and every table that used to point at
--      `classes(class_id)` now points at `groups(group_id)` instead. The
--      old sub-group layer (a class split into several `groups`, tracked
--      via `group_members`) goes away with it — a "group" now IS the
--      class-equivalent a Manager creates and puts students directly
--      into, matching how `classes` behaved before, just renamed.
--   2. Only a Manager (Super Admin / School Admin) can create or edit a
--      group from now on — an Instructor is assigned to a group (via
--      `groups.instructor`, same pattern `classes.instructor` used) but
--      can no longer create one themselves.
--   3. The `Parent` role is removed completely: the `parents` and
--      `parent_student_links` tables are dropped, `user_profiles.role`
--      no longer allows `'Parent'`, and every policy's parent branch is
--      gone. A Student only ever has their own account from here on.
--
-- Run this after 0001-0010. Written for a fresh sequential apply (the
-- project's own local/staging verification flow) — it does not attempt to
-- preserve historical class/group data beyond a straightforward 1:1
-- carry-over (each existing `classes` row becomes one `groups` row with
-- the same `class_id` reused as the new `group_id`, so every table that
-- already stored that value keeps pointing at the right row without
-- having to guess a new id). Existing *sub*-groups (the old `groups` /
-- `group_members` rows) are retired outright — there is no equivalent
-- concept anymore.

-- =======================================================================
-- SECTION A — drop every existing policy that will be rewritten below.
-- Must happen before the helper functions they call are dropped/replaced,
-- and before the columns/tables they reference are dropped.
-- =======================================================================

drop policy if exists "profiles read own or admin" on public.user_profiles;
drop policy if exists "parent links read own or admin" on public.parent_student_links;

drop policy if exists "students scoped read" on public.students;
drop policy if exists "students write admin" on public.students;
drop policy if exists "students write instructor own class" on public.students;
drop policy if exists "students update instructor own class" on public.students;

drop policy if exists "parents admin read" on public.parents;
drop policy if exists "parents admin write" on public.parents;

drop policy if exists "instructors admin read" on public.instructors;
drop policy if exists "instructors admin write" on public.instructors;

drop policy if exists "classes scoped read" on public.classes;
drop policy if exists "classes write admin" on public.classes;
drop policy if exists "classes write instructor own" on public.classes;
drop policy if exists "classes update instructor own" on public.classes;

drop policy if exists "groups scoped read" on public.groups;
drop policy if exists "groups write admin instructor" on public.groups;
drop policy if exists "group members scoped read" on public.group_members;
drop policy if exists "group members write admin instructor" on public.group_members;

drop policy if exists "materials scoped read" on public.materials;
drop policy if exists "materials write admin instructor" on public.materials;

drop policy if exists "assignments scoped read" on public.assignments;
drop policy if exists "assignments write admin instructor" on public.assignments;

drop policy if exists "attendance scoped read" on public.attendance_records;
drop policy if exists "attendance write admin instructor" on public.attendance_records;

drop policy if exists "staff requests insert own" on public.staff_requests;

drop policy if exists "grades scoped read" on public.grades;
drop policy if exists "grades write instructor admin" on public.grades;

drop policy if exists "messages scoped read" on public.messages;
drop policy if exists "messages scoped insert" on public.messages;
drop policy if exists "messages admin delete" on public.messages;

drop policy if exists "materials bucket scoped read" on storage.objects;
drop policy if exists "materials bucket write admin instructor" on storage.objects;
drop policy if exists "materials bucket delete admin instructor" on storage.objects;

-- =======================================================================
-- SECTION B — schema changes.
-- =======================================================================

-- B1. `groups` absorbs the old `classes` columns.
alter table public.groups
  add column if not exists course text,
  add column if not exists instructor text,
  add column if not exists schedule text,
  add column if not exists room text,
  add column if not exists status text not null default 'Active',
  add column if not exists completion integer not null default 0;

alter table public.groups drop constraint if exists groups_completion_check;
alter table public.groups add constraint groups_completion_check check (completion between 0 and 100);

-- Retire the old sub-group concept entirely — there is no equivalent once
-- `groups` becomes the top-level container, and keeping these rows around
-- would just leave orphaned/confusing data once `group_members` is
-- dropped below.
delete from public.group_members;
delete from public.groups;

-- Drop the old `class_id` column (and its NOT NULL/FK) before inserting
-- the backfilled rows below — those rows never had a `classes` row of
-- their own to point at, they ARE the new representation of one.
alter table public.groups drop constraint if exists groups_class_id_fkey;
alter table public.groups drop column if exists class_id;

-- Carry every existing class over as a group, reusing its class_id as the
-- new group_id so every other table's already-stored value keeps
-- pointing at the right row.
insert into public.groups (group_id, name, course, instructor, schedule, room, status, completion)
select class_id, name, course, instructor, schedule, room, status, completion
from public.classes
on conflict (group_id) do nothing;

alter table public.groups alter column course set not null;

-- B2. `students`: `class_id` becomes `group_id`, now a real foreign key.
alter table public.students add column if not exists group_id text;
update public.students set group_id = class_id where group_id is null;
alter table public.students drop column if exists class_id;
alter table public.students
  add constraint students_group_id_fkey foreign key (group_id) references public.groups(group_id) on delete set null;
create index if not exists idx_students_group_id on public.students(group_id);

-- B3. `attendance_records`: `class_id` becomes `group_id`.
alter table public.attendance_records add column if not exists group_id text;
update public.attendance_records set group_id = class_id where group_id is null;
alter table public.attendance_records alter column group_id set not null;
alter table public.attendance_records drop constraint if exists attendance_records_class_id_fkey;
alter table public.attendance_records drop constraint if exists attendance_records_student_id_class_id_session_date_key;
alter table public.attendance_records drop column if exists class_id;
alter table public.attendance_records
  add constraint attendance_records_group_id_fkey foreign key (group_id) references public.groups(group_id) on delete cascade;
alter table public.attendance_records
  add constraint attendance_records_student_group_session_key unique (student_id, group_id, session_date);
create index if not exists idx_attendance_group_date on public.attendance_records(group_id, session_date);

-- B4. `materials`: drop the old sub-group `group_id`, promote `class_id`
-- to be the (now single) `group_id`.
alter table public.materials drop constraint if exists materials_group_id_fkey;
alter table public.materials drop column if exists group_id;
alter table public.materials add column if not exists group_id text;
update public.materials set group_id = class_id where group_id is null;
alter table public.materials alter column group_id set not null;
alter table public.materials drop constraint if exists materials_class_id_fkey;
alter table public.materials drop column if exists class_id;
alter table public.materials
  add constraint materials_group_id_fkey foreign key (group_id) references public.groups(group_id) on delete cascade;
create index if not exists idx_materials_group_id on public.materials(group_id);

-- B5. `messages`: `class_id` becomes `group_id`.
alter table public.messages add column if not exists group_id text;
update public.messages set group_id = class_id where group_id is null;
alter table public.messages alter column group_id set not null;
alter table public.messages drop constraint if exists messages_class_id_fkey;
alter table public.messages drop column if exists class_id;
alter table public.messages
  add constraint messages_group_id_fkey foreign key (group_id) references public.groups(group_id) on delete cascade;
create index if not exists idx_messages_group_created on public.messages(group_id, created_at);

-- B6. `assignments`: the old optional sub-group `group_id` becomes the
-- assignment's one and only group link; `class_name` (a plain text match,
-- never a real FK) is retired in favor of it.
update public.assignments a
set group_id = c.class_id
from public.classes c
where a.group_id is null and a.class_name = c.name;

alter table public.assignments drop constraint if exists assignments_group_id_fkey;
alter table public.assignments
  add constraint assignments_group_id_fkey foreign key (group_id) references public.groups(group_id) on delete cascade;
alter table public.assignments drop column if exists class_name;
create index if not exists idx_assignments_group_id on public.assignments(group_id);

-- B7. Drop the now-superseded tables.
drop table if exists public.group_members;
drop table if exists public.classes;
drop table if exists public.parent_student_links;
drop table if exists public.parents;

-- B8. `user_profiles.role` no longer allows 'Parent'. Any leftover Parent
-- profile is removed outright — a Parent account is not converted into
-- anything, it simply stops being a valid account type.
delete from public.user_profiles where role = 'Parent';
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('Super Admin', 'School Admin', 'Instructor', 'Student'));

-- =======================================================================
-- SECTION C — helper functions: drop the retired ones, (re)create the
-- ones every policy below needs. Same `security definer` pattern 0002 /
-- 0008 use throughout, so none of this can hit the recursion bug 0008
-- fixed — `groups` and `students` never query each other's policies
-- directly, only through these functions.
-- =======================================================================

drop function if exists public.can_view_student(text, text);
drop function if exists public.instructor_owns_class(text);
drop function if exists public.can_access_class_chat(text);
-- can_view_group(text) is recreated (create or replace) below rather than
-- dropped first — its signature isn't changing, only its body.

create or replace function public.instructor_owns_group(target_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles profile
    join public.groups grp on grp.instructor = profile.instructor_name
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and grp.group_id = target_group_id
  )
$$;

grant execute on function public.instructor_owns_group(text) to anon, authenticated, service_role;

create or replace function public.can_view_student(target_student_id text, target_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.user_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'Student'
        and profile.student_id = target_student_id
    )
    or public.instructor_owns_group(target_group_id)
$$;

grant execute on function public.can_view_student(text, text) to anon, authenticated, service_role;

create or replace function public.can_view_group(target_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.instructor_owns_group(target_group_id)
    or exists (
      select 1 from public.students student
      where student.group_id = target_group_id
        and public.can_view_student(student.student_id, student.group_id)
    )
$$;

grant execute on function public.can_view_group(text) to anon, authenticated, service_role;

create or replace function public.can_access_group_chat(target_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.instructor_owns_group(target_group_id)
    or exists (
      select 1 from public.user_profiles profile
      join public.students s on s.student_id = profile.student_id
      where profile.user_id = auth.uid()
        and profile.role = 'Student'
        and s.group_id = target_group_id
    )
$$;

grant execute on function public.can_access_group_chat(text) to anon, authenticated, service_role;

-- =======================================================================
-- SECTION D — policies, rewritten for the merged schema.
-- =======================================================================

create policy "profiles read own or admin" on public.user_profiles
for select using (user_id = auth.uid() or public.is_admin());

-- ---- students ----

create policy "students scoped read" on public.students
for select using (public.can_view_student(student_id, group_id));

create policy "students write admin" on public.students
for all using (public.is_admin())
with check (public.is_admin());

-- ---- instructors (unchanged shape, just re-created after Section A) ----

create policy "instructors admin read" on public.instructors
for select using (public.is_admin());

create policy "instructors admin write" on public.instructors
for all using (public.is_admin())
with check (public.is_admin());

-- ---- groups: read is admin/that group's instructor/that group's
-- students; write (create, edit, delete) is Manager-only from here on —
-- an Instructor is assigned to a group but can no longer create or edit
-- one themselves (see requirement: "the groups only created by manager").

create policy "groups scoped read" on public.groups
for select using (public.can_view_group(groups.group_id));

create policy "groups write admin only" on public.groups
for all using (public.is_admin())
with check (public.is_admin());

-- ---- materials: scoped to one group, no more sub-group sharing layer.
-- Read: admin, that group's instructor, or that group's students. Write:
-- admin or that group's instructor (a Manager or the assigned Instructor
-- can upload/remove materials for a group — see requirement: show an
-- "Upload materials" button on the group's own page).

create policy "materials scoped read" on public.materials
for select using (public.can_view_group(materials.group_id));

create policy "materials write admin instructor" on public.materials
for all using (public.is_admin() or public.instructor_owns_group(materials.group_id))
with check (public.is_admin() or public.instructor_owns_group(materials.group_id));

-- ---- assignments: scoped to one group.

create policy "assignments scoped read" on public.assignments
for select using (public.can_view_group(assignments.group_id));

create policy "assignments write admin instructor" on public.assignments
for all using (public.is_admin() or public.instructor_owns_group(assignments.group_id))
with check (public.is_admin() or public.instructor_owns_group(assignments.group_id));

-- ---- attendance: taken per group, per session, by that group's own
-- instructor (or a Manager) — see requirement: "I need only the
-- instructor to take attendance for students per session." There is no
-- longer a school-wide Attendance tab (removed in the app); this policy
-- still lets a Manager see/fix attendance anywhere, same as every other
-- admin-scoped table in this schema.

create policy "attendance scoped read" on public.attendance_records
for select using (
  public.is_admin()
  or public.instructor_owns_group(attendance_records.group_id)
  or public.can_view_student(attendance_records.student_id, attendance_records.group_id)
);

create policy "attendance write admin instructor" on public.attendance_records
for all using (public.is_admin() or public.instructor_owns_group(attendance_records.group_id))
with check (public.is_admin() or public.instructor_owns_group(attendance_records.group_id));

-- ---- staff requests: a "removal" request must name a real student in one
-- of the requesting instructor's own groups.

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
      where student.student_id = staff_requests.target_student_id
        and public.instructor_owns_group(student.group_id)
    )
  )
);

-- ---- grades: an instructor can only grade a student who is actually a
-- member of the assignment's own group (same anti-escalation reasoning
-- 0010 used, now checked via group_id instead of a classes/class_name
-- join).

create policy "grades scoped read" on public.grades
for select using (
  exists (
    select 1 from public.students s
    where s.student_id = grades.student_id
      and public.can_view_student(s.student_id, s.group_id)
  )
);

create policy "grades write instructor admin" on public.grades
for all using (
  public.is_admin()
  or exists (
    select 1 from public.assignments a
    join public.students s on s.student_id = grades.student_id and s.group_id = a.group_id
    where a.id = grades.assignment_id
      and public.instructor_owns_group(a.group_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.assignments a
    join public.students s on s.student_id = grades.student_id and s.group_id = a.group_id
    where a.id = grades.assignment_id
      and public.instructor_owns_group(a.group_id)
  )
);

-- ---- group chat: visible to the group's instructor, its students, and
-- any Manager — a Manager can also send in it (see requirement: "the
-- instructor can chat but this chat appear for the manager and can send
-- too"). No more Parent branch.

create policy "messages scoped read" on public.messages
for select using (public.can_access_group_chat(messages.group_id));

create policy "messages scoped insert" on public.messages
for insert with check (
  sender_user_id = auth.uid()
  and public.can_access_group_chat(messages.group_id)
  and exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.full_name = messages.sender_name
      and profile.role = messages.sender_role
  )
);

create policy "messages admin delete" on public.messages
for delete using (public.is_admin());

-- =======================================================================
-- SECTION E — storage: the "materials" bucket's objects are still stored
-- under "<group_id>/<file>" (the folder segment was the class_id before;
-- existing object paths don't need to move, since group_id reuses the
-- same value as class_id for every pre-existing row — see Section B1).
-- =======================================================================

create policy "materials bucket scoped read" on storage.objects
for select using (
  bucket_id = 'materials'
  and public.can_view_group((storage.foldername(name))[1])
);

create policy "materials bucket write admin instructor" on storage.objects
for insert with check (
  bucket_id = 'materials'
  and (
    public.is_admin()
    or public.instructor_owns_group((storage.foldername(name))[1])
  )
);

create policy "materials bucket delete admin instructor" on storage.objects
for delete using (
  bucket_id = 'materials'
  and (
    public.is_admin()
    or public.instructor_owns_group((storage.foldername(name))[1])
  )
);
