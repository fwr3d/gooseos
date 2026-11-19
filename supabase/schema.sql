-- GooseOS sync table. Paste this into Supabase: SQL Editor -> New query -> Run.
-- One table holds data for every app on the home screen.

create table if not exists public.items (
  user_id   uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  app       text    not null,
  id        text    not null,
  data      jsonb,
  updated   bigint  not null,
  deleted   boolean not null default false,
  synced_at timestamptz not null default now(),
  primary key (user_id, app, id)
);

-- synced_at is set by the server on every write, so each device can ask
-- "what changed since I last looked?" without trusting device clocks.
create or replace function public.items_touch() returns trigger
language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

-- Only keep the newer version when two devices edit the same thing.
create or replace function public.items_keep_newest() returns trigger
language plpgsql as $$
begin
  if new.updated < old.updated then
    return null; -- skip the older write
  end if;
  return new;
end $$;

drop trigger if exists items_keep_newest on public.items;
create trigger items_keep_newest before update on public.items
  for each row execute function public.items_keep_newest();

create index if not exists items_user_synced on public.items (user_id, synced_at);

-- Each person can only see and change their own rows.
alter table public.items enable row level security;

drop policy if exists "own rows: read" on public.items;
create policy "own rows: read" on public.items for select using (auth.uid() = user_id);

drop policy if exists "own rows: add" on public.items;
create policy "own rows: add" on public.items for insert with check (auth.uid() = user_id);

drop policy if exists "own rows: change" on public.items;
create policy "own rows: change" on public.items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.items;
create policy "own rows: delete" on public.items for delete using (auth.uid() = user_id);

-- Calendar feed (Reminders -> "Get reminders on your phone").
-- A feed token is a long random secret. Whoever has the link can read the short
-- list of titles and due times GooseOS saves for the feed, and nothing else.
create table if not exists public.feeds (
  token   text primary key check (length(token) >= 32),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created timestamptz not null default now()
);

alter table public.feeds enable row level security;

drop policy if exists "own feeds: read" on public.feeds;
create policy "own feeds: read" on public.feeds for select using (auth.uid() = user_id);

drop policy if exists "own feeds: add" on public.feeds;
create policy "own feeds: add" on public.feeds for insert with check (auth.uid() = user_id);

drop policy if exists "own feeds: delete" on public.feeds;
create policy "own feeds: delete" on public.feeds for delete using (auth.uid() = user_id);

-- What /api/feed calls. Returns the saved feed list for a valid token, or null.
create or replace function public.feed_agenda(feed_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select i.data
  from public.feeds f
  join public.items i on i.user_id = f.user_id
  where f.token = feed_token and i.app = 'feed' and i.id = 'agenda' and not i.deleted
  limit 1;
$$;

revoke all on function public.feed_agenda(text) from public;
grant execute on function public.feed_agenda(text) to anon, authenticated;

-- Files (Transfer, Milestones attachments, PDF editor). Run this part once.
-- Each person gets a private folder named after their user id; nobody else can
-- list, read or change it. 50 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "own files: read" on storage.objects;
create policy "own files: read" on storage.objects for select
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own files: add" on storage.objects;
create policy "own files: add" on storage.objects for insert
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own files: change" on storage.objects;
create policy "own files: change" on storage.objects for update
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own files: delete" on storage.objects;
create policy "own files: delete" on storage.objects for delete
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
