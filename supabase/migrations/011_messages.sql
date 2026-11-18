-- 011 · Messages & reminders
--  The store owner sends a MESSAGE or a REMINDER to one, several or all staff.
--  Staff read them, mark reminders done, and can reply to the sender.
--  Everything goes through send_message() / mark_message() so the rules hold.

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid references public.profiles(id) on delete set null,
  sender_name  text not null,
  sender_role  text,
  kind         text not null default 'message' check (kind in ('message', 'reminder')),
  title        text,
  body         text not null check (length(body) between 1 and 4000),
  due_at       timestamptz,                         -- reminders: optional "by when"
  important    boolean not null default false,
  to_all       boolean not null default false,      -- sent to every staff member
  parent_id    uuid references public.messages(id) on delete cascade,  -- replies
  created_at   timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists messages_parent_idx  on public.messages (parent_id);

create table if not exists public.message_recipients (
  message_id    uuid not null references public.messages(id) on delete cascade,
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  read_at       timestamptz,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  primary key (message_id, recipient_id)
);
create index if not exists message_recipients_me_idx on public.message_recipients (recipient_id, created_at desc);

alter table public.messages           enable row level security;
alter table public.message_recipients enable row level security;

-- helpers (security definer → no RLS recursion)
create or replace function public._msg_is_recipient(p_message uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from message_recipients where message_id = p_message and recipient_id = auth.uid());
$$;
create or replace function public._msg_is_sender(p_message uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from messages where id = p_message and sender_id = auth.uid());
$$;

-- read: only what I sent and what was sent to me
-- (a staff reply goes to the owner only — other staff never see it)
drop policy if exists "messages: read" on public.messages;
create policy "messages: read" on public.messages for select using (
  public.is_active_user() and (sender_id = auth.uid() or public._msg_is_recipient(id))
);
-- the sender can delete their own message (recipients' copies go with it)
drop policy if exists "messages: sender deletes" on public.messages;
create policy "messages: sender deletes" on public.messages for delete using (sender_id = auth.uid());

-- recipients rows: mine, or for messages I sent (to see who read it)
drop policy if exists "message_recipients: read" on public.message_recipients;
create policy "message_recipients: read" on public.message_recipients for select using (
  recipient_id = auth.uid() or public._msg_is_sender(message_id)
);
-- no insert/update policies: only through the functions below

-- ---------------------------------------------------------------------
-- send_message: owner → chosen staff / all staff; anyone → reply in a thread
-- ---------------------------------------------------------------------
create or replace function public.send_message(
  p_kind        text,
  p_body        text,
  p_title       text default null,
  p_recipients  uuid[] default null,
  p_to_all      boolean default false,
  p_due_at      timestamptz default null,
  p_important   boolean default false,
  p_parent      uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me     profiles%rowtype;
  v_id     uuid;
  v_parent messages%rowtype;
  v_to     uuid[];
begin
  select * into v_me from profiles where id = auth.uid() and is_active;
  if v_me.id is null then raise exception 'TB_MSG: Your account is not active.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'TB_MSG: Write a message first.'; end if;
  if p_kind not in ('message', 'reminder') then raise exception 'TB_MSG: Unknown message type.'; end if;

  if p_parent is not null then
    -- reply: goes to everyone else in the thread (sender + recipients), not to all staff
    select * into v_parent from messages where id = p_parent;
    if v_parent.id is null then raise exception 'TB_MSG: That message no longer exists.'; end if;
    if v_parent.parent_id is not null then raise exception 'TB_MSG: Reply to the original message.'; end if;
    if not (v_parent.sender_id = v_me.id or exists (select 1 from message_recipients where message_id = p_parent and recipient_id = v_me.id)) then
      raise exception 'TB_MSG: You are not part of this conversation.';
    end if;
    -- staff replies go back to the sender only; the owner replies to everyone
    -- in the message, or only to the people picked (p_recipients)
    if v_parent.sender_id = v_me.id then
      select array_agg(recipient_id) into v_to from message_recipients
      where message_id = p_parent
        and (coalesce(array_length(p_recipients, 1), 0) = 0 or recipient_id = any(p_recipients));
    else
      v_to := array[v_parent.sender_id];
    end if;
    p_kind := 'message';
  else
    if v_me.role <> 'admin' then raise exception 'TB_MSG: Only the store owner can start a message.'; end if;
    if p_to_all then
      select array_agg(id) into v_to from profiles where role = 'staff' and is_active and id <> v_me.id;
    else
      select array_agg(id) into v_to from profiles where id = any(coalesce(p_recipients, '{}')) and is_active and id <> v_me.id;
    end if;
  end if;

  if v_to is null or array_length(v_to, 1) is null then raise exception 'TB_MSG: Choose at least one staff member.'; end if;

  insert into messages (sender_id, sender_name, sender_role, kind, title, body, due_at, important, to_all, parent_id)
  values (v_me.id, v_me.full_name, v_me.role::text, p_kind, nullif(trim(p_title), ''), trim(p_body),
          case when p_kind = 'reminder' then p_due_at end, coalesce(p_important, false),
          p_parent is null and coalesce(p_to_all, false), p_parent)
  returning id into v_id;

  insert into message_recipients (message_id, recipient_id)
  select v_id, r from unnest(v_to) r where r is not null and r <> v_me.id
  on conflict do nothing;

  -- a reply re-opens the thread for the people it goes to
  if p_parent is not null then
    update message_recipients set read_at = null where message_id = p_parent and recipient_id = any(v_to);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- mark_message: recipient marks read / reminder done (or undoes done)
-- ---------------------------------------------------------------------
create or replace function public.mark_message(p_message uuid, p_read boolean default true, p_done boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update message_recipients
  set read_at = case when p_read then coalesce(read_at, now()) else null end,
      done_at = case when p_done is null then done_at when p_done then coalesce(done_at, now()) else null end
  where message_id = p_message and recipient_id = auth.uid();
end $$;

revoke all on function public.send_message(text, text, text, uuid[], boolean, timestamptz, boolean, uuid) from public, anon;
grant execute on function public.send_message(text, text, text, uuid[], boolean, timestamptz, boolean, uuid) to authenticated;
revoke all on function public.mark_message(uuid, boolean, boolean) from public, anon;
grant execute on function public.mark_message(uuid, boolean, boolean) to authenticated;

-- live delivery
do $$ begin
  alter publication supabase_realtime add table public.message_recipients;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
