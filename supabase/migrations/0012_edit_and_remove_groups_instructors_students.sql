-- Adds the missing "edit" half of groups/students management:
--
--   1. A Manager could already create a group and remove an instructor or
--      student outright, but there was no way to EDIT a group, instructor,
--      or student's info once created, and no way to remove a group at
--      all. Manager write access to groups/instructors/students was
--      already unrestricted (see the "... write admin" FOR ALL policies in
--      0011), so a Manager editing or deleting any of the three needs no
--      new policy here — this migration is entirely about giving an
--      INSTRUCTOR a narrow new slice of write access they didn't have
--      before: editing (not deleting) a group they're assigned to, and
--      editing (not deleting, not reassigning) a student in that group.
--   2. Row-level security can only gate whole rows, not individual
--      columns, so each new UPDATE policy is paired with a BEFORE UPDATE
--      trigger that blocks a non-admin from touching the handful of
--      columns that should stay Manager-only (which group an instructor
--      is assigned to / which course a group runs, and a student's login
--      email / student_id / which group they're in). Everything else on
--      the row — name, schedule, room, status, level, phone, notes, etc.
--      — passes through untouched by the trigger.
--   3. `instructors.name` (not a uuid id) is what `groups.instructor`,
--      `user_profiles.instructor_name`, and `staff_requests.instructor_name`
--      all match against — it's a de facto foreign key everywhere else in
--      the schema (see instructor_owns_group() in 0011). A Manager editing
--      an instructor's name (see editInstructorModal() in app.js) needs
--      that rename to cascade everywhere it's referenced, or it silently
--      orphans that instructor's groups and breaks their own RLS access —
--      an AFTER UPDATE trigger on `instructors` does that cascade.
--
-- Run this after 0001-0011.

-- =======================================================================
-- SECTION A — groups: let a group's own Instructor UPDATE it (still never
-- INSERT or DELETE — see security.js's canRemoveGroups, Manager-only).
-- =======================================================================

drop policy if exists "groups write admin only" on public.groups;

create policy "groups write admin" on public.groups
for all using (public.is_admin())
with check (public.is_admin());

create policy "groups update own instructor" on public.groups
for update using (public.instructor_owns_group(groups.group_id))
with check (public.instructor_owns_group(groups.group_id));

create or replace function public.enforce_group_edit_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Managers can change anything about a group, including reassigning it
  -- to a different instructor or changing its course. An Instructor
  -- editing their own group (the only row this trigger ever sees them
  -- touch, per the RLS policy above) can only change its name, schedule,
  -- room, and status — not which course it runs or who's assigned to it.
  if public.is_admin() then
    return new;
  end if;

  if new.course is distinct from old.course then
    raise exception 'Only a Manager can change a group''s course.';
  end if;

  if new.instructor is distinct from old.instructor then
    raise exception 'Only a Manager can reassign a group to a different instructor.';
  end if;

  return new;
end;
$$;

drop trigger if exists groups_restrict_instructor_edit on public.groups;
create trigger groups_restrict_instructor_edit
before update on public.groups
for each row execute function public.enforce_group_edit_columns();

-- =======================================================================
-- SECTION B — students: let an Instructor UPDATE a student who's in one
-- of their own groups (still never INSERT/DELETE a student directly —
-- creating one goes through the existing "add student" flow, and removal
-- stays Manager-only / request-based, see security.js's canRemoveAccounts
-- and the existing "removal" staff_requests kind).
-- =======================================================================

create policy "students update own instructor" on public.students
for update using (public.instructor_owns_group(students.group_id))
with check (public.instructor_owns_group(students.group_id));

create or replace function public.enforce_student_edit_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Manager: unrestricted (covers editing any field, including moving a
  -- student to a different group via the "add existing student to a
  -- group" picker). Instructor: can fix a student's name/phone/level/
  -- status/notes for a student already in one of their own groups, but
  -- can't change their login email, their student_id, or which group
  -- they're in — those stay Manager-only.
  if public.is_admin() then
    return new;
  end if;

  if new.email is distinct from old.email then
    raise exception 'Only a Manager can change a student''s login email.';
  end if;

  if new.student_id is distinct from old.student_id then
    raise exception 'A student''s student_id can''t be changed.';
  end if;

  if new.group_id is distinct from old.group_id then
    raise exception 'Only a Manager can move a student to a different group.';
  end if;

  return new;
end;
$$;

drop trigger if exists students_restrict_instructor_edit on public.students;
create trigger students_restrict_instructor_edit
before update on public.students
for each row execute function public.enforce_student_edit_columns();

-- =======================================================================
-- SECTION C — instructors: renaming one (Manager-only, see
-- editInstructorModal()/handleEditInstructor() in app.js) must cascade
-- everywhere `instructors.name` is matched by text elsewhere, since
-- nothing else in the schema references an instructor by a stable id.
-- =======================================================================

create or replace function public.cascade_instructor_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.groups set instructor = new.name where instructor = old.name;
    update public.user_profiles set instructor_name = new.name where instructor_name = old.name;
    update public.staff_requests set instructor_name = new.name where instructor_name = old.name;
  end if;
  return new;
end;
$$;

drop trigger if exists instructors_cascade_rename on public.instructors;
create trigger instructors_cascade_rename
after update on public.instructors
for each row execute function public.cascade_instructor_rename();

-- =======================================================================
-- SECTION D — nothing further to add for delete (edits stay Manager-only,
-- already covered by the existing "instructors admin write" FOR ALL
-- policy from 0011) or for group/instructor/student DELETE (already
-- Manager-only via the existing "... write admin" FOR ALL policies — a
-- group's own Instructor only ever gets the narrower FOR UPDATE policy
-- above, so DELETE on groups/students/instructors still requires
-- is_admin() either way). Noted here for anyone reading this migration
-- looking for the rest of the story.
-- =======================================================================
