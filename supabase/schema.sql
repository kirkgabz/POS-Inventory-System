-- =====================================================================
--  Jen Store — POS & Inventory schema
--  Run this whole file once in Supabase → SQL Editor (new project).
--  Safe defaults: Row Level Security on every table.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'staff');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null default '',
  email               text,
  role                public.user_role not null default 'staff',
  can_manage_products boolean not null default false,  -- "authorized" staff
  is_active           boolean not null default false,  -- staff need admin approval
  created_at          timestamptz not null default now()
);

-- One-row settings table (admin invite key for admin sign-ups)
create table if not exists public.app_settings (
  id                 int primary key default 1 check (id = 1),
  admin_signup_code  text,
  updated_at         timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;

create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) > 0),
  description         text,
  category            text,
  barcode             text unique,          -- manufacturer barcode OR generated EAN-13 (prefix 2 = in-store)
  word_code           text unique,          -- human-readable code, e.g. JEN-MANG-7K2Q
  is_custom           boolean not null default false,  -- store-owned / no original barcode
  price               numeric(12,2) not null check (price >= 0),
  cost                numeric(12,2) not null default 0 check (cost >= 0),
  stock               integer not null default 0,
  low_stock_threshold integer not null default 5,
  unit                text not null default 'pc',
  is_active           boolean not null default true,
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists products_name_idx on public.products (lower(name));

create sequence if not exists public.receipt_seq;

create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  receipt_no     text unique not null,
  cashier_id     uuid references public.profiles(id) on delete set null,
  subtotal       numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  amount_paid    numeric(12,2) not null default 0,
  change_due     numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  created_at     timestamptz not null default now()
);
create index if not exists sales_created_idx on public.sales (created_at desc);

create table if not exists public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  unit_price  numeric(12,2) not null,
  quantity    integer not null check (quantity > 0),
  line_total  numeric(12,2) not null
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  change      integer not null,
  reason      text not null check (reason in ('sale','restock','adjustment','initial')),
  note        text,
  ref_id      uuid,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text,
  type          text not null,   -- product_added | price_updated | product_updated | stock_adjusted | staff_signup
  title         text not null,
  message       text not null,
  product_id    uuid references public.products(id) on delete set null,
  data          jsonb not null default '{}'::jsonb,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------
--  Helper functions (SECURITY DEFINER so they can be used inside RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.can_manage_products() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and (role = 'admin' or can_manage_products)
  );
$$;

-- ---------------------------------------------------------------------
--  New user → profile.  First user ever = admin.
--  Later admins need the admin invite key set in app_settings.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_is_first  boolean;
  v_code      text;
  v_role      public.user_role := 'staff';
  v_name      text := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));
begin
  select not exists (select 1 from profiles) into v_is_first;
  select admin_signup_code into v_code from app_settings where id = 1;

  if v_is_first then
    v_role := 'admin';
  elsif new.raw_user_meta_data->>'requested_role' = 'admin'
        and v_code is not null and length(v_code) > 0
        and new.raw_user_meta_data->>'admin_code' = v_code then
    v_role := 'admin';
  end if;

  insert into profiles (id, full_name, email, role, is_active, can_manage_products)
  values (new.id, v_name, new.email, v_role, v_role = 'admin', v_role = 'admin');

  -- Tell admins a staff member is waiting for approval
  if v_role = 'staff' then
    insert into notifications (recipient_id, actor_id, actor_name, type, title, message, data)
    select p.id, new.id, v_name, 'staff_signup', 'New staff sign-up',
           format('%s (%s) signed up and is waiting for approval.', v_name, new.email),
           jsonb_build_object('email', new.email)
    from profiles p where p.role = 'admin' and p.is_active;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
