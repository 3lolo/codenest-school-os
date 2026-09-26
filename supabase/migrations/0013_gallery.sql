-- Lets a Manager manage the homepage's "Gallery" section (photos/videos
-- from previous classes) from the dashboard instead of it being a
-- hardcoded, always-empty placeholder list in app.js.
--
-- Unlike `materials` (private, scoped to one group's own members) or
-- `opportunities` (public read but only for rows marked "open"), every
-- gallery row is meant to be visible to anyone who visits the homepage —
-- there's no draft/pending state here, a Manager just adds or removes
-- items directly. So: public SELECT on the table (`using (true)`), and a
-- PUBLIC storage bucket, so the marketing page's <img>/<video> tags can
-- point straight at a stable URL with no Authorization header at all —
-- exactly what a signed-out visitor's browser needs.
--
-- Run this after 0001-0012.

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('image', 'video')),
  file_path text not null,
  poster_path text,
  caption text,
  created_at timestamptz not null default now()
);

alter table public.gallery_items enable row level security;

create index if not exists idx_gallery_items_created_at on public.gallery_items(created_at);

drop policy if exists "gallery items public read" on public.gallery_items;
create policy "gallery items public read" on public.gallery_items
for select using (true);

drop policy if exists "gallery items admin write" on public.gallery_items;
create policy "gallery items admin write" on public.gallery_items
for all using (public.is_admin())
with check (public.is_admin());

-- Public storage bucket for uploaded photos/videos (and optional video
-- poster images). `public = true` means Storage serves objects straight
-- from `/storage/v1/object/public/gallery/<path>` with no auth check and
-- no RLS evaluation at all — the policies below only ever gate writes.
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

drop policy if exists "gallery bucket write admin" on storage.objects;
create policy "gallery bucket write admin" on storage.objects
for insert with check (bucket_id = 'gallery' and public.is_admin());

drop policy if exists "gallery bucket update admin" on storage.objects;
create policy "gallery bucket update admin" on storage.objects
for update using (bucket_id = 'gallery' and public.is_admin())
with check (bucket_id = 'gallery' and public.is_admin());

drop policy if exists "gallery bucket delete admin" on storage.objects;
create policy "gallery bucket delete admin" on storage.objects
for delete using (bucket_id = 'gallery' and public.is_admin());
