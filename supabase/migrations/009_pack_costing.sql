-- 009 · Buying by pack
-- Products remember how many pieces come in one wholesale pack, and costs keep
-- 4 decimals so a pack price split per piece (₱250 ÷ 12 = ₱20.8333) stays exact.

alter table public.products
  add column if not exists pack_size int check (pack_size is null or pack_size >= 2);

alter table public.products   alter column cost      type numeric(14,4);
alter table public.sale_items alter column unit_cost type numeric(14,4);

notify pgrst, 'reload schema';
