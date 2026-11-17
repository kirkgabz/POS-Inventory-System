-- =====================================================================
--  007 — receipt / invoice details set by the store owner
--  Run once in Supabase → SQL Editor.
-- =====================================================================

create table if not exists public.receipt_settings (
  id                 int primary key default 1 check (id = 1),
  business_name      text,
  tagline            text,
  logo_url           text,
  address            text,
  phone              text,
  email              text,
  tin                text,
  business_permit    text,
  vat_registered     boolean not null default false,
  vat_rate           numeric not null default 12 check (vat_rate between 0 and 30),
  header_note        text,
  footer_message     text default 'Thank you, come again!',
  show_cashier       boolean not null default true,
  show_barcode       boolean not null default true,
  show_not_official  boolean not null default true,
  paper_width        text not null default '58mm' check (paper_width in ('58mm', '80mm', 'A4')),
  updated_at         timestamptz not null default now()
);
insert into public.receipt_settings (id) values (1) on conflict do nothing;

alter table public.receipt_settings enable row level security;

drop policy if exists "receipt_settings: active users read" on public.receipt_settings;
create policy "receipt_settings: active users read" on public.receipt_settings
  for select to authenticated using (public.is_active_user());

drop policy if exists "receipt_settings: owner update" on public.receipt_settings;
create policy "receipt_settings: owner update" on public.receipt_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
