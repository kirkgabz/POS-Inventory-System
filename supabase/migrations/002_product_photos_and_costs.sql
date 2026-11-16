-- =====================================================================
--  002 — product photos + cost tracking per sale (for profit in reports)
--  Run once in Supabase → SQL Editor (after schema.sql).
-- =====================================================================

-- 1) Product photo
alter table public.products add column if not exists image_url text;

-- 2) Remember the cost at time of sale so reports can show gross profit
alter table public.sale_items add column if not exists unit_cost numeric(12,2) not null default 0;

-- 3) process_sale now also records unit_cost
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

    insert into sale_items (sale_id, product_id, name, unit_price, unit_cost, quantity, line_total)
    values (v_sale_id, v_prod.id, v_prod.name, v_prod.price, v_prod.cost, v_qty, v_prod.price * v_qty);

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

revoke all on function public.process_sale(jsonb, numeric, text, numeric) from public, anon;
grant execute on function public.process_sale(jsonb, numeric, text, numeric) to authenticated;

-- 4) Storage bucket for product photos (public URLs, max 5 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "product images: authorized upload" on storage.objects;
create policy "product images: authorized upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.can_manage_products());

drop policy if exists "product images: authorized update" on storage.objects;
create policy "product images: authorized update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.can_manage_products());

drop policy if exists "product images: authorized delete" on storage.objects;
create policy "product images: authorized delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.can_manage_products());

-- 5) Make the API see the new columns immediately
notify pgrst, 'reload schema';
