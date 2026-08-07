# Manual End-to-End Test Guide

A complete, from-scratch manual test pass over every module, for all three roles
(Owner, Manager, Cashier).

The database has been **wiped and re-seeded** for this run — see §1 for exactly
what state you are starting from.

---

## 0. The single most important thing to understand first

This system does **not** split permissions the way the names suggest. Get this
wrong and half your test results will look like bugs when they are correct
behaviour.

| | Owner | Manager | Cashier |
|---|---|---|---|
| **Mental model** | Owns the business | Runs the shop floor | Takes payments |
| Portal | Management shell (`/`) | Management shell (`/`) | Cashier shell (`/cashier`) |
| Money (finance, reports, margins, cost prices) | ✅ | ❌ **403** | ❌ |
| Catalog **writes** (products, categories, brands) | ✅ | ❌ **403** | ❌ |
| Catalog **reads** (operational lookup) | ✅ | ✅ (no cost figures) | ❌ |
| Procurement (suppliers, purchases) | ✅ | ❌ **403** | ❌ |
| Inventory ledger + adjustments | ✅ | ❌ (reads only, narrowed) | ❌ |
| Sell at POS | ✅ | ✅ | ✅ |
| Void a sale | ✅ | ✅ | ❌ **403** |
| Cash register (own drawer) | ✅ | ✅ | ✅ |
| Register reconciliation / sign-off | ✅ | ✅ | ❌ |
| Workforce monitoring (who's on shift) | ✅ | ✅ (salary stripped) | ❌ |
| User administration (create/roles/passwords) | ✅ | ❌ **403** | ❌ |
| Audit logs | ✅ | ❌ **403** | ❌ |
| Settings | ✅ | ❌ | ❌ |
| Label **printing** | ✅ | ✅ | ❌ |
| Label **printer/template config** | ✅ | ❌ **403** | ❌ |
| Sync queue / retry | ✅ | ✅ | ❌ (header indicator only) |
| Notifications | ✅ (+ Preferences tab) | ✅ | ✅ |

**A Manager is an operational role, not a junior owner.** They cannot see a
single financial figure, cannot create a product, and cannot administer accounts.

Two independent layers enforce this, and you should test both:

1. **Route guard** (frontend) — typing an owner-only URL as a Manager redirects
   to `/unauthorized`. Nav hiding is *not* the boundary.
2. **API guard** (backend) — the endpoint returns **403** regardless of what the
   UI did. This is the real boundary.

I verified layer 2 live against the running server before writing this guide:

```
                          OWNER  MANAGER  CASHIER
GET /owner/products         200     403      403
GET /finance/dashboard      200     403      403
GET /reports/sales          200     403      403
GET /owner/audit-logs       200     403      403
GET /manager/products       200     200      403
GET /employees              200     200      403
GET /customers              200     200      200
GET /register/live          200     200      200
GET /notifications          200     200      200
```

---

## 1. Starting state — what I did to your database

**Wiped.** All 55 application tables truncated (`RESTART IDENTITY CASCADE`) on
Neon endpoint `ep-frosty-moon-at71qpbs`. The ~469 rows that were there (2 sales,
3 products, 42 variants, 177 audit logs, 72 login-history rows) are **gone and
not recoverable**. The schema and `_prisma_migrations` were left untouched, so no
migration is needed.

Your database now contains exactly this and nothing else:

| Table | Rows | Why it's there |
|---|---|---|
| `employees` | 3 | Owner, Manager, Cashier — re-seeded via `npm run db:seed` |
| `settings` | 1 | The `singleton` settings row; the app won't boot without it |
| `customers` | 1 | **Walk-In Customer** — see the warning below |
| `sizes` | 8 | Small, Medium, Large, XL, 32, 34, 36, 38 |
| `colors` | 8 | Black, Blue, Navy, White, Khaki, Grey, Red, Green |
| `label_templates` | 9 | System templates the server re-provisions on boot |

No products, categories, brands, suppliers, purchases, sales, stock, audit logs,
or notifications. You build all of it in §4.

### ⚠ Two things I had to restore, and why they matter

These are **not optional** — a plain truncate leaves the app unusable, and both
failures present as confusing errors rather than obvious ones.

1. **Walk-In Customer.** Every checkout without a named customer resolves to the
   singleton `customers` row with `isWalkIn = true`. Without it, `sale.service`
   throws *"Walk-In customer not initialized."* and **the till cannot sell at
   all**. Restored via `npx tsx scripts/ensure-walkin.ts`.

2. **Sizes and colors.** `ProductVariant.sizeId` and `.colorId` are `NOT NULL` in
   the schema, and **there is no API to create sizes or colors** — the owner
   product wizard only offers rows that already exist. After a truncate the
   catalog is therefore unbuildable: every variant insert fails on a missing FK
   target. I re-seeded the same vocabulary `seedProducts.ts` uses.

If you ever wipe again, re-run all three steps or you will hit these walls:

```bash
cd SERVER
node scratch/reset-db.mjs --yes         # truncate everything
npm run db:seed                          # 3 accounts + settings singleton
DATABASE_URL="<your url>" npx tsx scripts/ensure-walkin.ts
node scratch/seed-attributes.mjs         # sizes + colors
```

### ⚠ One config change I made

`CLIENT/.env.local` pointed the UI at **`http://localhost:4401`** — the offline
test rig's till node, not your dev server. Testing against it would have proven
nothing about normal operation. I renamed it to
`.env.local.offline-rig-backup`; the client now falls back to its default
`http://localhost:3000/api/v1`. **Restore that file when you go back to offline
rig testing.**

### Credentials

| Role | Phone | Email | Password | Lands on |
|---|---|---|---|---|
| Owner | `9876500000` | `owner@cexpos.local` | `Owner@123` | `/` |
| Manager | `9876543210` | `manager@cexpos.local` | `Manager@123` | `/` |
| Cashier | `9876511111` | `cashier@cexpos.local` | `Cashier@123` | `/cashier/pos` |

Login accepts **either** phone or email — exactly one, never both.

---

## 2. Start the app

Two terminals:

```bash
# Terminal 1 — API on :3000
cd SERVER && npm run dev

# Terminal 2 — UI on :5173
cd CLIENT && npm run dev
```

Confirm the API is alive before touching the UI:

```bash
curl http://localhost:3000/health
# {"status":"ok", ... "database":"connected"}
```

Open **http://localhost:5173**.

**Use three separate browser profiles** (or one normal + two incognito windows)
— one per role. The session lives in `localStorage`, so a second login in the
same profile silently replaces the first, and you will lose an hour to
"why am I suddenly a cashier".

---

## 3. Test order — and why it matters

The modules have hard data dependencies. Follow this order or you will hit dead
ends (an empty POS, an unopenable register, reports with no rows):

```
Owner:   Settings → Sizes/Colors (done) → Categories → Brands → Products+Variants
                                                                      ↓
                                                          Suppliers → Purchases (stock in)
                                                                      ↓
Cashier: Open Register → POS Sale → Close Register
                                                                      ↓
Manager: Void a sale, monitor workforce, print labels
                                                                      ↓
Owner:   Finance, Reports, Inventory analytics, Audit Logs  (need the data above)
```

Record results as you go. A blank screen in Reports before you have made a sale
is **correct**, not a bug.

---

## 4. OWNER — full pass

Log in as `9876500000` / `Owner@123`. You land on the Dashboard at `/`.

### 4.1 First look — Dashboard

| Step | Action | Expected |
|---|---|---|
| 1 | Land on `/` | Dashboard renders. **All KPIs zero / empty charts** — correct on a fresh DB |
| 2 | Check sidebar | All groups visible: Dashboard, Operations, Inventory, Procurement, Employees, Finance, Reports, Analytics, Marketing, Utilities, Settings, My Account |
| 3 | Click the bell (navbar) | Notifications panel opens; unread count is 0 |

### 4.2 Store Settings — do this before anything else

`Settings → Store Settings` (`/admin/settings`)

| Step | Action | Expected |
|---|---|---|
| 1 | Set store name, address, phone, GSTIN | Saves; toast confirms |
| 2 | Reload the page | **Values persist.** ⚠ This is the known-fragile path: a config block must be *merged*, not assigned. If unrelated settings silently reset to defaults, that is the documented bug in `STORE_SETTINGS.md` |
| 3 | Set currency / tax defaults | Persist after reload |
| 4 | Find **`enforceRegisterSession`** | Leave it **ON** (default). This makes an open drawer mandatory for every sale — test the real path first |

`Settings → Receipt & Invoice` (`/admin/settings/receipt`)

| Step | Action | Expected |
|---|---|---|
| 5 | Set invoice prefix (e.g. `INV-`) and starting number | Saves |
| 6 | Change the prefix mid-way later | Numbering continues correctly per-prefix — the lookup is prefix-scoped, so a mid-day change is safe |

`Settings → Barcode Settings` (`/admin/settings/barcode`)

| Step | Action | Expected |
|---|---|---|
| 7 | Click it | **Redirects to `/admin/labels?tab=barcode`.** Deliberate — barcode config is owned by the Label Engine. Not a bug |

`Settings → Backup & Restore` (`/admin/settings/backup`)

| Step | Action | Expected |
|---|---|---|
| 8 | Click it | Placeholder page. **Deliberate non-build**, marked "Soon" in the nav |

### 4.3 Categories

`Inventory → Categories` (`/admin/categories`)

| Step | Action | Expected |
|---|---|---|
| 1 | Create `Shirts` | Appears in list, `productCount` 0 |
| 2 | Create `Trousers`, `Jackets` | All three listed |
| 3 | Create a **child** category under Shirts (e.g. `Polo`) | Nesting shown; `level`/`path` reflect hierarchy |
| 4 | Edit a category name | Persists |
| 5 | Upload a category image | Saves and renders |
| 6 | Archive a category | Moves to archived; hidden from active list |
| 7 | Try to **delete** a category with products (after §4.5) | **Blocked** — safe-delete refuses; must archive instead |
| 8 | Bulk-select two, bulk archive | Both archived |
| 9 | Open the activity timeline | Shows your create/edit/archive actions |
| 10 | `/admin/categories/analytics` | Loads (empty until sales exist). Separate route because the query is expensive |

### 4.4 Brands

`Inventory → Brands` (`/admin/brands`)

| Step | Action | Expected |
|---|---|---|
| 1 | Create `Levis`, `Allen Solly` | Both listed |
| 2 | Edit one, add a logo | Persists |
| 3 | Deactivate one | No longer offered in the product wizard |

### 4.5 Products — the 9-step wizard

`Inventory → Product Management` (`/admin/products`)

| Step | Action | Expected |
|---|---|---|
| 1 | Click **Create Product** | 9-step wizard opens |
| 2 | Step through: basics → category → brand → pricing → **variants** → stock → barcode → images → review | Each step validates before advancing |
| 3 | At the variants step, pick **size + colour** | The 8 sizes and 8 colours from §1 are offered. ⚠ If these lists are empty, re-run `scratch/seed-attributes.mjs` — you cannot create a variant without both |
| 4 | Set cost price and MRP/selling price | Accepted |
| 5 | Set opening stock (e.g. 20) | Accepted |
| 6 | Assign barcode — use `890100000001` for at least one variant | Saved; this is your known-good scan target |
| 7 | Finish the wizard | Product created with its variants |
| 8 | Create **2–3 more products** across different categories, each with 2+ variants | You need this spread for reports and analytics later |
| 9 | Verify the list shows **cost price and margin columns** | Owner-only financial columns visible |
| 10 | Edit a product | Persists |
| 11 | Duplicate a product | Copy created, SKUs distinct |
| 12 | Archive a product | Hidden from active list, still in DB |
| 13 | Delete a product with no history | Deletes cleanly |

### 4.6 Suppliers and Purchases (stock in)

`Procurement → Suppliers` (`/admin/suppliers`)

| Step | Action | Expected |
|---|---|---|
| 1 | Create a supplier with contact + GSTIN | Created |
| 2 | Open supplier profile `/admin/suppliers/:id` | Shows details, empty purchase history, zero balance |

`Procurement → Purchases` (`/admin/purchases`)

| Step | Action | Expected |
|---|---|---|
| 3 | Create a purchase order — supplier, items, quantities, cost prices | PO created, status pending |
| 4 | Open `/admin/purchases/:id` | Line items and totals correct |
| 5 | **Receive goods partially** (e.g. 5 of 10) | Status → partially received; **stock increases by exactly 5** |
| 6 | Check the product's stock | Increased by 5, not 10 |
| 7 | Receive the remaining 5 | Status → fully received; stock now +10 total |
| 8 | Check `Inventory → Movements` | A `PURCHASE` movement row per receipt |
| 9 | Check supplier balance | Reflects the purchase value |

### 4.7 Inventory

`Inventory → Dashboard` (`/admin/inventory`) — KPIs now non-zero.

| Screen | Path | Test |
|---|---|---|
| Stock | `/admin/inventory/stock` | Every variant with current qty; **cost figures visible** (owner) |
| Movements | `/admin/inventory/movements` | Full ledger; filter by type/date |
| Adjustments | `/admin/inventory/adjustments` | Create a +/- adjustment with a reason → stock changes, movement logged |
| Cycle Counts | `/admin/inventory/cycle-counts` | Start a count → `/admin/inventory/cycle-counts/:id` → enter counted qty → submit → variance shown, stock reconciled |
| Valuation | `/admin/inventory/valuation` | Total stock value = Σ(qty × cost) |
| Damaged | `/admin/inventory/damaged` | Mark stock damaged → removed from sellable, movement logged |
| Low Stock | `/admin/inventory/low-stock` | Set a reorder level above current qty → product appears |
| Out of Stock | `/admin/inventory/out-of-stock` | Drop a variant to 0 → appears |
| Reorder | `/admin/inventory/reorder` | Suggests qty for below-threshold items |
| Dead Stock | `/admin/inventory/dead-stock` | Items with no movement in the window |
| Fast/Slow Moving | `/admin/inventory/fast-moving`, `/slow-moving` | Populate only **after** sales in §6 — empty now is correct |

### 4.8 Discounts

`Marketing → Discounts` (`/admin/discounts`)

| Step | Action | Expected |
|---|---|---|
| 1 | Create a percentage rule on a category | Saved |
| 2 | Check the affected product's selling price | Reflects the rule via the pricing engine |
| 3 | Create a fixed-amount rule | Applies |
| 4 | Set a date window in the future | Rule inactive until the window opens |
| 5 | Expire/disable a rule | Price reverts |

⚠ These are **shelf-price** rules feeding `ProductVariant.sellingPrice`. Cart-level
promotions applied at checkout are a separate mechanism — do not expect them to
be the same thing.

### 4.9 Label Engine

`Settings → Labels & Printers` (`/admin/labels`) — **owner-only config**

| Step | Action | Expected |
|---|---|---|
| 1 | View the 9 system templates | All listed (Default Clothing Label, Price Tag, …) |
| 2 | Create a custom template | Saved |
| 3 | Configure a printer | Saved |
| 4 | Open the **Barcode tab** | Symbology, size, burn quality — this is where barcode config actually lives |

`Utilities → Label Printing` (`/labels`) — operational, Manager can reach this too

| Step | Action | Expected |
|---|---|---|
| 5 | Select products, choose a template, print | Job queued; preview renders the barcode |

### 4.10 Users & Roles

`Settings → Users & Roles` (`/admin/settings/users`)

| Step | Action | Expected |
|---|---|---|
| 1 | View the 3 accounts | Owner, Manager, Cashier listed |
| 2 | Create a new Cashier | Created; can log in with the password you set |
| 3 | Reset that cashier's password | Their existing session is invalidated (token version bumps) |
| 4 | Deactivate the account | Login now **rejected** — inactive accounts cannot authenticate |
| 5 | Reactivate | Login works again |
| 6 | Change a user's role Cashier → Manager | Applied; their portal changes on next login |
| 7 | **Try to demote yourself (the only Owner)** | **Blocked** — privilege-escalation guard prevents removing the last owner |
| 8 | Try to delete an employee who has sales | **Blocked** (FK `onDelete: Restrict`) — deactivate instead |

### 4.11 Workforce monitoring

`Employees` group — all reachable by Manager too, but the Owner sees **salary**.

| Screen | Path | Test |
|---|---|---|
| Employee Activity | `/admin/employees` | Live activity feed |
| Employees | `/admin/staff` | Roster; **salary column visible to Owner** |
| Attendance | `/admin/attendance` | Mark/adjust attendance |
| Performance | `/admin/performance` | Per-employee sales metrics (needs §6 data) |
| Login History | `/admin/login-history` | Your logins with IP/device/browser |

### 4.12 Audit Logs

`Settings → Audit Logs` (`/admin/audit-logs`)

| Step | Action | Expected |
|---|---|---|
| 1 | Open the screen | Every action from §4.2–§4.11 is listed |
| 2 | Filter by entity / actor / date | Filters work |
| 3 | Check severity | **Derived, not stored** — high-severity for deletes/role changes |
| 4 | Open a row | Before/after diff of the change |

### 4.13 Finance — do this after §6 (needs sales)

| Screen | Path | Expected |
|---|---|---|
| Dashboard | `/admin/finance` | Revenue, expenses, profit KPIs |
| Revenue | `/admin/finance/revenue` | Matches sales total |
| Profit & Loss | `/admin/finance/profit-loss` | Revenue − COGS − expenses |
| Cash Flow | `/admin/finance/cash-flow` | In/out by period |
| Expenses | `/admin/finance/expenses` | Create an expense → appears in P&L |
| Payments | `/admin/finance/payments` | Split by CASH / UPI / CARD / CREDIT |
| Salaries | `/admin/finance/salaries` | Payroll per employee |
| Supplier Payments | `/admin/finance/payables` | Outstanding supplier balances; record a payment → balance drops |
| `/finance/register` | — | **Redirects to `/register`.** Legacy bookmark path, deliberate |

### 4.14 Reports — do this after §6

Five consolidated destinations, each hosting the old pages as `?tab=` tabs.

| Screen | Path | Test |
|---|---|---|
| Overview | `/admin/reports` | Dashboard + global search |
| Sales | `/admin/reports/sales` | Tabs: summary, **payments**, **returns** |
| Inventory | `/admin/reports/inventory` | Tabs: **products**, **categories**, **brands**, **purchases** |
| Customers | `/admin/reports/customers` | Spend, frequency, top customers |
| Employees | `/admin/reports/employees` | Sales per employee |
| Finance | `/admin/reports/finance` | Tab: **profit** |

For each: apply a date filter, then **export**. Verify the exported file matches
what is on screen.

**Legacy URL redirects** — all seven must resolve, not 404:

| Old URL | Redirects to |
|---|---|
| `/admin/reports/products` | `/admin/reports/inventory?tab=products` |
| `/admin/reports/categories` | `/admin/reports/inventory?tab=categories` |
| `/admin/reports/brands` | `/admin/reports/inventory?tab=brands` |
| `/admin/reports/purchases` | `/admin/reports/inventory?tab=purchases` |
| `/admin/reports/payments` | `/admin/reports/sales?tab=payments` |
| `/admin/reports/returns` | `/admin/reports/sales?tab=returns` |
| `/admin/reports/profit` | `/admin/reports/finance?tab=profit` |

Browser **Back** must not bounce through the redirect (they use `replace`).

---

## 5. MANAGER — full pass

Log in as `9876543210` / `Manager@123` in a **different browser profile**. You
land on `/`, the same shell as the Owner — but a much shorter sidebar.

### 5.1 What must be VISIBLE

| Screen | Path | Expected |
|---|---|---|
| Dashboard | `/` | Loads (operational KPIs) |
| POS Checkout | `/pos` | Full checkout |
| Sales History | `/sales` | All sales |
| Invoice | `/sales/:id` | Receipt view |
| Customers | `/customers` | List + create + edit |
| Customer Profile | `/customers/:id` | ⚠ See §5.4 |
| Product Catalog | `/products` | **Read-only**, no cost/margin columns |
| Categories | `/categories` | **Read-only** browser |
| My Register | `/register` | Own drawer |
| Register History | `/register/history` | Sessions |
| Drops & Payouts | `/register/movements` | Cash movements |
| Shift Summary | `/register/sessions/:id` | Detail |
| Employee Activity | `/admin/employees` | Read-only |
| Employees | `/admin/staff` | ⚠ **Salary column must be ABSENT** — stripped server-side |
| Attendance | `/admin/attendance` | Read-only |
| Performance | `/admin/performance` | Read-only |
| Login History | `/admin/login-history` | Read-only |
| Label Printing | `/labels` | Can print |
| Sync | `/sync` | Queue + retry |
| Notifications | `/notifications` | Own notifications, **no Preferences tab** |
| My Profile | `/profile` | Own account |

### 5.2 What must be BLOCKED — the critical test

Type each URL directly into the address bar. **Every one must redirect to
`/unauthorized`.** Nav hiding is not the boundary; the guard is.

```
/admin/products              /admin/finance              /admin/reports
/admin/categories            /admin/finance/revenue      /admin/reports/sales
/admin/brands                /admin/finance/profit-loss  /admin/reports/inventory
/admin/suppliers             /admin/finance/cash-flow    /admin/reports/customers
/admin/purchases             /admin/finance/expenses     /admin/reports/employees
/admin/inventory             /admin/finance/payables     /admin/reports/finance
/admin/inventory/stock       /admin/finance/salaries     /admin/discounts
/admin/inventory/movements   /admin/finance/payments     /admin/labels
/admin/inventory/valuation   /admin/settings             /admin/audit-logs
/admin/inventory/adjustments /admin/settings/users       /admin/settings/receipt
```

Then verify the **backend** independently. In a terminal:

```bash
# Get a manager token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","password":"Manager@123"}' \
  | grep -o '"token":"[^"]*"' | sed 's/"token":"//; s/"$//')

# Each of these must print 403
for ep in /owner/products /finance/dashboard /reports/sales /owner/audit-logs; do
  printf "%-24s " "$ep"
  curl -s -o /dev/null -w "%{http_code}\n" \
    "http://localhost:3000/api/v1$ep" -H "Authorization: Bearer $TOKEN"
done
```

**All four must return 403.** If any returns 200, that is a real privilege
escalation and the most serious finding you can get from this guide.

### 5.3 Manager operational work

| Step | Action | Expected |
|---|---|---|
| 1 | Ring up a sale at `/pos` | Requires an open register first (§6.1) |
| 2 | Open `/sales`, pick a completed sale, **Void** it | **Succeeds** — Manager can void |
| 3 | Check stock after the void | **Restored** to pre-sale level |
| 4 | Check `/admin/inventory/movements` as Owner | A reversing movement exists |
| 5 | Edit a customer at `/customers` | Allowed (Manager+) |
| 6 | Open `/products`, find a product | Read-only; **no cost price, no margin** |
| 7 | Try to reach a product edit form | Not offered; direct API write 403s |

### 5.4 ⚠ Expected inconsistency — Customer Profile

`/customers/:id` sits **outside** `OwnerRoute` (so the Manager's route guard
lets them in), but the API behind it — `GET /customers/:id/profile` — is
`requireRole("OWNER")`.

**Expected:** the page loads but the profile data fails to populate (403 in the
Network tab). This is a real seam between the route guard and the API guard.
Worth logging as a finding, but the *security* boundary held — the manager got
no owner data. Note it and move on.

---

## 6. CASHIER — full pass

Log in as `9876511111` / `Cashier@123` in a **third browser profile**. You land
directly on `/cashier/pos`.

The cashier shell has exactly **four** destinations. Anything else is blocked.

### 6.1 Open the register — mandatory first step

`My Register` (`/cashier/register`)

| Step | Action | Expected |
|---|---|---|
| 1 | Try to check out **before** opening a register | **Refused**: *"No cash register session is open."* (`REGISTER_NOT_OPEN`) |
| 2 | Open the register with an opening float (e.g. 2000) | Session opens; opening balance recorded |
| 3 | Reload | Session persists |

⚠ This is enforced because `enforceRegisterSession` defaults to **ON**, and a
missing setting **fails closed** by design. If you want to test the no-till path,
turn it off in Store Settings as the Owner — but test the enforced path first.

### 6.2 POS checkout — the core flow

`POS Checkout` (`/cashier/pos`)

| Step | Action | Expected |
|---|---|---|
| 1 | Scan/type barcode `890100000001` | Product added to cart |
| 2 | Search a product by name | Found; add to cart |
| 3 | Change quantity | Line total updates |
| 4 | Add a second product | Cart totals update |
| 5 | Apply a line discount | Total drops |
| 6 | Apply a cart-level discount | Total drops |
| 7 | Checkout **without** selecting a customer | Resolves to **Walk-In Customer** |
| 8 | Pay **CASH** with tendered > total | Change calculated correctly |
| 9 | Complete the sale | Invoice number issued using your `INV-` prefix |
| 10 | Print/preview receipt | Store details from §4.2 appear |
| 11 | Check stock as Owner | **Decremented by exactly the qty sold** |
| 12 | Check `/admin/inventory/movements` | A `SALE` movement row |

Repeat checkout for **every payment method** — each must record correctly and
show up in `/admin/finance/payments`:

| Method | Test |
|---|---|
| CASH | Change calculation; **drawer balance increases** |
| UPI | Reference field captured; drawer balance **unchanged** |
| CARD | Captured; drawer **unchanged** |
| CREDIT | Requires a named customer (not Walk-In); customer balance increases |
| GIFT_CARD | Captured |
| OTHER | Captured |
| **Split** (e.g. 500 CASH + rest UPI) | Both legs recorded; only the cash leg hits the drawer |

⚠ Only the **cash** leg touches the physical drawer. Non-cash tenders still write
a shift activity, but with amount 0. A drawer that moves on a UPI sale is a bug.

### 6.3 Customer flows at POS

| Step | Action | Expected |
|---|---|---|
| 1 | Create a new customer during checkout | Created; attached to the sale |
| 2 | Look up a customer by phone | Found |
| 3 | Sell to them | Their purchase history updates |

### 6.4 Exchange / return

| Step | Action | Expected |
|---|---|---|
| 1 | Start an exchange against a completed sale | Eligibility checked |
| 2 | Return one item, issue a different one | Stock: returned item **+1**, issued item **−1** |
| 3 | Settle the price difference | Correct amount collected/refunded |
| 4 | Check movements as Owner | Both legs logged |

### 6.5 What the Cashier must NOT be able to do

Type each into the address bar — **all must redirect to `/cashier/pos`**:

```
/                /sales          /customers      /products
/admin/products  /admin/finance  /admin/reports  /admin/settings
/register        /labels         /sync           /categories
```

Then verify the backend:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876511111","password":"Cashier@123"}' \
  | grep -o '"token":"[^"]*"' | sed 's/"token":"//; s/"$//')

for ep in /owner/products /finance/dashboard /reports/sales /employees /manager/products; do
  printf "%-24s " "$ep"
  curl -s -o /dev/null -w "%{http_code}\n" \
    "http://localhost:3000/api/v1$ep" -H "Authorization: Bearer $TOKEN"
done
```

**All five must return 403.**

Also confirm in the UI:

| Step | Action | Expected |
|---|---|---|
| 1 | Find a **Void** button in the cashier's sale view | **Must not exist.** Cashiers cannot void — the API is `requireRole("MANAGER")` |
| 2 | Open `/cashier/register/history` | **Only their own shifts** — never another cashier's |
| 3 | Open the notifications bell | Opens `/cashier/notifications`; **only their own**, no Preferences tab |

⚠ Step 2 and 3 are **permanent security tests**, not feature tests — a real IDOR
shipped in notifications once. If a cashier can see another person's shifts or
notifications, stop and report it.

### 6.6 Close the register

`My Register` → Close

| Step | Action | Expected |
|---|---|---|
| 1 | Open the close preview | Expected cash = opening float + cash sales − payouts + drops |
| 2 | Enter a **matching** counted amount | Variance 0 |
| 3 | Close | Session closed |
| 4 | Open a new session, sell, then close with a **deliberate mismatch** (e.g. 100 short) | Variance **−100** recorded, flagged |
| 5 | Open `/cashier/register/sessions/:id` | Full shift summary: sales, tenders, drops, variance |
| 6 | Try to **sign off your own shift** | **Blocked** — the service refuses self-sign-off regardless of role |

### 6.7 Drops and payouts (Manager/Owner)

As **Manager** at `/register/movements`:

| Step | Action | Expected |
|---|---|---|
| 1 | Record a cash **drop** (to safe) | Drawer balance decreases |
| 2 | Record a **payout** (petty cash) | Drawer balance decreases; reason captured |
| 3 | Reconcile a cashier's closed shift | Allowed (Manager+); **cashier cannot** |

---

## 7. Cross-role combination matrix

Run these last — they catch the bugs single-role testing misses.

| # | Scenario | Expected |
|---|---|---|
| 1 | Cashier sells → Owner checks Finance | Revenue matches to the rupee |
| 2 | Cashier sells → Manager voids → Owner checks stock | Fully restored; both movements logged |
| 3 | Owner archives a product → Cashier searches it at POS | **Not sellable** |
| 4 | Owner sets a discount → Cashier adds that product | **Discounted price** applied at POS |
| 5 | Owner drops stock to 0 → Cashier tries to sell it | Refused: *"Insufficient stock"* |
| 6 | Cashier sells the last unit → Owner opens Out of Stock | Product appears |
| 7 | Owner deactivates the Cashier mid-session → Cashier acts | Session rejected; forced logout |
| 8 | Owner changes Cashier's password → Cashier's old session | Invalidated (token version bump) |
| 9 | Owner promotes Cashier → Manager → they log in again | Lands on `/`, not `/cashier/pos` |
| 10 | Two roles edit the same customer concurrently | Last write wins, both audit-logged |
| 11 | Cashier opens a register → Manager tries to open the same register number | Blocked / separate session |
| 12 | Owner changes invoice prefix mid-day → Cashier sells | Numbering continues correctly per prefix |
| 13 | Manager prints labels → Owner checks the queue | Job visible to both |
| 14 | Cashier sells on CREDIT → Owner checks receivables | Customer balance reflects it |
| 15 | Owner records a supplier payment → checks payables | Balance decreases |
| 16 | Every role opens Notifications | Each sees **only their own**; only Owner sees Preferences |
| 17 | Owner performs 10 actions → opens Audit Logs | All 10 attributed to the Owner with correct severity |

---

## 8. Session, auth and edge cases

| # | Test | Expected |
|---|---|---|
| 1 | Log in with **email** instead of phone | Works — either identifier, exactly one |
| 2 | Send both email and phone | Rejected by validation |
| 3 | Wrong password ×5 rapidly | Rate limiter kicks in (`authLimiter` on `/auth/login`) |
| 4 | `POST /api/v1/auth/setup` now | **409 Conflict** — one-time setup is disabled once an employee exists |
| 5 | Let a session expire | Session-expired modal appears, not a silent redirect |
| 6 | Log out, press **Back** | Cannot return to an authed page |
| 7 | Log in as Owner, then visit `/login` | Redirected to `/` (GuestRoute) |
| 8 | Hard-refresh deep on `/admin/inventory/stock` | Page restores; **no white flash**, no bounce to the previous section |
| 9 | Hit any unknown URL, e.g. `/nonsense` | 404 page |
| 10 | Two roles in the same browser profile | Second login replaces the first — **use separate profiles** |
| 11 | Tamper with the JWT in localStorage | Rejected; forced to login |
| 12 | Stop the API mid-session, click around | Graceful errors, not a blank screen |

---

## 9. Known-correct behaviours — do NOT file these as bugs

Every one of these is deliberate and documented:

1. **Backup & Restore is a placeholder.** A deliberate non-build.
2. **Barcode Settings redirects** to `/admin/labels?tab=barcode`. Barcode config
   is owned by the Label Engine; a second screen would be a second source of truth.
3. **`/finance/register` redirects** to `/register`. Legacy bookmark path.
4. **Manager sees no salary column.** Stripped server-side by actor.
5. **Manager sees no cost price or margin.** Same reason.
6. **Customer purchase history can sum to more than lifetime spend.** The history
   tab lists *every* sale status; the spend rollup counts **completed** only.
7. **Fast/Slow Moving and most Reports are empty until you have sales.**
8. **Notification channel delivery (email/SMS/push) does nothing.** Documented TODO —
   in-app notifications work.
9. **Cashier has no Void button.** By design.
10. **Manager's `/customers/:id` loads but the profile data 403s.** The route
    guard and the API guard disagree on this one path (§5.4) — a real seam, but
    no data leaked.

---

## 10. Result template

```
Module          Role     Screen/Action        Result   Notes
──────────────────────────────────────────────────────────────
Settings        OWNER    Store Settings       PASS
Categories      OWNER    Create/Archive       PASS
Products        OWNER    9-step wizard        PASS
Purchases       OWNER    Partial receipt      PASS
POS             CASHIER  Cash sale            PASS
Register        CASHIER  Open/Close           PASS
RBAC            MANAGER  /admin/finance       PASS     → /unauthorized
RBAC (API)      MANAGER  GET /finance/dash..  PASS     403
...
```

**Priority order if you are short on time:**

1. §5.2 and §6.5 — the RBAC boundaries (both UI *and* API). Highest severity.
2. §6.1–§6.2 — POS checkout and register enforcement. The system's core purpose.
3. §4.6 — partial goods receipt. The most intricate stock path.
4. §7 — the cross-role matrix. Where integration bugs hide.
5. Everything else.

---

## 11. Resetting again

To return to this exact baseline at any point:

```bash
cd SERVER
node scratch/reset-db.mjs --yes
npm run db:seed
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')" \
  npx tsx scripts/ensure-walkin.ts
node scratch/seed-attributes.mjs
```

⚠ `reset-db.mjs` deletes **all business data** and requires `--yes`. It does not
touch `_prisma_migrations`, so no migration is needed afterwards.

⚠ Your `DATABASE_URL` points at Neon endpoint `ep-frosty-moon-at71qpbs`, which
`scripts/check-db-target.mjs` classifies as **production**. Every other
destructive script in this repo (`clean-e2e-residue.mjs`, the stress harnesses)
**refuses to run against it**. `reset-db.mjs` does not have that guard because
you explicitly asked for this database to be wiped. If this endpoint ever holds
real data, point `.env` elsewhere before running any of the above.
