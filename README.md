# TapBenta — POS & Inventory

TapBenta is a web-based point of sale and inventory system.

**Stack:** React 18 + TypeScript (Vite) · Supabase (Postgres, Row Level Security, Realtime, Storage, Auth) · deployed on Vercel.

---

## Features

### Accounts & roles
- Two roles: **Store owner** (full control) and **Staff**.
- The **first account ever created becomes the store owner** automatically.
- **Staff join by invitation only.** In *Staff & Access* the store owner clicks **Invite staff** (optionally for a specific name/email, valid 1–7 days) and sends the one-time link — copy, share sheet or QR code. The staff member opens the link (or pastes it on the *Create account* page) and creates their account; they're active immediately. Without a valid invitation the database refuses the sign-up.
- Invitations can be cancelled; the list shows who joined with which link.
- **Google sign-in:** anyone with an account can use *Continue with Google* on the sign-in page (Supabase links the Google login to the account with the same email). Google accounts with no TapBenta account are turned away and removed.
- **Store owner sign-up with Google:** *Create account → Store owner → Continue with Google*, then a **6-digit code** emailed to that address confirms it. Staff cannot sign up with Google — they use email + invitation link.
- A co-owner can sign up as **Store owner** with the *store owner key* (set in *Staff & Access*), or the owner can promote a staff member.
- The store owner can deactivate accounts; there is always at least one active store owner.

### Point of Sale (register)
- The register shows **only the current order**: a numbered list of product, price, quantity and amount.
- Add items by:
  - **USB barcode scanner** (it types the code and presses Enter),
  - **camera scanning** on phone or laptop (EAN-13/8, UPC-A/E, Code-128, Code-39, ITF, QR), or
  - **typing a word code or name**: after **2 or more characters**, matching products appear in a dropdown (pick with the mouse, or ↑/↓ and Enter).
- A **quantity picker** next to the search adds several of the same item at once. Each order line has −/+ and an editable quantity. Quantities can never exceed stock.
- Discount, **Cash / E-wallet / Bank & Card** payment, quick-cash buttons, change calculation, printable 58 mm receipt.
- Scanning an unknown code offers to add it as a new product (for authorized users).
- Checkout runs as **one database transaction** (`process_sale`). Prices and costs are read from the database, not the browser, and stock can't go below zero.

### Payment accounts (admin)
- Admins add **e-wallet** (GCash, Maya, …) and **bank / card** accounts with a provider name, account name, account number and an optional **QR code image**.
- At the register, each account has a **Show** button that opens a card with the amount, the QR code, the account name and the number.
- If no account of a type exists, that payment option shows as **Unavailable**.
- The account used and the customer's **reference number** are saved with the sale.

### Products & inventory
- **Add product from a photo.** A reminder card first asks for a photo where the **barcode** is visible, not just the product name. The system reads the barcode from the image and looks it up in the free **Open Food Facts / Open Beauty Facts / Open Products Facts** databases to fill in the name, category and brand/size. Staff then check the details and add price, cost and stock.
- **Products without a barcode** (home-made, repacked, store-owned): the system **generates** a barcode for them:
  - an **EAN-13 in the `2…` in-store range**, checked against the database so it's unique and never clashes with real retail barcodes, and
  - a **word code** such as `TB-BLUEHA-7K2Q`, printed as Code-128 + QR so it can be scanned or typed.
- Print a **sticker label** (name, price, barcode, word code, QR).
- Product photos are stored in Supabase Storage and shown in the inventory and at the register.
- Stock adjustments (restock, corrections) with a reason and note; every movement is logged.
- Filters for low stock, out of stock, own products and hidden products.

### Staff authorization & admin notifications
- An admin turns on **"Product & price access"** per staff member, allowing them to add products, change prices and adjust stock.
- Every add, price change, edit or stock adjustment made by staff creates a **notification for all admins**. This is done by a database trigger, so it can't be skipped from the app.
- Admins see a live **pop-up card** with the details (e.g. ₱45 → ₱50) and a full *Notifications* page.

### Sales & reports
- Sales page with **Day / Week / Month / Year** periods, previous/next navigation, a revenue chart and an expandable transaction list. Staff see only their own sales; admins see everything.
- **Download Excel** (admin) creates a workbook with four sheets:
  - **Summary:** revenue, transactions, items, average sale, discounts, cost of goods, gross profit and margin, plus totals by payment method and by cashier.
  - **Breakdown:** by hour, by day or by month, depending on the period.
  - **Transactions:** every sale, with payment account and reference.
  - **Items sold:** quantity, revenue, cost and profit per product.

### Interface
- **Animated intro** before sign-in (once per browser session): the TapBenta trolley (Lottie) rolls in with glass chips, confetti and the wordmark; click or press any key to skip. Add `?intro` to the URL to replay it.
- **Sign-in page:** frosted card with Remember me, Forgot password (email reset link) and Continue with Google.
- Left sidebar navigation (a slide-out menu on phones), warm minimalist design.
- A **confirmation card** before important actions and a success/error card afterwards (SweetAlert2).

