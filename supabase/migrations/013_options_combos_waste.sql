-- 013 · Add-ons & options, combo meals, spoilage / waste
--  • menu_options: per menu item, e.g. "Extra patty" (+₱30, +1 patty) or
--    "No veggies" (₱0, −15 g lettuce, −2 slices tomato).
--  • products.kind 'combo' + combo_items: e.g. Burger Meal = Burger + Fries + Coke.
--  • stock_movements reason 'waste' for spoiled / damaged stock (and the log shows it).

-- ---------------------------------------------------------------------
-- 1) Kinds & reasons
-- ---------------------------------------------------------------------
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check
  check (kind in ('item', 'menu', 'ingredient', 'combo'));

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'restock', 'adjustment', 'initial', 'waste'));

alter table public.product_activity drop constraint if exists product_activity_action_check;
alter table public.product_activity add constraint product_activity_action_check
  check (action in ('added','price','edited','restock','stock_in','stock_out','waste','deleted'));

-- what was chosen on each line (shown on receipts / reports)
alter table public.sale_items add column if not exists options jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- 2) Add-ons & options
-- ---------------------------------------------------------------------
create table if not exists public.menu_options (
  id           uuid primary key default gen_random_uuid(),
  menu_id      uuid not null references public.products(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  price_delta  numeric(12,2) not null default 0,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists menu_options_menu_idx on public.menu_options (menu_id, sort);

create table if not exists public.menu_option_items (
  option_id      uuid not null references public.menu_options(id) on delete cascade,
  ingredient_id  uuid not null references public.products(id) on delete restrict,
  qty            int not null check (qty <> 0),   -- + uses more, − leaves out
  primary key (option_id, ingredient_id)
);

create table if not exists public.combo_items (
  combo_id      uuid not null references public.products(id) on delete cascade,
  component_id  uuid not null references public.products(id) on delete restrict,
  qty           int not null default 1 check (qty > 0),
  primary key (combo_id, component_id),
  check (combo_id <> component_id)
);

alter table public.menu_options      enable row level security;
alter table public.menu_option_items enable row level security;
alter table public.combo_items       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['menu_options', 'menu_option_items', 'combo_items'] loop
    execute format('drop policy if exists "%1$s: read" on public.%1$I', t);
    execute format('create policy "%1$s: read" on public.%1$I for select using (public.is_active_user())', t);
    execute format('drop policy if exists "%1$s: manage" on public.%1$I', t);
    execute format('create policy "%1$s: manage" on public.%1$I for all using (public.can_manage_products()) with check (public.can_manage_products())', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Spoilage: adjust_stock accepts 'waste'
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
  if p_reason not in ('restock', 'adjustment', 'initial', 'waste') then raise exception 'Invalid reason'; end if;
  if p_reason = 'waste' and p_change > 0 then raise exception 'Waste can only remove stock'; end if;

  update products set stock = stock + p_change where id = p_product_id
  returning stock into v_new;
  if not found then raise exception 'Product not found'; end if;
  -- removing more than is on record is blocked (except waste of ingredients already below zero)
  if v_new < 0 and p_change < 0 and p_reason <> 'waste' then raise exception 'Stock cannot go below zero'; end if;

  insert into stock_movements (product_id, change, reason, note, created_by)
  values (p_product_id, p_change, p_reason, p_note, auth.uid());
  return v_new;
end $$;

-- inventory log: waste gets its own action
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
          case when new.reason = 'waste' then 'waste'
               when new.change < 0 then 'stock_out'
               when new.reason = 'restock' then 'restock' else 'stock_in' end,
          new.change, new.note, new.created_at);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4) Consume one menu item (recipe ± chosen options). Never blocks.
--    Returns { cost: per-serving cost, short: [...] }
-- ---------------------------------------------------------------------
create or replace function public._consume_menu(
  p_menu     uuid,
  p_options  uuid[],
  p_servings int,
  p_sale     uuid,
  p_label    text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ing   record;
  v_need  int;
  v_cost  numeric := 0;
  v_short jsonb := '[]'::jsonb;
begin
  -- lock the ingredients involved, always in the same order
  perform 1 from products
  where id in (
    select ingredient_id from recipe_items where menu_id = p_menu
    union
    select oi.ingredient_id from menu_option_items oi join menu_options o on o.id = oi.option_id
    where o.menu_id = p_menu and o.id = any(coalesce(p_options, '{}'))
  )
  order by id for update;

  for v_ing in
    select i.id, i.name, i.unit, i.stock, i.cost, greatest(sum(x.q), 0)::int as per
    from (
      select ingredient_id, qty as q from recipe_items where menu_id = p_menu
      union all
      select oi.ingredient_id, oi.qty from menu_option_items oi join menu_options o on o.id = oi.option_id
      where o.menu_id = p_menu and o.id = any(coalesce(p_options, '{}'))
    ) x
    join products i on i.id = x.ingredient_id
    group by i.id, i.name, i.unit, i.stock, i.cost
    order by i.id
  loop
    continue when v_ing.per = 0;
    v_need := v_ing.per * p_servings;
    v_cost := v_cost + v_ing.per * v_ing.cost;
    if v_ing.stock < v_need then
      v_short := v_short || jsonb_build_object('menu', p_label, 'ingredient', v_ing.name, 'unit', v_ing.unit,
                                               'need', v_need, 'had', v_ing.stock);
    end if;
    update products set stock = stock - v_need where id = v_ing.id;
    insert into stock_movements (product_id, change, reason, note, ref_id, created_by)
    values (v_ing.id, -v_need, 'sale', format('%s × %s', p_servings, p_label), p_sale, auth.uid());
  end loop;

  return jsonb_build_object('cost', v_cost, 'short', v_short);
end $$;
revoke all on function public._consume_menu(uuid, uuid[], int, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) process_sale: items, menu items (+ options) and combos
--    p_items = [{ product_id, quantity, options: [option_id, …] }, …]
-- ---------------------------------------------------------------------
create or replace function public.process_sale(
  p_items           jsonb,
  p_amount_paid     numeric,
  p_payment_method  text default 'cash',
  p_discount        numeric default 0,
  p_payment_account text default null,
  p_payment_ref     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id  uuid;
  v_receipt  text;
  v_item     jsonb;
  v_prod     products%rowtype;
  v_comp     record;
  v_qty      int;
  v_opts     uuid[];
  v_optrows  jsonb;
  v_delta    numeric;
  v_unit     numeric;
  v_cost     numeric;
  v_name     text;
  v_res      jsonb;
  v_subtotal numeric := 0;
  v_discount numeric;
  v_total    numeric;
  v_short    jsonb := '[]'::jsonb;
  v_me       profiles%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not authorized'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  if coalesce(p_payment_method, 'cash') not in ('cash', 'ewallet', 'bank') then
    raise exception 'Invalid payment method';
  end if;

  perform set_config('app.in_sale', '1', true);

  v_receipt := 'R' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('receipt_seq')::text, 5, '0');
  insert into sales (receipt_no, cashier_id, payment_method, payment_account, payment_ref)
  values (v_receipt, auth.uid(), coalesce(p_payment_method, 'cash'),
          nullif(trim(p_payment_account), ''), nullif(trim(p_payment_ref), ''))
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;

    select * into v_prod from products
    where id = (v_item->>'product_id')::uuid and is_active
    for update;
    if not found then raise exception 'A product in the order no longer exists'; end if;
    if v_prod.kind = 'ingredient' then
      raise exception '"%" is an ingredient and can''t be sold at the register', v_prod.name;
    end if;

    v_opts := array(select jsonb_array_elements_text(coalesce(v_item->'options', '[]'::jsonb))::uuid);
    v_optrows := '[]'::jsonb;
    v_delta := 0;
    v_name := v_prod.name;

    if cardinality(v_opts) > 0 then
      if v_prod.kind <> 'menu' then raise exception 'Options are only for menu items'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price_delta) order by o.sort, o.name), '[]'::jsonb),
             coalesce(sum(o.price_delta), 0)
        into v_optrows, v_delta
      from menu_options o where o.menu_id = v_prod.id and o.id = any(v_opts);
      if jsonb_array_length(v_optrows) <> cardinality(v_opts) then
        raise exception 'An option for "%" was changed — remove it from the order and add it again', v_prod.name;
      end if;
      v_name := v_prod.name || ' (' || (select string_agg(x->>'name', ', ') from jsonb_array_elements(v_optrows) x) || ')';
    end if;

    v_unit := greatest(v_prod.price + v_delta, 0);

    if v_prod.kind = 'menu' then
      v_res := _consume_menu(v_prod.id, v_opts, v_qty, v_sale_id, v_name);
      v_cost := (v_res->>'cost')::numeric;
      v_short := v_short || (v_res->'short');

    elsif v_prod.kind = 'combo' then
      -- every part of the meal: menu items use their recipe, items their own stock (never blocks)
      v_cost := 0;
      for v_comp in
        select c.qty, p.id, p.name, p.kind, p.unit, p.cost
        from combo_items c join products p on p.id = c.component_id
        where c.combo_id = v_prod.id
        order by p.id
      loop
        if v_comp.kind = 'menu' then
          v_res := _consume_menu(v_comp.id, '{}', v_comp.qty * v_qty, v_sale_id, v_comp.name || ' in ' || v_prod.name);
          v_cost := v_cost + (v_res->>'cost')::numeric * v_comp.qty;
          v_short := v_short || (v_res->'short');
        elsif v_comp.kind in ('item', 'ingredient') then
          perform 1 from products where id = v_comp.id for update;
          if (select stock from products where id = v_comp.id) < v_comp.qty * v_qty then
            v_short := v_short || jsonb_build_object('menu', v_prod.name, 'ingredient', v_comp.name, 'unit', v_comp.unit,
                                                     'need', v_comp.qty * v_qty, 'had', (select stock from products where id = v_comp.id));
          end if;
          update products set stock = stock - v_comp.qty * v_qty where id = v_comp.id;
          insert into stock_movements (product_id, change, reason, note, ref_id, created_by)
          values (v_comp.id, -(v_comp.qty * v_qty), 'sale', format('%s × %s', v_qty, v_prod.name), v_sale_id, auth.uid());
          v_cost := v_cost + v_comp.cost * v_comp.qty;
        end if;
      end loop;

    else
      if v_prod.stock < v_qty then
        raise exception 'Not enough stock for "%" (only % left)', v_prod.name, v_prod.stock;
      end if;
      update products set stock = stock - v_qty where id = v_prod.id;
      insert into stock_movements (product_id, change, reason, ref_id, created_by)
      values (v_prod.id, -v_qty, 'sale', v_sale_id, auth.uid());
      v_cost := v_prod.cost;
    end if;

    insert into sale_items (sale_id, product_id, name, unit_price, unit_cost, quantity, line_total, options)
    values (v_sale_id, v_prod.id, v_name, v_unit, v_cost, v_qty, v_unit * v_qty, v_optrows);

    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;

  v_discount := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);
  v_total    := v_subtotal - v_discount;
  if coalesce(p_amount_paid, 0) < v_total then
    raise exception 'Amount paid is less than the total';
  end if;

  update sales set subtotal = v_subtotal, discount = v_discount, total = v_total,
                   amount_paid = p_amount_paid, change_due = p_amount_paid - v_total
  where id = v_sale_id;

  if jsonb_array_length(v_short) > 0 then
    select * into v_me from profiles where id = auth.uid();
    insert into notifications (recipient_id, actor_id, actor_name, type, title, message, data)
    select p.id, v_me.id, v_me.full_name, 'ingredient_short', 'Stock ran short',
           format('%s sold %s while %s ran short (receipt %s). Count and restock.',
                  coalesce(v_me.full_name, 'Someone'),
                  (select string_agg(distinct s->>'menu', ', ') from jsonb_array_elements(v_short) s),
                  (select string_agg(distinct s->>'ingredient', ', ') from jsonb_array_elements(v_short) s),
                  v_receipt),
           jsonb_build_object('receipt_no', v_receipt, 'short', v_short)
    from profiles p where p.role = 'admin' and p.is_active;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'receipt_no', v_receipt, 'subtotal', v_subtotal,
    'discount', v_discount, 'total', v_total, 'amount_paid', p_amount_paid,
    'change', p_amount_paid - v_total, 'short', v_short);
end $$;

revoke all on function public.process_sale(jsonb, numeric, text, numeric, text, text) from public, anon;
grant execute on function public.process_sale(jsonb, numeric, text, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
