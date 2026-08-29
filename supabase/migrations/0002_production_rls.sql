create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('Super Admin', 'School Admin', 'Instructor', 'Student', 'Parent')),
  student_id text,
  instructor_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.parent_student_links (
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  student_id text not null references public.students(student_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_user_id, student_id)
);

alter table public.user_profiles enable row level security;
alter table public.parent_student_links enable row level security;
alter table public.school_settings enable row level security;
alter table public.students enable row level security;
alter table public.parents enable row level security;
alter table public.instructors enable row level security;
alter table public.classes enable row level security;
alter table public.assignments enable row level security;
alter table public.communications enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "public demo read school settings" on public.school_settings;
drop policy if exists "public demo read students" on public.students;
drop policy if exists "public demo read parents" on public.parents;
drop policy if exists "public demo read instructors" on public.instructors;
drop policy if exists "public demo read classes" on public.classes;
drop policy if exists "public demo read assignments" on public.assignments;
drop policy if exists "public demo read communications" on public.communications;
drop policy if exists "public demo read notifications" on public.notifications;
drop policy if exists "public demo read audit logs" on public.audit_logs;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_profiles where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('Super Admin', 'School Admin'), false)
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'Super Admin', false)
$$;

create or replace function public.can_view_student(target_student_id text, target_class_id text)
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
    or exists (
      select 1 from public.parent_student_links link
      where link.parent_user_id = auth.uid()
        and link.student_id = target_student_id
    )
    or exists (
      select 1 from public.user_profiles profile
      join public.classes class on class.instructor = profile.instructor_name
      where profile.user_id = auth.uid()
        and profile.role = 'Instructor'
        and class.class_id = target_class_id
    )
$$;

create policy "profiles read own or admin" on public.user_profiles
for select using (user_id = auth.uid() or public.is_super_admin());

create policy "parent links read own or admin" on public.parent_student_links
for select using (parent_user_id = auth.uid() or public.is_admin());

create policy "settings read authenticated" on public.school_settings
for select using (auth.uid() is not null);

create policy "settings update super admin" on public.school_settings
for update using (public.is_super_admin())
with check (public.is_super_admin());

create policy "students scoped read" on public.students
for select using (public.can_view_student(student_id, class_id));

create policy "students write admin" on public.students
for all using (public.is_admin())
with check (public.is_admin());

create policy "parents admin read" on public.parents
for select using (public.is_admin());

create policy "parents admin write" on public.parents
for all using (public.is_admin())
with check (public.is_admin());

create policy "instructors admin read" on public.instructors
for select using (public.is_admin());

create policy "instructors admin write" on public.instructors
for all using (public.is_admin())
with check (public.is_admin());

create policy "classes scoped read" on public.classes
for select using (
  public.is_admin()
  or exists (
    select 1 from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and profile.instructor_name = classes.instructor
  )
  or exists (
    select 1 from public.students student
    where student.class_id = classes.class_id
      and public.can_view_student(student.student_id, student.class_id)
  )
);

create policy "classes write admin" on public.classes
for all using (public.is_admin())
with check (public.is_admin());

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
        or exists (
          select 1 from public.students student
          where student.class_id = class.class_id
            and public.can_view_student(student.student_id, student.class_id)
        )
      )
  )
);

create policy "assignments write admin instructor" on public.assignments
for all using (
  public.is_admin()
  or exists (
    select 1 from public.classes class
    join public.user_profiles profile on profile.instructor_name = class.instructor
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.name = assignments.class_name
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.classes class
    join public.user_profiles profile on profile.instructor_name = class.instructor
    where profile.user_id = auth.uid()
      and profile.role = 'Instructor'
      and class.name = assignments.class_name
  )
);

create policy "communications admin instructor read" on public.communications
for select using (public.is_admin() or public.current_role() = 'Instructor');

create policy "notifications authenticated read" on public.notifications
for select using (auth.uid() is not null);

create policy "audit super admin read" on public.audit_logs
for select using (public.is_super_admin());
