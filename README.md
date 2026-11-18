# TapBenta — POS & Inventory

**TapBenta** is a point-of-sale and inventory system for small stores, such as sari-sari stores, boutiques and mini-marts. It runs in a web browser on a laptop, desktop, tablet or phone, so there's nothing to install.

It handles everyday store work in one place: selling at the counter, keeping track of stock, recording staff hours and reporting sales and profit.

---

## What the system does

### Selling (Point of Sale)
- Add items to an order by **scanning the barcode** with a USB scanner or the device camera, or by **typing the product's word code or name**. Suggestions appear after 2 letters.
- Choose a quantity, apply a discount, and take payment by **cash, e-wallet (GCash, Maya…) or bank / card**.
- For e-wallet and bank payments, the cashier can show the customer the store's **QR code and account details**.
- The system computes the change, records the sale and prints a **receipt**.

### Products & inventory
- **Add branded products from a photo or camera scan of the barcode.** The system reads the barcode and, when it can, fills in the product name automatically.
- **Products without a barcode** (home-made, repacked, store-owned) get a **unique barcode and word code** from the system, ready to print as a sticker label.
- **Buying by pack:** enter the wholesale pack price and the number of pieces inside. The system works out the cost per piece, the profit per piece and per pack, and the margin. It warns you if you'd be selling at a loss.
- **Restock by piece or by pack**, record damaged or lost items, and get **low-stock and out-of-stock** alerts.

### Sales reports
- View sales by **day, week, month or year**, with a chart and the full list of transactions.
- Download an **Excel report** with totals, profit, best-selling items, and breakdowns by payment method and by cashier.

### Staff & access
- **Two roles:** the **Store owner**, who controls everything, and **Staff**.
- **Staff can only join with an invitation link** from the store owner.
- The store owner chooses which staff may **add products and change prices**. Every change staff make shows up for the owner as a **pop-up notification**.
- An **Inventory log** for the store owner lists every product added, price change, edit and restock: who did it and when, filterable by person and date.
- Every order records **who took it**, whether a staff member or the store owner.

### Time clock (DTR)
- Staff **time in and time out**. The time comes from the system, not the device, so it can't be faked by changing the phone's clock.
- **Optional face check:** a quick live face scan with a blink test. The owner decides whether it's required for time in, for time out, or both.
- The store owner sees **who's on duty right now**, reviews and corrects records, and downloads the **DTR in Excel**. The owner doesn't clock in.

### Receipts
- The store owner sets up the receipt: logo, business name, address, contact details, TIN, VAT, footer message and paper size (58 mm, 80 mm or A4).
- A live preview shows exactly how the receipt will print. Past receipts can be **reprinted**.

### Safety & ease of use
- Every important action asks for **confirmation first**, then shows a clear **success or error message**.
- Sign in with **email and password** or **Google**, with **Remember me** and **Forgot password**.
- Clean, simple design with a left-side menu (a slide-out menu on phones).

---

## How to run it

### Using the live system
Open the store's TapBenta web address in any modern browser (Chrome, Edge, Safari or Firefox). On a phone you can choose **"Add to Home screen"** for quick access.

> **TapBenta needs an internet connection.** The camera (for scanning and the face check) works on the secure (https) web address.

### Running it on your own computer (for developers)
1. Install **Node.js** (version 18 or newer).
2. Get the project files and open a terminal in the project folder.
3. Create a file named `.env.local` with the store's connection details (copy `.env.example` and fill it in).
4. Run:
   ```bash
   npm install
   npm run dev
   ```
5. Open **http://localhost:5173** in your browser.

Changes pushed to the main branch on GitHub are published to the live site automatically.

---

## How to use it

### 1. Getting started (store owner)
1. Open TapBenta and choose **Create account → Store owner**. Sign up with email, or with **Google** and a 6-digit code sent to your email.
2. Go to **Receipt & invoice** and enter your store's details.
3. Go to **Payment accounts** and add your GCash, Maya or bank details with their QR codes. Payment types you don't add show as "Unavailable" at the register.
4. Go to **Inventory** and add your products (see step 3).

### 2. Adding staff
1. Go to **Staff & Access → Invite staff** and send the invitation link by copying it, sharing it, or showing the QR code.
2. The staff member opens the link, enters their name, email and password, and can start right away.
3. Turn on **Product & price access** for staff you trust to add products and change prices.

### 3. Adding products
1. In **Inventory**, click **Add product**.
2. Pick one of these:
   - **Upload product photo:** take a clear photo of the **barcode**, and the name is filled in when the product is found;
   - **Scan with the camera:** point it at the barcode;
   - **No barcode · own product:** the system creates a barcode and word code for you.
3. Enter the **selling price**, the **cost** (switch to **Per pack** if you bought a wholesale pack) and the **stock**.
4. Click **Add product**. For generated codes, use **Print label** and stick it on the item.

### 4. Selling
1. Open **Point of Sale**.
2. Scan items or type their word code or name. Use the quantity picker or the − / + buttons for more than one.
3. Click **Charge** and choose **Cash, E-wallet or Bank / Card**:
   - **Cash:** enter the amount received and the change is shown;
   - **E-wallet / Bank:** tap **Show** to display your QR code, then enter the customer's reference number.
4. Confirm, and print the receipt.

### 5. Restocking
In **Inventory**, click a product's **Adjust stock**. Add stock **by piece or by pack**, and enter a new pack price if the supplier's price changed. Use **Remove** for damaged, expired or lost items.

### 6. Time in / time out (staff)
Open **Time clock** and tap **Time in** when your shift starts and **Time out** when it ends. If the face check is on, look at the camera and blink when asked. The first time, you'll register your face once.

### 7. Checking sales and staff hours (store owner)
- **Sales:** pick day, week, month or year to see totals and transactions. Every order shows **who took it** (staff name, or "Store owner"), and you can filter to one person. **Download Excel** for the full report.
- **Inventory log:** see every product added, price or detail change, restock and stock removal, with **who did it and when**. Filter by person, by date (today, last 7 days, this month or chosen dates) and by type of change, then download it as Excel.
- **Time clock:** see who's on duty, review time records, fix forgotten time-outs, and download the DTR.
- **Notifications:** review every product or price change made by staff.

---

## Good to know
- **Camera scanning** works best in good light, with the barcode flat and filling most of the frame.
- **Not every product is found automatically.** Many local or small-brand items aren't listed online. In that case, just type the name once; next time the item scans instantly from your own inventory.
- **Receipts** print with a "This is not an official receipt" notice by default. Only BIR-accredited systems may issue official receipts.

© 2026 TapBenta
