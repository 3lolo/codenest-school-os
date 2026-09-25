-- Drops everything created by migrations 0001-0012, so you can re-run
-- them from a clean slate. Safe to run even if some objects don't exist
-- yet (everything uses IF EXISTS) — this covers both a database that
-- already had 0011 applied (groups/grades/messages/etc.) and one that
-- never got past an earlier migration (the legacy classes/parents/
-- group_members drops below are harmless no-ops in that case). This does
-- NOT touch Supabase Auth users (Authentication -> Users) — delete those
-- manually there if you also want to remove a test login you created.

drop table if exists public.reviews cascade;
drop table if exists public.opportunities cascade;
drop table if exists public.staff_requests cascade;
drop table if exists public.messages cascade;
drop table if exists public.grades cascade;
drop table if exists public.materials cascade;
drop table if exists public.attendance_records cascade;
drop table if exists public.contact_requests cascade;
drop table if exists public.user_profiles cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.notifications cascade;
drop table if exists public.communications cascade;
drop table if exists public.assignments cascade;
drop table if exists public.groups cascade;
drop table if exists public.instructors cascade;
drop table if exists public.students cascade;
drop table if exists public.school_settings cascade;

-- Legacy tables dropped by migration 0011 — no-ops on a database that
-- already had 0011 applied, but needed to fully reset one that didn't.
drop table if exists public.group_members cascade;
drop table if exists public.parent_student_links cascade;
drop table if exists public.parents cascade;
drop table if exists public.classes cascade;

drop function if exists public.mark_password_changed() cascade;
drop function if exists public.enforce_group_edit_columns() cascade;
drop function if exists public.enforce_student_edit_columns() cascade;
drop function if exists public.cascade_instructor_rename() cascade;
drop function if exists public.can_view_student(text, text) cascade;
drop function if exists public.can_view_group(text) cascade;
drop function if exists public.can_access_group_chat(text) cascade;
drop function if exists public.can_access_class_chat(text) cascade;
drop function if exists public.instructor_owns_group(text) cascade;
drop function if exists public.instructor_owns_class(text) cascade;
drop function if exists public.is_super_admin() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.current_role() cascade;