--  Guard: only admins can change role / permission / active flags,
--  and there must always be at least one active admin.
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- SQL editor / service role

  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.can_manage_products is distinct from old.can_manage_products
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change roles or permissions';
    end if;
  end if;

  if old.role = 'admin' and (new.role <> 'admin' or not new.is_active) and not exists (
       select 1 from profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'There must be at least one active admin';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
--  Products: stamp created_by / updated_by / updated_at
-- ---------------------------------------------------------------------
create or replace function public.stamp_product() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stamp_product on public.products;
create trigger stamp_product
  before insert or update on public.products
  for each row execute function public.stamp_product();

-- ---------------------------------------------------------------------
--  Products: notify every admin when a STAFF member adds / edits
-- ---------------------------------------------------------------------
create or replace function public.notify_admins_product_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor  profiles%rowtype;
  v_type   text;
  v_title  text;
  v_msg    text;
  v_data   jsonb;
begin
  -- sales decrement stock: never notify for those
  if coalesce(current_setting('app.in_sale', true), '') = '1' then return new; end if;

  select * into v_actor from profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role = 'admin' then return new; end if;

  if tg_op = 'INSERT' then
    v_type  := 'product_added';
    v_title := 'New product added';
    v_msg   := format('%s added "%s"', v_actor.full_name, new.name);
    v_data  := jsonb_build_object('price', new.price, 'stock', new.stock,
                                  'word_code', new.word_code, 'barcode', new.barcode,
                                  'is_custom', new.is_custom);
  elsif new.price is distinct from old.price then
    v_type  := 'price_updated';
    v_title := 'Price updated';
    v_msg   := format('%s changed the price of "%s"', v_actor.full_name, new.name);
    v_data  := jsonb_build_object('old_price', old.price, 'new_price', new.price);
  elsif new.stock is distinct from old.stock then
    v_type  := 'stock_adjusted';
    v_title := 'Stock adjusted';
    v_msg   := format('%s adjusted stock of "%s"', v_actor.full_name, new.name);
    v_data  := jsonb_build_object('old_stock', old.stock, 'new_stock', new.stock);
  else
    v_type  := 'product_updated';
    v_title := 'Product details updated';
    v_msg   := format('%s edited "%s"', v_actor.full_name, new.name);
    v_data  := jsonb_build_object(
      'old_name', old.name, 'new_name', new.name,
      'old_category', old.category, 'new_category', new.category);
  end if;

  insert into notifications (recipient_id, actor_id, actor_name, type, title, message, product_id, data)
  select p.id, v_actor.id, v_actor.full_name, v_type, v_title, v_msg, new.id, v_data
  from profiles p where p.role = 'admin' and p.is_active;

  return new;
end $$;

drop trigger if exists notify_admins_product_change on public.products;
create trigger notify_admins_product_change
  after insert or update on public.products
  for each row execute function public.notify_admins_product_change();

-- ---------------------------------------------------------------------
--  RPC: process a sale atomically (prices come from DB, not the client)
--  p_items = [{ "product_id": "...", "quantity": 2 }, ...]
-- ---------------------------------------------------------------------
create or replace function public.process_sale(
  p_items          jsonb,
  p_amount_paid    numeric,
  p_payment_method text default 'cash',
  p_discount       numeric default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id  uuid;
  v_receipt  text;
  v_item     jsonb;
  v_prod     products%rowtype;
  v_qty      int;
  v_subtotal numeric := 0;
  v_discount numeric;
  v_total    numeric;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;

  perform set_config('app.in_sale', '1', true);

  v_receipt := 'R' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('receipt_seq')::text, 5, '0');
  insert into sales (receipt_no, cashier_id, payment_method)
  values (v_receipt, auth.uid(), coalesce(p_payment_method, 'cash'))
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;

    select * into v_prod from products
    where id = (v_item->>'product_id')::uuid and is_active
    for update;
    if not found then raise exception 'A product in the cart no longer exists'; end if;
    if v_prod.stock < v_qty then
      raise exception 'Not enough stock for "%" (only % left)', v_prod.name, v_prod.stock;
    end if;

    update products set stock = stock - v_qty where id = v_prod.id;

    insert into sale_items (sale_id, product_id, name, unit_price, quantity, line_total)
    values (v_sale_id, v_prod.id, v_prod.name, v_prod.price, v_qty, v_prod.price * v_qty);

    insert into stock_movements (product_id, change, reason, ref_id, created_by)
    values (v_prod.id, -v_qty, 'sale', v_sale_id, auth.uid());

    v_subtotal := v_subtotal + v_prod.price * v_qty;
  end loop;

  v_discount := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);
  v_total    := v_subtotal - v_discount;
  if coalesce(p_amount_paid, 0) < v_total then
    raise exception 'Amount paid is less than the total';
  end if;

  update sales set subtotal = v_subtotal, discount = v_discount, total = v_total,
                   amount_paid = p_amount_paid, change_due = p_amount_paid - v_total
  where id = v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'receipt_no', v_receipt, 'subtotal', v_subtotal,
    'discount', v_discount, 'total', v_total, 'amount_paid', p_amount_paid,
    'change', p_amount_paid - v_total);
