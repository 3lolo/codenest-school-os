-- Web Push subscriptions: one row per browser/device a signed-in user has
-- turned notifications on for (see the "Enable notifications" toggle in
-- profileView() in src/app.js). A user can have more than one row (phone +
-- laptop, say) — `endpoint` is the natural unique key a browser hands back
-- from PushManager.subscribe(), not the user, so re-subscribing the same
-- device just upserts its row instead of creating a duplicate.
--
-- Nothing here is enrolled automatically: notifications only ever go to a
-- subscription this table already holds, which only exists because that
-- browser asked for one after the signed-in user opted in.
--
-- RLS scopes every row to its own owner (auth.uid() = user_id) — a user can
-- see/add/remove only their own subscriptions. The server-side fan-out in
-- api/send-notification.js reads across every user's subscriptions to
-- deliver a push, which it can only do with the service-role key (RLS is
-- never bypassed by anything running with the anon key), exactly like
-- every other privileged server-side operation in this project (see
-- api/create-account.js and api/remove-account.js).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions(user_id);

drop policy if exists "push_subscriptions select own" on public.push_subscriptions;
create policy "push_subscriptions select own" on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions insert own" on public.push_subscriptions;
create policy "push_subscriptions insert own" on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

-- Lets a client re-subscribe (refresh its keys) via PostgREST's
-- on_conflict=endpoint upsert (see supabaseUpsert() in src/app.js) without
-- needing a separate update policy path — an upsert still checks the
-- insert policy above, but Postgres needs an explicit update policy too
-- for the "conflict -> update the existing row" branch to be allowed.
drop policy if exists "push_subscriptions update own" on public.push_subscriptions;
create policy "push_subscriptions update own" on public.push_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions delete own" on public.push_subscriptions;
create policy "push_subscriptions delete own" on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);
