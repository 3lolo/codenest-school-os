-- Fixes a real bug: an Instructor adding a brand-new student to one of
-- their own groups (canCreateStudentProfiles() in security.js says they
-- can; handleAddStudent() in src/app.js lets them submit the form) has
-- always been rejected by RLS with "new row violates row-level security
-- policy for table students" — there was never an INSERT policy for
-- anyone but a Manager.
--
-- History: 0006_instructor_operations.sql's original "students write
-- instructor own class" policy covered INSERT *and* UPDATE together, but
-- 0011_groups_replace_classes_drop_parent.sql dropped it while merging
-- classes into groups and replaced it with only "students write admin"
-- (FOR ALL, admin-only). 0012_edit_and_remove_groups_instructors_students.sql
-- later restored the UPDATE half for an instructor's own group ("students
-- update own instructor") — its own comment says INSERT was assumed to
-- already be handled elsewhere ("creating one goes through the existing
-- add student flow"), but no such policy actually existed after 0011. This
-- migration adds the missing INSERT half, scoped the same way the existing
-- UPDATE policy already is.
--
-- Run this after 0001-0015.

drop policy if exists "students insert own instructor" on public.students;
create policy "students insert own instructor" on public.students
for insert
with check (public.instructor_owns_group(students.group_id));
