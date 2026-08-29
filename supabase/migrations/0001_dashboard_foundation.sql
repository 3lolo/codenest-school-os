create extension if not exists "pgcrypto";

create table if not exists public.school_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  portal_url text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  date_of_birth date,
  status text not null,
  level text,
  family text,
  parent_name text,
  class_id text,
  progress integer not null default 0 check (progress between 0 and 100),
  attendance integer not null default 0 check (attendance between 0 and 100),
  avg_grade integer not null default 0 check (avg_grade between 0 and 100),
  absences integer not null default 0,
  late integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.parents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  children text[] not null default '{}',
  preference text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  classes text[] not null default '{}',
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  class_id text not null unique,
  name text not null,
  course text not null,
  instructor text,
  student_count integer not null default 0,
  schedule text,
  room text,
  status text not null,
  completion integer not null default 0 check (completion between 0 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  course text not null,
  class_name text not null,
  due_date date,
  status text not null,
  submissions integer not null default 0,
  total integer not null default 0,
  max_grade integer not null default 100,
  difficulty text,
  created_at timestamptz not null default now()
);

create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  recipient text not null,
  subject text not null,
  display_time text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  display_time text not null,
  unread boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity text not null,
  display_time text not null,
  meta text,
  created_at timestamptz not null default now()
);

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

create policy "public demo read school settings" on public.school_settings for select using (true);
create policy "public demo read students" on public.students for select using (true);
create policy "public demo read parents" on public.parents for select using (true);
create policy "public demo read instructors" on public.instructors for select using (true);
create policy "public demo read classes" on public.classes for select using (true);
create policy "public demo read assignments" on public.assignments for select using (true);
create policy "public demo read communications" on public.communications for select using (true);
create policy "public demo read notifications" on public.notifications for select using (true);
create policy "public demo read audit logs" on public.audit_logs for select using (true);

create index if not exists idx_students_class_id on public.students(class_id);
create index if not exists idx_students_status on public.students(status);
create index if not exists idx_classes_status on public.classes(status);
create index if not exists idx_assignments_status on public.assignments(status);
