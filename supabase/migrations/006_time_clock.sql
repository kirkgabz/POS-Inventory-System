-- =====================================================================
--  006 — DTR time clock (time in / time out) + live face verification
--
--  • Times are stamped by the SERVER (now()), never by the device.
--  • Face match is decided here in the database: the browser only sends a
--    128-number face descriptor; stored descriptors are never readable.
--  • A person can enrol their face once; only the store owner can reset it.
--  • Store owner chooses whether face verification is required.
--  Run once in Supabase → SQL Editor.
-- =====================================================================

-- 1) Settings
alter table public.app_settings add column if not exists dtr_face_required boolean not null default false;
alter table public.app_settings add column if not exists dtr_face_threshold numeric not null default 0.5
  check (dtr_face_threshold between 0.3 and 0.7);
alter table public.app_settings add column if not exists timezone text not null default 'Asia/Manila';

-- 2) Face profiles (biometric data — no read policy at all)
create table if not exists public.face_profiles (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  descriptor  float8[] not null check (array_length(descriptor, 1) = 128),
  enrolled_at timestamptz not null default now()
);
alter table public.face_profiles enable row level security;
-- (intentionally no policies: only the SECURITY DEFINER functions below touch it)

-- 3) Attendance
create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  work_date    date not null,
  time_in      timestamptz not null default now(),
  time_out     timestamptz,
  method_in    text not null check (method_in in ('manual', 'face')),
  method_out   text check (method_out in ('manual', 'face', 'owner')),
  distance_in  numeric,
  distance_out numeric,
  note         text,
  edited_by    uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (time_out is null or time_out >= time_in)
);
create unique index if not exists attendance_one_open_shift on public.attendance (user_id) where time_out is null;
create index if not exists attendance_date_idx on public.attendance (work_date desc);

alter table public.attendance enable row level security;
drop policy if exists "attendance: read own or owner" on public.attendance;
create policy "attendance: read own or owner" on public.attendance
  for select to authenticated
  using ((user_id = auth.uid() and public.is_active_user()) or public.is_admin());
drop policy if exists "attendance: owner corrections" on public.attendance;
create policy "attendance: owner corrections" on public.attendance
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "attendance: owner delete" on public.attendance;
create policy "attendance: owner delete" on public.attendance
  for delete to authenticated using (public.is_admin());
-- inserts only through clock_in()

do $$ begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object then null; end $$;

-- 4) Helpers
create or replace function public.face_distance(a float8[], b float8[]) returns float8
language sql immutable as $$
  select sqrt(sum((x - y) ^ 2)) from unnest(a, b) as t(x, y);
$$;

create or replace function public.dtr_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s app_settings%rowtype; v_open attendance%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  select * into v_s from app_settings where id = 1;
  select * into v_open from attendance where user_id = auth.uid() and time_out is null;
  return jsonb_build_object(
    'face_required', v_s.dtr_face_required,
    'threshold', v_s.dtr_face_threshold,
    'timezone', v_s.timezone,
    'enrolled', exists (select 1 from face_profiles where user_id = auth.uid()),
    'server_now', now(),
    'open', case when v_open.id is null then null else to_jsonb(v_open) end
  );
end $$;

create or replace function public.enroll_face(p_descriptor float8[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  if array_length(p_descriptor, 1) is distinct from 128 then raise exception 'TB_FACE_BAD: Invalid face data.'; end if;
  if exists (select 1 from face_profiles where user_id = auth.uid()) then
    raise exception 'TB_FACE_EXISTS: Your face is already enrolled. Ask the store owner to reset it.';
  end if;
  insert into face_profiles (user_id, descriptor) values (auth.uid(), p_descriptor);
end $$;

create or replace function public.reset_face(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the store owner can reset face enrolment'; end if;
  delete from face_profiles where user_id = p_user;
end $$;

create or replace function public.face_enrollments() returns table (user_id uuid, enrolled_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  return query select f.user_id, f.enrolled_at from face_profiles f;
end $$;

-- verify (if a descriptor is given) → returns method + distance, raises on mismatch
create or replace function public._dtr_verify(p_descriptor float8[], out o_method text, out o_distance float8)
language plpgsql security definer set search_path = public as $$
declare v_s app_settings%rowtype; v_ref float8[];
begin
  select * into v_s from app_settings where id = 1;
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
  elsif v_s.dtr_face_required then
    raise exception 'TB_FACE_REQUIRED: The store owner requires face verification to clock in or out.';
  end if;
end $$;

-- 5) Clock in / out
create or replace function public.clock_in(p_descriptor float8[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_method text; v_dist float8; v_row attendance%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  if exists (select 1 from attendance where user_id = auth.uid() and time_out is null) then
    raise exception 'TB_ALREADY_IN: You are already timed in.';
  end if;
  select o_method, o_distance into v_method, v_dist from public._dtr_verify(p_descriptor);
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
  select o_method, o_distance into v_method, v_dist from public._dtr_verify(p_descriptor);
  update attendance set time_out = now(), method_out = v_method, distance_out = v_dist
   where id = v_row.id returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- 6) Permissions
revoke all on function public._dtr_verify(float8[]) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['dtr_status()', 'enroll_face(float8[])', 'reset_face(uuid)', 'face_enrollments()',
                           'clock_in(float8[])', 'clock_out(float8[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
