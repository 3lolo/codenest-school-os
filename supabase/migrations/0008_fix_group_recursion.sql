-- Patch for a real bug shipped in 0006_instructor_operations.sql: reading
-- any of `groups`, `group_members`, or `materials` from the app could fail
-- with a plain HTTP 500 and a Postgres error of
-- "infinite recursion detected in policy for relation ...".
--
-- Root cause: the original "groups scoped read" policy queried
-- `group_members` directly (via an EXISTS subquery), and the original
-- "group members scoped read" policy queried `groups` directly right back.
-- Postgres evaluates RLS for every table touched while evaluating a query,
-- including tables only touched inside another table's own policy — so
-- selecting from `groups` re-triggered `group_members`'s policy, which
-- re-triggered `groups`'s policy again, forming a cycle Postgres refuses to
-- evaluate. `materials`'s read policy queried `group_members` the same way,
-- so it hit the identical error whenever a material was scoped to a group.
--
-- This file only needs to run once, on a project that already ran the
-- original (buggy) `0006_instructor_operations.sql`. It is safe to run
-- again if needed — every statement below is `create or replace` /
-- `drop policy if exists` + `create policy`, so nothing here depends on
-- the previous state beyond the tables it patches already existing.
--
-- If you have NOT run `0006_instructor_operations.sql` yet: don't run this
-- file on its own. Just run the current `0006_instructor_operations.sql`
-- from this repo (it already has this fix baked in) and skip this file —
-- rerunning this patch afterwards is harmless, but unnecessary.
--
-- The fix: route the cross-table checks through `security definer`
-- functions (the same pattern `is_admin()` / `can_view_student()` already
-- use in 0002_production_rls.sql). A `security definer` function's
-- internal queries bypass RLS entirely instead of re-triggering another
-- table's policy, which breaks the cycle.

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

-- groups: read + write, rewritten to use the helpers above instead of
-- querying group_members/user_profiles/classes directly.
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

-- group_members: read + write, rewritten the same way.
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

-- materials: read + write, rewritten so the group-scoped branch goes
-- through can_view_group() instead of querying group_members directly.
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
