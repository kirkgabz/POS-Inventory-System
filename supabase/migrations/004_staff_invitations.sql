-- =====================================================================
--  004 — staff join by invitation only
--  The store owner creates an invitation (link/code); a new staff member
--  must use it to create an account. Run once in Supabase → SQL Editor.
-- =====================================================================

-- 1) Invitations
create table if not exists public.staff_invites (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9-]{8,32}$'),
  invited_name  text,
  email         text,                          -- optional: only this email may use it
  created_by    uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz not null default now() + interval '7 days',
  used_by       uuid references public.profiles(id) on delete set null,
  used_at       timestamptz,
  revoked       boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.staff_invites enable row level security;

drop policy if exists "staff_invites: owner read" on public.staff_invites;
create policy "staff_invites: owner read" on public.staff_invites
  for select to authenticated using (public.is_admin());
drop policy if exists "staff_invites: owner insert" on public.staff_invites;
create policy "staff_invites: owner insert" on public.staff_invites
  for insert to authenticated with check (public.is_admin() and created_by = auth.uid());
drop policy if exists "staff_invites: owner update" on public.staff_invites;
create policy "staff_invites: owner update" on public.staff_invites
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "staff_invites: owner delete" on public.staff_invites;
create policy "staff_invites: owner delete" on public.staff_invites
  for delete to authenticated using (public.is_admin());

-- 2) Public check used by the sign-up page before creating the account.
--    Reveals only whether the code is usable (+ the name/email it was made for).
create or replace function public.check_staff_invite(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v staff_invites%rowtype; v_owner text;
begin
  select * into v from staff_invites where code = upper(trim(p_code));
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if v.revoked then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if v.used_at is not null then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if v.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select full_name into v_owner from profiles where id = v.created_by;
  return jsonb_build_object('valid', true, 'invited_name', v.invited_name, 'email', v.email,
                            'expires_at', v.expires_at, 'owner', v_owner);
end $$;

revoke all on function public.check_staff_invite(text) from public;
grant execute on function public.check_staff_invite(text) to anon, authenticated;

-- 3) New sign-ups: first account = store owner; owner key = store owner;
--    everyone else MUST bring a valid staff invitation.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_is_first boolean;
  v_code     text;
  v_role     public.user_role := 'staff';
  v_name     text := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
                              nullif(new.raw_user_meta_data->>'name', ''),
                              split_part(new.email, '@', 1));
  v_inv      staff_invites%rowtype;
begin
  select not exists (select 1 from profiles) into v_is_first;
  select admin_signup_code into v_code from app_settings where id = 1;

  if v_is_first then
    v_role := 'admin';
  elsif new.raw_user_meta_data->>'requested_role' = 'admin' then
    if v_code is null or length(v_code) = 0 or new.raw_user_meta_data->>'admin_code' is distinct from v_code then
      raise exception 'TB_OWNER_KEY_INVALID: The store owner key is not valid.';
    end if;
    v_role := 'admin';
  else
    select * into v_inv from staff_invites
    where code = upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')))
    for update;
    if not found or v_inv.revoked or v_inv.used_at is not null or v_inv.expires_at < now() then
      raise exception 'TB_INVITE_INVALID: A valid invitation from the store owner is required.';
    end if;
    if v_inv.email is not null and lower(v_inv.email) <> lower(new.email) then
      raise exception 'TB_INVITE_EMAIL: This invitation was made for a different email address.';
    end if;
  end if;

  insert into profiles (id, full_name, email, role, is_active, can_manage_products)
  values (new.id, v_name, new.email, v_role, true, v_role = 'admin');

  if v_role = 'staff' then
    update staff_invites set used_by = new.id, used_at = now() where id = v_inv.id;

    insert into notifications (recipient_id, actor_id, actor_name, type, title, message, data)
    select p.id, new.id, v_name, 'staff_signup', 'New staff joined',
           format('%s (%s) created an account with your invitation.', v_name, new.email),
           jsonb_build_object('email', new.email, 'invite', v_inv.code)
    from profiles p where p.role = 'admin' and p.is_active;
  end if;
  return new;
end $$;

-- 4) Friendlier wording for the permission guard
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.can_manage_products is distinct from old.can_manage_products
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Only the store owner can change roles or permissions';
    end if;
  end if;

  if old.role = 'admin' and (new.role <> 'admin' or not new.is_active) and not exists (
       select 1 from profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'There must be at least one active store owner';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
