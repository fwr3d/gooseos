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
