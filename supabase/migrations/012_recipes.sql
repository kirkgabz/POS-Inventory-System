-- 012 · Menu items made from ingredients (recipe-based inventory)
--  products.kind: 'item' (sold, own stock — everything so far)
--                 'menu' (sold, made from a recipe — e.g. Burger)
--                 'ingredient' (not sold, has stock — e.g. Bun, Patty, Mayo in ml)
--  Selling a menu item deducts its ingredients. If an ingredient is short the
--  sale still goes through (rush hours!), stock may go below zero, and the
--  store owner gets a notification.

alter table public.products
  add column if not exists kind text not null default 'item'
  check (kind in ('item', 'menu', 'ingredient'));

create table if not exists public.recipe_items (
  menu_id        uuid not null references public.products(id) on delete cascade,
  ingredient_id  uuid not null references public.products(id) on delete restrict,
  qty            int  not null check (qty > 0),           -- in the ingredient's unit (g, ml, pc, slice…)
  created_at     timestamptz not null default now(),
  primary key (menu_id, ingredient_id),
  check (menu_id <> ingredient_id)
);
create index if not exists recipe_items_ingredient_idx on public.recipe_items (ingredient_id);

alter table public.recipe_items enable row level security;
drop policy if exists "recipe_items: read" on public.recipe_items;
create policy "recipe_items: read" on public.recipe_items for select using (public.is_active_user());
drop policy if exists "recipe_items: manage" on public.recipe_items;
create policy "recipe_items: manage" on public.recipe_items for all
  using (public.can_manage_products()) with check (public.can_manage_products());

do $$ begin
  alter publication supabase_realtime add table public.recipe_items;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- process_sale: same inputs as before, now recipe-aware
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
  v_ing      record;
  v_qty      int;
  v_need     int;
  v_cost     numeric;
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

    if v_prod.kind = 'menu' then
      -- deduct every ingredient; never block, but remember what ran short
      v_cost := 0;
      for v_ing in
        select r.qty, p.id, p.name, p.unit, p.stock, p.cost
        from recipe_items r join products p on p.id = r.ingredient_id
        where r.menu_id = v_prod.id
        order by p.id
        for update of p
      loop
        v_need := v_ing.qty * v_qty;
        v_cost := v_cost + v_ing.qty * v_ing.cost;
        if v_ing.stock < v_need then
          v_short := v_short || jsonb_build_object(
            'menu', v_prod.name, 'ingredient', v_ing.name, 'unit', v_ing.unit,
            'need', v_need, 'had', v_ing.stock);
        end if;
        update products set stock = stock - v_need where id = v_ing.id;
        insert into stock_movements (product_id, change, reason, note, ref_id, created_by)
        values (v_ing.id, -v_need, 'sale', format('%s × %s', v_qty, v_prod.name), v_sale_id, auth.uid());
      end loop;

      insert into sale_items (sale_id, product_id, name, unit_price, unit_cost, quantity, line_total)
      values (v_sale_id, v_prod.id, v_prod.name, v_prod.price, v_cost, v_qty, v_prod.price * v_qty);
    else
      if v_prod.stock < v_qty then
        raise exception 'Not enough stock for "%" (only % left)', v_prod.name, v_prod.stock;
      end if;
      update products set stock = stock - v_qty where id = v_prod.id;

      insert into sale_items (sale_id, product_id, name, unit_price, unit_cost, quantity, line_total)
      values (v_sale_id, v_prod.id, v_prod.name, v_prod.price, v_prod.cost, v_qty, v_prod.price * v_qty);

      insert into stock_movements (product_id, change, reason, ref_id, created_by)
      values (v_prod.id, -v_qty, 'sale', v_sale_id, auth.uid());
    end if;

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

  -- ingredients ran short → tell the store owner(s)
  if jsonb_array_length(v_short) > 0 then
    select * into v_me from profiles where id = auth.uid();
    insert into notifications (recipient_id, actor_id, actor_name, type, title, message, data)
    select p.id, v_me.id, v_me.full_name, 'ingredient_short', 'Ingredients ran short',
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
