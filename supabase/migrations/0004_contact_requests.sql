-- Public marketing site lead capture: "Contact us" and "Request a call"
-- submissions from the homepage land here. Anyone (even signed-out
-- visitors) can insert a row using the anon key — that is the only
-- permission granted to anon on this table. Only a Manager (Super Admin or
-- School Admin) can read or update the submissions, from the in-app
-- "Contact Requests" panel.
--
-- Run this after 0001-0003.

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'contact' check (kind in ('contact', 'call_request')),
  name text not null,
  email text not null,
  phone text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_requests_created_at on public.contact_requests (created_at desc);

alter table public.contact_requests enable row level security;

drop policy if exists "contact requests public insert" on public.contact_requests;
create policy "contact requests public insert" on public.contact_requests
for insert
with check (
  length(trim(name)) > 0
  and length(trim(email)) > 0
  and length(coalesce(message, '')) < 4000
);

drop policy if exists "contact requests admin read" on public.contact_requests;
create policy "contact requests admin read" on public.contact_requests
for select using (public.is_admin());

drop policy if exists "contact requests admin update" on public.contact_requests;
create policy "contact requests admin update" on public.contact_requests
for update using (public.is_admin())
with check (public.is_admin());
