# Jen Store — POS & Inventory

Web-based point of sale + inventory for the store. React + TypeScript (Vite), Supabase (Postgres + RLS + Realtime), deployable to Vercel, PWA-ready.

## Features

- **Sign in / sign up** for staff and admin
  - The **first account ever created becomes the admin** automatically.
  - Staff sign-ups wait for **admin approval** (admin gets a notification).
  - Extra admins sign up with an **admin invite key** (set in *Staff & Access*), or an admin promotes a staff member.
- **Point of Sale** — tap tiles, search, USB barcode scanner (types + Enter), or **phone/laptop camera scanning** (EAN-13, UPC, Code-128, QR…). Cash / e-wallet / card, discount, quick-cash buttons, change, printable 58 mm receipt. Checkout runs as one atomic database transaction (prices are read from the DB, stock can't go negative).
- **Manual products without barcodes** (home-made / own products) — the system generates:
  - an **EAN-13 barcode in the `2xxxxxxxxxxxx` in-store range** (never clashes with real retail barcodes), and
  - a **word code** like `JEN-UBEJA-7K2Q`, rendered as Code-128 + QR so the camera can scan it and staff can type it.
  - Print a sticker label from the product.
- **Authorized staff** — admin flips a switch per staff member to allow adding products, updating prices and adjusting stock.
- **Admin notifications** — every add / price change / edit / stock adjustment by staff creates a notification (done by a database trigger, so it can't be bypassed). Admins get a live **pop-up card** with the details (e.g. ₱45 → ₱50) plus a notification page.
- Confirmation cards before every important action, success/error alerts after.
- **Add products from a photo** — the barcode is read from the uploaded picture and the name/category are filled from the free Open Food / Beauty / Products Facts databases; staff complete price and stock. Items without a barcode get one generated.
- **Excel sales reports** (admin) for any day, week, month or year: summary, breakdown, transactions, items sold and gross profit.
- Inventory with low-stock / out-of-stock filters, sales history, dashboard.

## Setup

1. **Supabase**: create a project → *SQL Editor* → run [`supabase/schema.sql`](supabase/schema.sql), then [`supabase/migrations/002_product_photos_and_costs.sql`](supabase/migrations/002_product_photos_and_costs.sql).
2. **Auth settings** (Supabase → Authentication → URL Configuration): set *Site URL* to your Vercel URL (and add `http://localhost:5173` to redirect URLs). Email confirmation is on by default; turn it off under *Providers → Email* if you don't want it.
3. **Env**: copy `.env.example` to `.env.local` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
4. Run:
   ```bash
   npm install
   npm run dev
   ```
5. Sign up — the first account is the admin.

## Deploy to Vercel

Import the folder/repo in Vercel (framework: **Vite**), add the same `VITE_*` environment variables, deploy. `vercel.json` already handles SPA routing.

> The camera requires **HTTPS** (Vercel gives you that) or `localhost`. To test on a phone during development use the Vercel preview URL, or `npm run dev` + an HTTPS tunnel.

## Turning it into an installable app (PWA) later

`public/manifest.webmanifest` is already linked. When you're ready for offline support, add `vite-plugin-pwa` and register a service worker; add 192/512 px PNG icons to the manifest.

## Security model (RLS)

| Table | Read | Write |
|---|---|---|
| products | active users | insert/update: admin or authorized staff · delete: admin |
| sales / sale_items | admin: all · staff: their own | only through `process_sale()` |
| stock_movements | admin / authorized staff | only through `process_sale()` / `adjust_stock()` |
| profiles | active users | self (name only) · admin (role, access, approval) — enforced by trigger |
| notifications | recipient only | created by triggers |
| app_settings | admin | admin |
