-- =====================================================================
--  003 — store payment accounts (e-wallet / bank & card) + payment
--        reference on each sale.  Run once in Supabase → SQL Editor.
-- =====================================================================

-- 1) Accounts customers can pay into (GCash, Maya, BDO, card terminal…)
create table if not exists public.payment_accounts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('ewallet', 'bank')),
  provider       text not null check (length(trim(provider)) > 0),
  account_name   text not null check (length(trim(account_name)) > 0),
  account_number text,
  qr_url         text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint payment_accounts_has_detail check (account_number is not null or qr_url is not null)
);

alter table public.payment_accounts enable row level security;

drop policy if exists "payment_accounts: active users read" on public.payment_accounts;
create policy "payment_accounts: active users read" on public.payment_accounts
  for select to authenticated using (public.is_active_user());

drop policy if exists "payment_accounts: admin insert" on public.payment_accounts;
create policy "payment_accounts: admin insert" on public.payment_accounts
  for insert to authenticated with check (public.is_admin());

drop policy if exists "payment_accounts: admin update" on public.payment_accounts;
create policy "payment_accounts: admin update" on public.payment_accounts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payment_accounts: admin delete" on public.payment_accounts;
create policy "payment_accounts: admin delete" on public.payment_accounts
  for delete to authenticated using (public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.payment_accounts;
exception when duplicate_object then null; end $$;

-- 2) Which account was used + the customer's reference / transaction no.
alter table public.sales add column if not exists payment_account text;
alter table public.sales add column if not exists payment_ref text;

-- 3) process_sale gains p_payment_account and p_payment_ref
drop function if exists public.process_sale(jsonb, numeric, text, numeric);

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
  v_qty      int;
  v_subtotal numeric := 0;
  v_discount numeric;
  v_total    numeric;
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

revoke all on function public.process_sale(jsonb, numeric, text, numeric, text, text) from public, anon;
grant execute on function public.process_sale(jsonb, numeric, text, numeric, text, text) to authenticated;

-- 4) Refresh the API's view of the schema
notify pgrst, 'reload schema';
