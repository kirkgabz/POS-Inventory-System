-- =====================================================================
--  008 — time clock is for staff only; owner sets face requirement
--        separately for TIME IN and TIME OUT.
--  Run once in Supabase → SQL Editor (after 006).
-- =====================================================================

alter table public.app_settings add column if not exists dtr_face_in  boolean not null default false;
alter table public.app_settings add column if not exists dtr_face_out boolean not null default false;
update public.app_settings set dtr_face_in = dtr_face_required, dtr_face_out = dtr_face_required where id = 1;

-- verification now knows whether it is a time in or a time out
drop function if exists public._dtr_verify(float8[]);
create or replace function public._dtr_verify(p_descriptor float8[], p_kind text, out o_method text, out o_distance float8)
language plpgsql security definer set search_path = public as $$
declare v_s app_settings%rowtype; v_ref float8[]; v_required boolean;
begin
  select * into v_s from app_settings where id = 1;
  v_required := case when p_kind = 'in' then v_s.dtr_face_in else v_s.dtr_face_out end;
  o_method := 'manual'; o_distance := null;
  if p_descriptor is not null then
    if array_length(p_descriptor, 1) is distinct from 128 then raise exception 'TB_FACE_BAD: Invalid face data.'; end if;
    select descriptor into v_ref from face_profiles where user_id = auth.uid();
    if v_ref is null then raise exception 'TB_FACE_NOT_ENROLLED: Set up your face first.'; end if;
    o_distance := public.face_distance(v_ref, p_descriptor);
    if o_distance > v_s.dtr_face_threshold then
      raise exception 'TB_FACE_MISMATCH: Face did not match (%). Try again in good light.', round(o_distance::numeric, 2);
    end if;
    o_method := 'face';
  elsif v_required then
    raise exception 'TB_FACE_REQUIRED: The store owner requires face verification to time %.', p_kind;
  end if;
end $$;
revoke all on function public._dtr_verify(float8[], text) from public, anon, authenticated;

create or replace function public.clock_in(p_descriptor float8[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_method text; v_dist float8; v_row attendance%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  if public.is_admin() then raise exception 'TB_OWNER_NO_DTR: Store owners don''t use the time clock — it is for staff.'; end if;
  if exists (select 1 from attendance where user_id = auth.uid() and time_out is null) then
    raise exception 'TB_ALREADY_IN: You are already timed in.';
  end if;
  select o_method, o_distance into v_method, v_dist from public._dtr_verify(p_descriptor, 'in');
  select timezone into v_tz from app_settings where id = 1;
  insert into attendance (user_id, work_date, time_in, method_in, distance_in)
  values (auth.uid(), (now() at time zone coalesce(v_tz, 'Asia/Manila'))::date, now(), v_method, v_dist)
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.clock_out(p_descriptor float8[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_method text; v_dist float8; v_row attendance%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  select * into v_row from attendance where user_id = auth.uid() and time_out is null for update;
  if not found then raise exception 'TB_NOT_IN: You are not timed in.'; end if;
  select o_method, o_distance into v_method, v_dist from public._dtr_verify(p_descriptor, 'out');
  update attendance set time_out = now(), method_out = v_method, distance_out = v_dist
   where id = v_row.id returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.dtr_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s app_settings%rowtype; v_open attendance%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  select * into v_s from app_settings where id = 1;
  select * into v_open from attendance where user_id = auth.uid() and time_out is null;
  return jsonb_build_object(
    'face_in', v_s.dtr_face_in,
    'face_out', v_s.dtr_face_out,
    'face_required', v_s.dtr_face_in or v_s.dtr_face_out,
    'threshold', v_s.dtr_face_threshold,
    'timezone', v_s.timezone,
    'enrolled', exists (select 1 from face_profiles where user_id = auth.uid()),
    'server_now', now(),
    'open', case when v_open.id is null then null else to_jsonb(v_open) end
  );
end $$;

notify pgrst, 'reload schema';
