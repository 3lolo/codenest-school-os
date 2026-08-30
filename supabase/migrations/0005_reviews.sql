-- Public marketing site reviews: visitors can submit a review from the
-- homepage "Leave a review" form using the anon key. New reviews land as
-- 'pending' and are invisible to the public until a Manager (Super Admin or
-- School Admin) approves them from the in-app "Reviews" panel. Anyone
-- (even signed-out visitors) can read only the approved rows, which is what
-- powers the public reviews section on the homepage.
--
-- Run this after 0001-0004.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role_or_school text,
  quote text not null,
  rating smallint not null default 5 check (rating between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_status_created_at on public.reviews (status, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "reviews public insert" on public.reviews;
create policy "reviews public insert" on public.reviews
for insert
with check (
  length(trim(name)) > 0
  and length(trim(quote)) > 0
  and length(quote) < 2000
  and length(coalesce(role_or_school, '')) < 200
  and status = 'pending'
);

drop policy if exists "reviews public read approved" on public.reviews;
create policy "reviews public read approved" on public.reviews
for select using (status = 'approved');

drop policy if exists "reviews admin read all" on public.reviews;
create policy "reviews admin read all" on public.reviews
for select using (public.is_admin());

drop policy if exists "reviews admin update" on public.reviews;
create policy "reviews admin update" on public.reviews
for update using (public.is_admin())
with check (public.is_admin());
