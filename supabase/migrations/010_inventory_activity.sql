-- 010 · Inventory activity log + who took each order
--  • product_activity: every product added, edited, price/cost change, stock in/out
--    and deletion, with WHO did it (name + role snapshot) and WHEN.
--    Written only by triggers, readable only by the store owner.
--  • sales.cashier_name / cashier_role: the name of whoever took the order is
--    stored on the sale itself, so it stays even if the account is renamed or removed.

-- ---------------------------------------------------------------------
-- 1) Activity table
-- ---------------------------------------------------------------------
create table if not exists public.product_activity (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text not null default 'System',
  actor_role    text,                                   -- 'admin' | 'staff'
  action        text not null check (action in ('added','price','edited','restock','stock_in','stock_out','deleted')),
  stock_change  int,
  changes       jsonb not null default '{}'::jsonb,     -- { field: [old, new] } or starting values
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists product_activity_created_idx on public.product_activity (created_at desc);
create index if not exists product_activity_actor_idx   on public.product_activity (actor_id, created_at desc);

alter table public.product_activity enable row level security;
drop policy if exists "product_activity: owner reads" on public.product_activity;
create policy "product_activity: owner reads" on public.product_activity
  for select using (public.is_admin());
-- no insert/update/delete policies: rows come only from the triggers below

-- helper: current actor (name + role), 'System' when run outside the app
create or replace function public._activity_actor(out a_id uuid, out a_name text, out a_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  select p.id, p.full_name, p.role::text into a_id, a_name, a_role from profiles p where p.id = auth.uid();
  a_name := coalesce(a_name, case when a_id is null then 'System' else 'Unknown' end);
end $$;

-- ---------------------------------------------------------------------
-- 2) Products: added / edited / price change / deleted
-- ---------------------------------------------------------------------
create or replace function public.log_product_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_name text; v_role text;
  v_changes jsonb := '{}'::jsonb;
  v_action text;
begin
  -- stock taken by sales is shown in Sales, not here
  if coalesce(current_setting('app.in_sale', true), '') = '1' then return coalesce(new, old); end if;
  select a_id, a_name, a_role into v_id, v_name, v_role from _activity_actor();

  if tg_op = 'INSERT' then
    insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, stock_change, changes)
    values (new.id, new.name, v_id, v_name, v_role, 'added', nullif(new.stock, 0),
            jsonb_build_object('price', new.price, 'cost', new.cost, 'stock', new.stock, 'unit', new.unit,
                               'pack_size', new.pack_size, 'category', new.category));
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, changes)
    values (null, old.name, v_id, v_name, v_role, 'deleted',
            jsonb_build_object('price', old.price, 'stock', old.stock));
    return old;
  end if;

  -- UPDATE: collect the fields that really changed (stock is logged via stock_movements)
  if new.name                is distinct from old.name                then v_changes := v_changes || jsonb_build_object('name',      jsonb_build_array(old.name, new.name)); end if;
  if new.price               is distinct from old.price               then v_changes := v_changes || jsonb_build_object('price',     jsonb_build_array(old.price, new.price)); end if;
  if new.cost                is distinct from old.cost                then v_changes := v_changes || jsonb_build_object('cost',      jsonb_build_array(old.cost, new.cost)); end if;
  if new.category            is distinct from old.category            then v_changes := v_changes || jsonb_build_object('category',  jsonb_build_array(old.category, new.category)); end if;
  if new.unit                is distinct from old.unit                then v_changes := v_changes || jsonb_build_object('unit',      jsonb_build_array(old.unit, new.unit)); end if;
  if new.pack_size           is distinct from old.pack_size           then v_changes := v_changes || jsonb_build_object('pack_size', jsonb_build_array(old.pack_size, new.pack_size)); end if;
  if new.barcode             is distinct from old.barcode             then v_changes := v_changes || jsonb_build_object('barcode',   jsonb_build_array(old.barcode, new.barcode)); end if;
  if new.word_code           is distinct from old.word_code           then v_changes := v_changes || jsonb_build_object('word_code', jsonb_build_array(old.word_code, new.word_code)); end if;
  if new.low_stock_threshold is distinct from old.low_stock_threshold then v_changes := v_changes || jsonb_build_object('low_stock', jsonb_build_array(old.low_stock_threshold, new.low_stock_threshold)); end if;
  if new.is_active           is distinct from old.is_active           then v_changes := v_changes || jsonb_build_object('active',    jsonb_build_array(old.is_active, new.is_active)); end if;
  if new.image_url           is distinct from old.image_url           then v_changes := v_changes || jsonb_build_object('photo',     jsonb_build_array(old.image_url is not null, new.image_url is not null)); end if;
  if new.description         is distinct from old.description         then v_changes := v_changes || jsonb_build_object('notes',     jsonb_build_array(old.description, new.description)); end if;

  if v_changes = '{}'::jsonb then return new; end if;
  v_action := case when v_changes ? 'price' then 'price' else 'edited' end;

  insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, changes)
  values (new.id, new.name, v_id, v_name, v_role, v_action, v_changes);
  return new;