---

## Project structure

```
src/
  pages/        Auth, Pending, Dashboard, Pos, Products, Sales, Staff, Payments, Notifications
  components/   Layout (sidebar), ProductForm, StockAdjust, CameraScanner, CodeLabel,
                PaymentAccountCard, NotificationCards, Modal
  context/      AuthContext, NotificationContext (realtime)
  hooks/        useProducts, usePaymentAccounts (realtime)
  lib/          supabase client, alerts, barcode/word-code generation, photo barcode reading,
                product lookup, storage uploads, sales periods & Excel report, formatting
supabase/
  schema.sql                                  base schema, RLS, triggers, RPCs
  migrations/002_product_photos_and_costs.sql product photos, cost per sale, storage bucket
  migrations/003_payment_accounts.sql         payment accounts, payment reference on sales
```

---

## Setup

### 1. Supabase
In **SQL Editor**, run these files **in order**:
1. [`supabase/schema.sql`](supabase/schema.sql)
2. [`supabase/migrations/002_product_photos_and_costs.sql`](supabase/migrations/002_product_photos_and_costs.sql)
3. [`supabase/migrations/003_payment_accounts.sql`](supabase/migrations/003_payment_accounts.sql)
4. [`supabase/migrations/004_staff_invitations.sql`](supabase/migrations/004_staff_invitations.sql)
5. [`supabase/migrations/005_google_owner_signup.sql`](supabase/migrations/005_google_owner_signup.sql)

Then, under **Authentication**:
- **Sign In / Providers → Google:** turn on and paste the Google OAuth client ID/secret (Google Cloud Console → Credentials; authorised redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`).
- **Emails → Magic Link** template: include `{{ .Token }}` so the email contains the **6-digit code** used for Google store-owner sign-up.
- **URL Configuration:** set *Site URL* to the production URL and add it, plus `http://localhost:5173`, to *Redirect URLs*.
- **Sign In / Providers → Email:** *Confirm email* can be turned off for local testing. For production, keep it on and set up custom SMTP (the built-in sender has a low hourly limit).

### 2. Environment variables
Copy `.env.example` to `.env.local`:

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | the **publishable** (`sb_publishable_…`) or legacy anon key |
| `VITE_STORE_NAME` | no | shown in the app and on receipts (default `TapBenta`) |
| `VITE_CODE_PREFIX` | no | word-code prefix (default `TB`) |
| `VITE_CURRENCY` / `VITE_LOCALE` | no | defaults `PHP` / `en-PH` |

> Never use the **secret / service_role** key in this app. `VITE_` variables are visible in the browser.

### 3. Run locally
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```
Sign up: the first account becomes the store owner.

---

## Deploying to Vercel

1. Import the GitHub repo. Framework preset: **Vite** (build `npm run build`, output `dist`).
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings → Environment Variables** (Production, and Preview if you use preview links). After changing them, redeploy, because they're baked in at build time.
3. Every push to `main` deploys to production. `vercel.json` rewrites routes to `index.html` so page refreshes work.
4. Add the production URL to Supabase **Authentication → URL Configuration**.

---

## Good to know

- **The camera needs HTTPS** (or `localhost`). It works on the Vercel URL, but not when the dev server is opened over your local network (`http://192.168…`).
- **The product name lookup** only sends the barcode number to Open Food/Beauty/Products Facts. It works well for branded goods. Many small or local products aren't listed; the barcode is still filled in and staff type the name.
- **Reading barcodes from photos** works best when the barcode fills much of the picture, is in focus and isn't glossy or tilted.
- **Word codes are scanned through their printed Code-128/QR**, not by reading the letters (no OCR).
- **PWA / offline:** only a web manifest is included. The app is online-only. Installing it as an app needs a service worker (e.g. `vite-plugin-pwa`) and PNG icons.

---

## Security model (Row Level Security)

| Table / bucket | Read | Write |
|---|---|---|
| `profiles` | own profile; active users | self (name only) · admins (role, access, approval), enforced by trigger |
| `products` | active users | insert/update: admin or authorized staff · delete: admin |
| `sales`, `sale_items` | admins: all · staff: their own | only through `process_sale()` |
| `stock_movements` | admin or authorized staff | only through `process_sale()` / `adjust_stock()` |
| `payment_accounts` | active users | admins |
| `notifications` | recipient only | created by triggers; recipient can mark read / delete |
| `staff_invites` | store owner (plus a public validity check for the sign-up page) | store owner |
| `app_settings` (store owner key) | store owner | store owner |
| storage `product-images` | public URLs | upload/update/delete: admin or authorized staff |
