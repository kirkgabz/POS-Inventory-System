-- 014: Staff online status / "Active 30 mins ago"
-- Kept in its own small table so the once-a-minute heartbeat doesn't
-- touch profiles (and doesn't spam profile triggers / live updates).

create table if not exists public.user_presence (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;

-- Store owners see everyone; each person can see their own row.
drop policy if exists "presence read" on public.user_presence;
create policy "presence read" on public.user_presence
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
-- No insert/update policies: only touch_presence() below writes.

-- Heartbeat: "I'm here right now".
create or replace function public.touch_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz := now();
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.user_presence (user_id, last_seen_at)
  values (auth.uid(), t)
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
  return t;
end;
$$;
revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

-- Seed from the last sign-in so "Active … ago" isn't blank on day one.
insert into public.user_presence (user_id, last_seen_at)
select p.id, u.last_sign_in_at
from public.profiles p
join auth.users u on u.id = p.id
where u.last_sign_in_at is not null
on conflict (user_id) do nothing;

-- Live updates for the owner's Staff page
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_presence'
  ) then
    alter publication supabase_realtime add table public.user_presence;
  end if;
end $$;