end $$;

-- ---------------------------------------------------------------------
--  RPC: stock adjustment (restock / correction) by authorized users
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_change     int,
  p_reason     text default 'restock',
  p_note       text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_new int;
begin
  if not public.can_manage_products() then raise exception 'Not authorized to adjust stock'; end if;
  if p_change = 0 then raise exception 'Change cannot be zero'; end if;
  if p_reason not in ('restock', 'adjustment', 'initial') then raise exception 'Invalid reason'; end if;

  update products set stock = stock + p_change where id = p_product_id
  returning stock into v_new;
  if not found then raise exception 'Product not found'; end if;
  if v_new < 0 then raise exception 'Stock cannot go below zero'; end if;

  insert into stock_movements (product_id, change, reason, note, created_by)
  values (p_product_id, p_change, p_reason, p_note, auth.uid());
  return v_new;
end $$;

-- ---------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.app_settings    enable row level security;
alter table public.products        enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.stock_movements enable row level security;
alter table public.notifications   enable row level security;

-- profiles
drop policy if exists "profiles: read self or active users" on public.profiles;
create policy "profiles: read self or active users" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_active_user());

drop policy if exists "profiles: update self or admin" on public.profiles;
create policy "profiles: update self or admin" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- app_settings (admin only)
drop policy if exists "settings: admin read" on public.app_settings;
create policy "settings: admin read" on public.app_settings
  for select to authenticated using (public.is_admin());
drop policy if exists "settings: admin update" on public.app_settings;
create policy "settings: admin update" on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- products
drop policy if exists "products: active users read" on public.products;
create policy "products: active users read" on public.products
  for select to authenticated using (public.is_active_user());

drop policy if exists "products: authorized insert" on public.products;
create policy "products: authorized insert" on public.products
  for insert to authenticated with check (public.can_manage_products());

drop policy if exists "products: authorized update" on public.products;
create policy "products: authorized update" on public.products
  for update to authenticated
  using (public.can_manage_products()) with check (public.can_manage_products());

drop policy if exists "products: admin delete" on public.products;
create policy "products: admin delete" on public.products
  for delete to authenticated using (public.is_admin());

-- sales: admins see all, staff see their own (inserts happen only via process_sale)
drop policy if exists "sales: read" on public.sales;
create policy "sales: read" on public.sales
  for select to authenticated
  using (public.is_admin() or (cashier_id = auth.uid() and public.is_active_user()));

drop policy if exists "sale_items: read" on public.sale_items;
create policy "sale_items: read" on public.sale_items
  for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id
                 and (public.is_admin() or (s.cashier_id = auth.uid() and public.is_active_user()))));

-- stock movements: readable by authorized users (writes only via RPCs)
drop policy if exists "stock_movements: read" on public.stock_movements;
create policy "stock_movements: read" on public.stock_movements
  for select to authenticated using (public.can_manage_products());

-- notifications: only your own
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications
  for select to authenticated using (recipient_id = auth.uid());
drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own" on public.notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: delete own" on public.notifications
  for delete to authenticated using (recipient_id = auth.uid());

-- ---------------------------------------------------------------------
--  Grants for RPCs
-- ---------------------------------------------------------------------
revoke all on function public.process_sale(jsonb, numeric, text, numeric) from public, anon;
grant execute on function public.process_sale(jsonb, numeric, text, numeric) to authenticated;
revoke all on function public.adjust_stock(uuid, int, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------
--  Realtime (admin pop-up cards + live product list)
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
