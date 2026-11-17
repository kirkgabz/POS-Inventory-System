-- =====================================================================
--  005 — Google sign-up for store owners (with 6-digit email code)
--
--  • A brand-new Google user gets a placeholder profile (setup_pending).
--  • If they came to create a STORE OWNER account, the app asks for a
--    6-digit code sent to their email, then calls complete_owner_setup().
--  • If they only tried to SIGN IN with Google but have no account,
--    the app calls discard_my_account() to remove the stray user.
--  • Existing users who sign in with Google (same email) are linked
--    automatically by Supabase and never reach this trigger.
--  Run once in Supabase → SQL Editor.
-- =====================================================================

alter table public.profiles add column if not exists setup_pending boolean not null default false;

-- 1) Sign-up trigger: OAuth users without an account → placeholder profile
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
  -- Google (or any OAuth) sign-up: wait for the app to finish setup
  if coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'email' then
    insert into profiles (id, full_name, email, role, is_active, can_manage_products, setup_pending)
    values (new.id, v_name, new.email, 'staff', false, false, true);
    return new;
  end if;

  select not exists (select 1 from profiles where not setup_pending) into v_is_first;
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

-- 2) Role guard: allow the owner-setup function to promote the caller
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('app.owner_setup', true), '') = '1' then return new; end if;

  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.can_manage_products is distinct from old.can_manage_products
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email
       or new.setup_pending is distinct from old.setup_pending then
      raise exception 'Only the store owner can change roles or permissions';
    end if;
  end if;

  if old.role = 'admin' and (new.role <> 'admin' or not new.is_active) and not exists (
       select 1 from profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'There must be at least one active store owner';
  end if;
  return new;
end $$;

-- 3) Does a new owner need the owner key? (false only for a brand-new store)
create or replace function public.owner_setup_needs_key() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where role = 'admin' and is_active);
$$;

-- 4) Finish a Google store-owner sign-up.
--    Requires: placeholder profile, a 6-digit email code verified in the last
--    15 minutes (JWT "amr" claim), and the owner key unless this is the first owner.
create or replace function public.complete_owner_setup(p_owner_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me   profiles%rowtype;
  v_key  text;
  v_otp  boolean;
begin
  select * into v_me from profiles where id = auth.uid();
  if not found or not v_me.setup_pending then
    raise exception 'TB_SETUP_NONE: There is no pending store owner setup for this account.';
  end if;

  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) m
    where m->>'method' in ('otp', 'magiclink')
      and (m->>'timestamp')::bigint > extract(epoch from now() - interval '15 minutes')
  ) into v_otp;
  if not v_otp then
    raise exception 'TB_OTP_REQUIRED: Verify the 6-digit code sent to your email first.';
  end if;

  if public.owner_setup_needs_key() then
    select admin_signup_code into v_key from app_settings where id = 1;
    if v_key is null or length(v_key) = 0 or p_owner_key is distinct from v_key then
      raise exception 'TB_OWNER_KEY_INVALID: The store owner key is not valid.';
    end if;
  end if;

  perform set_config('app.owner_setup', '1', true);
  update profiles
     set role = 'admin', is_active = true, can_manage_products = true, setup_pending = false
   where id = v_me.id;

  return jsonb_build_object('ok', true);
end $$;

-- 5) Remove a stray Google user that has no TapBenta account
create or replace function public.discard_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if exists (select 1 from public.profiles where id = auth.uid() and setup_pending) then
    delete from auth.users where id = auth.uid();
  end if;
end $$;

revoke all on function public.owner_setup_needs_key() from public, anon;
grant execute on function public.owner_setup_needs_key() to authenticated;
revoke all on function public.complete_owner_setup(text) from public, anon;
grant execute on function public.complete_owner_setup(text) to authenticated;
revoke all on function public.discard_my_account() from public, anon;
grant execute on function public.discard_my_account() to authenticated;

notify pgrst, 'reload schema';