end $$;

drop trigger if exists log_product_activity on public.products;
create trigger log_product_activity
  after insert or update on public.products
  for each row execute function public.log_product_activity();

drop trigger if exists log_product_delete on public.products;
create trigger log_product_delete
  before delete on public.products
  for each row execute function public.log_product_activity();

-- ---------------------------------------------------------------------
-- 3) Stock movements (restock, corrections, removals — not sales)
-- ---------------------------------------------------------------------
create or replace function public.log_stock_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_role text; v_pname text;
begin
  if new.reason = 'sale' then return new; end if;
  select name into v_pname from products where id = new.product_id;
  select p.id, coalesce(p.full_name, 'Unknown'), p.role::text into v_id, v_name, v_role
  from profiles p where p.id = coalesce(new.created_by, auth.uid());

  insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, stock_change, note, created_at)
  values (new.product_id, coalesce(v_pname, 'Product'), v_id, coalesce(v_name, 'System'), v_role,
          case when new.change < 0 then 'stock_out' when new.reason = 'restock' then 'restock' else 'stock_in' end,
          new.change, new.note, new.created_at);
  return new;
end $$;

drop trigger if exists log_stock_activity on public.stock_movements;
create trigger log_stock_activity
  after insert on public.stock_movements
  for each row execute function public.log_stock_activity();

-- ---------------------------------------------------------------------
-- 4) Backfill history that already exists (runs once)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from product_activity) then return; end if;

  -- products added
  insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, changes, created_at)
  select pr.id, pr.name, pf.id, coalesce(pf.full_name, 'Unknown'), pf.role::text, 'added',
         jsonb_build_object('price', pr.price, 'cost', pr.cost, 'unit', pr.unit, 'category', pr.category),
         pr.created_at
  from products pr left join profiles pf on pf.id = pr.created_by;

  -- restocks / corrections
  insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, stock_change, note, created_at)
  select sm.product_id, coalesce(pr.name, 'Product'), pf.id, coalesce(pf.full_name, 'Unknown'), pf.role::text,
         case when sm.change < 0 then 'stock_out' when sm.reason = 'restock' then 'restock' else 'stock_in' end,
         sm.change, sm.note, sm.created_at
  from stock_movements sm
  left join products pr on pr.id = sm.product_id
  left join profiles pf on pf.id = sm.created_by
  where sm.reason <> 'sale';

  -- earlier staff price changes / edits (from owner notifications, one per event)
  insert into product_activity (product_id, product_name, actor_id, actor_name, actor_role, action, changes, created_at)
  select distinct on (n.actor_id, n.product_id, n.type, date_trunc('second', n.created_at))
         n.product_id, coalesce(pr.name, 'Product'), n.actor_id, coalesce(n.actor_name, 'Unknown'), 'staff',
         case n.type when 'price_updated' then 'price' else 'edited' end,
         case n.type
           when 'price_updated' then jsonb_build_object('price', jsonb_build_array(n.data->'old_price', n.data->'new_price'))
           else jsonb_build_object('name', jsonb_build_array(n.data->'old_name', n.data->'new_name'))
         end,
         n.created_at
  from notifications n
  left join products pr on pr.id = n.product_id
  where n.type in ('price_updated', 'product_updated');
end $$;

-- ---------------------------------------------------------------------
-- 5) Sales remember who took the order
-- ---------------------------------------------------------------------
alter table public.sales add column if not exists cashier_name text;
alter table public.sales add column if not exists cashier_role text;

update public.sales s
set cashier_name = p.full_name, cashier_role = p.role::text
from public.profiles p
where p.id = s.cashier_id and s.cashier_name is null;

create or replace function public.stamp_sale_cashier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.cashier_id := coalesce(new.cashier_id, auth.uid());
  select full_name, role::text into new.cashier_name, new.cashier_role
  from profiles where id = new.cashier_id;
  return new;
end $$;

drop trigger if exists stamp_sale_cashier on public.sales;
create trigger stamp_sale_cashier
  before insert on public.sales
  for each row execute function public.stamp_sale_cashier();

-- ---------------------------------------------------------------------
-- 6) Live updates for the owner's log
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.product_activity;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
