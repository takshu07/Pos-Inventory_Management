# Store Settings

The configuration surface for the whole business: store identity, trading rules,
regional formatting, UI defaults, security policy, and notification channels.

Route `/admin/settings`. **OWNER only.**

Built 2026-08-03. Reuses the existing `Settings` singleton and the existing
`GET/PATCH /configuration` endpoints. **No schema change and no migration** — the two
new configuration blocks are stored in columns the schema already declared but
nothing ever read. Every backend change is additive; no existing request shape
or response field was removed or altered.

This is the first screen built on the **centralized settings architecture**
(`CLIENT/src/features/settings`), which Receipt & Invoice Settings and Barcode
Settings are expected to reuse rather than reimplement.

---

## 1. What this module is

| | |
|---|---|
| Route | `/admin/settings` |
| Access | OWNER only (`OwnerRoute` + `requireRole("OWNER")` on both verbs) |
| Feature dir | `CLIENT/src/features/settings` (own lazy chunk, ~35 kB / 9.7 kB gzip) |
| API | `GET /api/v1/configuration`, `PATCH /api/v1/configuration` |
| Storage | The `settings` singleton row (`id = "singleton"`) |
| Migration | **None.** See §3. |

### 1.1 Why OWNER and not MANAGER

MANAGER is an **operational** role in this system. These settings set discount
ceilings that constrain managers themselves, session and lockout policy, audit
retention, and tax handling. Configuring the rules you operate under is business
administration, so both the read and the write are OWNER-only — as they already
were before this milestone. **No permission was widened by this work.**

The route guard and the sidebar are affordances. The boundary is
`requireRole("OWNER")` on the route tree; a tampered client gets a 403.

---

## 2. Sections

Six sections on one page. They are **not** split across tabbed routes because
the fields cross-reference each other — the discount ladder only makes sense
next to the maximum discount, the session timeout only next to the sign-in
duration — and those are precisely the relationships validation enforces. An
in-page section nav gives direct access without fragmenting the document.

| Section | Backing block | Notable fields |
|---|---|---|
| Store Information | `storeConfig` | Name, status, GST, address, contact, logo, business hours |
| Business Configuration | `pricingConfig`, `exchangeConfig`, `inventoryConfig` | Tax mode + rate, rounding, the discount ladder, exchange window, negative stock, low-stock threshold |
| Regional Preferences | top-level + `storeConfig`, `reportingConfig` | Currency, time zone, financial-year start, business-day hours |
| System Preferences | `systemConfig` *(new)* | Date/time format, number locale, landing page, density, page size |
| Security | `securityConfig` | Session timeout, sign-in duration, login attempts, lockout, audit retention |
| Integrations | `integrationConfig` *(new)* | Email/SMS/WhatsApp toggles, sender address, alert preferences |

`invoiceConfig` is deliberately **not** edited here — it belongs to Receipt &
Invoice Settings. The architecture already carries it; that screen only needs to
declare it in its `blocks` list.

---

## 3. Backend changes — all additive

### 3.1 The two new blocks reuse existing columns

`systemConfig` and `integrationConfig` are **logical** names. They persist to
`customerConfig` and `notificationConfig`, two `Json @default("{}")` columns the
`Settings` model has always declared but which no engine getter ever read.

```
systemConfig       →  settings.customerConfig
integrationConfig  →  settings.notificationConfig
```

Adding real columns to a singleton table would have required a migration against
a live database for what is, in one case, purely UI state. Reusing columns that
are provably empty everywhere avoids that. `notificationConfig` is not an
arbitrary choice: `notification.engine.ts` already reserves it for exactly this
purpose in its commented-out `getNotificationSettings()` calls.

The mapping lives in **one place** —
`COLUMN_FOR_BLOCK` in `SERVER/src/services/configuration.service.ts`. The engine
getters, the API payload and the entire client see only the logical names.

### 3.2 ⚠ The partial-update bug this milestone fixed

**This is the most important thing in this document.**

Each `*Config` column is a single JSON document, and the previous service
assigned the incoming patch straight onto it:

```ts
if (payload.pricingConfig) updateData.pricingConfig = payload.pricingConfig;
```

Prisma writes that object to the **whole column**, so a `PATCH` carrying
`{ pricingConfig: { defaultTaxRate: 18 } }` deleted every sibling key — the
discount ladder, the rounding strategy, tax-inclusive pricing.

It did not fail loudly. The engine re-parses each block through a Zod schema
whose fields all have `.default()`, so the deleted keys came back as **stock
defaults**. A store with a 5% cashier discount cap silently reverted to shipped
values, with nothing logged and nothing thrown.

Two independent fixes were needed:

1. **Merge, don't assign.** `mergeConfigBlock` (`SERVER/src/utils/configMerge.ts`)
   reads the stored block and merges the patch over it key-by-key. Extracted to
   a util so the rule is unit-testable without a database.

2. **Strip defaults from the patch schema.** `.partial()` alone was not enough
   and this is subtle: in Zod, `.partial()` makes a key optional but **leaves its
   `.default()` in place**. Parsing `{ defaultTaxRate: 18 }` against a partialed
   pricing schema returned the tax rate *plus a default value for every other
   field*. The service cannot distinguish those from real input, so it would
   merge them over the stored block — reintroducing the exact bug the merge was
   added to fix. `toPatchSchema()` unwraps `.def.innerType` so absent stays
   absent.

Both are locked down by `SERVER/src/utils/__tests__/configMerge.test.ts`. If you
are reading this because that suite failed after a refactor, the test is right.

The merge is **shallow, deliberately**. Every field in every block is a scalar or
an array (`defaultExchangeReasons`); a recursive merge would make arrays
impossible to shorten, because removing an exchange reason would merge
index-wise and leave the old tail behind.

### 3.3 Cross-field rules are validated post-merge

`findConfigurationConflicts()` runs against the **merged** document, not the
request body. This is not stylistic: a `PATCH` that lowers only
`managerDiscountLimit` carries no `cashierDiscountLimit`, so a body-level check
sees one half of the pair and cannot tell whether the ladder is still ordered.

Rules enforced:

| Rule | Why |
|---|---|
| `cashier ≤ manager ≤ owner` discount limits | An inverted ladder makes POS approval escalation meaningless |
| every role limit ≤ `maximumDiscountPercent` | The pricing engine applies the ceiling last; a higher role limit is silently unreachable |
| `businessDayStartHour < businessDayEndHour` | Equal is also rejected — a zero-length day makes every business-day report empty with no obvious cause |
| `sessionTimeoutMins ≤ jwtExpirationHours × 60` | A session outliving its token strands the user mid-shift instead of at the configured timeout |

Violations return **400** with `details.conflicts` carrying *every* problem, not
just the first — otherwise fixing one reveals the next on the following attempt.

### 3.4 Optimistic concurrency (opt-in)

`PATCH /configuration` accepts an optional `expectedVersion`. When supplied and it no
longer matches the stored row, the write is refused with **409
`SETTINGS_VERSION_CONFLICT`** rather than silently overwriting a concurrent edit.

**Omitting it preserves the previous last-write-wins behaviour**, so any existing
caller is unaffected. The field is stripped in the controller before validation —
it is concurrency metadata, not configuration, and must never be persisted.

### 3.5 Emptied optional fields

`optionalText` / `optionalUrl` / `optionalEmail` accept `""` and normalise it to
`undefined`. A form sends `""` when the user wipes a field; rejecting it made
clearing a GST number impossible through the UI — the request 400'd instead. The
`.url()` / `.email()` check still runs whenever there is something to check.

---

## 4. Frontend architecture

The point of this feature dir is that **the next two settings screens should not
need new data-layer code**.

```
features/settings/
  api/settingsApi.ts        GET/PATCH + typed error-reason helpers
  hooks/useSettings.ts      query, mutation, optimistic patch, cache invalidation
  hooks/useSettingsForm.ts  ← the shared editing engine
  hooks/useStoreConfig.ts   how the REST of the app consumes configuration
  components/SettingsPrimitives.tsx  Section / Row / Toggle / SaveBar
  components/SettingsStates.tsx      skeleton + error/403 states
  components/CriticalChangeDialog.tsx
  components/SettingsSync.tsx        pushes currency into global formatters
  validation/index.ts       mirrors the server rules; CRITICAL_FIELDS
  utils/options.ts          shared select vocabularies
```

### 4.1 To build another settings screen

1. `useSettingsForm({ blocks: ["invoiceConfig"], validate })` — loading, dirty
   tracking, minimal-patch diffing, version-conflict handling and the
   unsaved-changes guard all come with it.
2. Lay fields out with `SettingsSection` / `SettingsRow` / `SettingsToggle`, so
   it matches the other screens by construction.
3. `SettingsSaveBar` to commit; `CriticalChangeDialog` if any field belongs in
   `CRITICAL_FIELDS`.
4. `SettingsSkeleton` / `SettingsErrorState` for the non-happy paths.

Nothing new is needed in the API or hook layer — the endpoints already carry
every block.

### 4.2 Draft editing, not write-through

Edits accumulate in a local draft and commit on an explicit Save. These fields
are business rules: typing "1" on the way to "15" in the manager discount limit
must not momentarily save a 1% cap, and a half-typed GST number must never reach
the server. `saveField()` exists for controls where the interaction *is* the
decision (a lone toggle) and is still version-checked.

The diff sends **only changed fields**. Sending a whole block would work, but
would record every field as changed in the audit log on every save — so nobody
could later tell who actually altered the tax rate.

### 4.3 Confirmation is reserved, not universal

Only fields in `CRITICAL_FIELDS` open `CriticalChangeDialog`. Confirming
everything trains people to click through without reading. The test is not "is
this important" but **"would a mistake here be silent and costly"**: a wrong
`itemsPerPage` is obvious immediately and self-corrects; a wrong `taxInclusive`
misprices every sale until somebody reconciles the books.

The dialog names each change and states its consequence rather than asking "Are
you sure?" — that question cannot be answered without the first.

---

## 5. How configuration propagates

### 5.1 Server side (unchanged, and this is the point)

Settings already drive live business rules through `ConfigurationEngine`:

| Consumer | Reads |
|---|---|
| `pricing.engine.ts` | `pricingConfig` — tax, rounding, discount ceilings |
| `sale.service.ts` | `pricingConfig` |
| `customer.service.ts`, `utils/exchangeWindow.ts` | `exchangeConfig.exchangeWindowDays` |
| `inventory.service.ts` | `inventoryConfig` |
| `label/labelData.resolver.ts` | `storeName`, `currency`, `storeConfig` |
| `workforce.service.ts`, `discountRule.validation.ts` | `timeZone` |

On write the service calls `invalidateCache()` + `init(true)`, so the engine
reloads from the row that was actually persisted. **None of these consumers
changed** — they read the same getters they always did.

### 5.2 Client side

`useUpdateSettings` invalidates the caches derived from configuration
(`CONFIG_DEPENDENT_KEYS`: products, sales, exchange, inventory, dashboard,
reports, labels) **after** the server confirms, never optimistically.

`formatCurrency` is called from ~650 places, many of which are not components at
all (chart tick formatters, table column definitions, CSV builders) and so cannot
consume a hook. Rather than refactor every call site, `SettingsSync` — mounted
once in `AppProvider` — pushes the configured currency and number locale into the
formatter module. **Every existing call site picks up a currency change without
being touched.**

### 5.3 ⚠ The known gap: non-OWNER sessions

`GET /configuration` is OWNER-only, so `SettingsSync` and every hook in
`useStoreConfig.ts` are **gated on the role** — an ungated query would fire a
guaranteed 403 on every cashier session.

For a MANAGER or CASHIER the formatters therefore keep their defaults, which are
written to mirror the server's Zod defaults exactly. **If the store's currency is
ever configured to something other than `INR`, cashier-facing screens will render
the default symbol** until the currency is exposed on a non-owner endpoint (e.g.
folded into the session payload).

This is a cosmetic degradation, never an incorrect amount: every total, tax
figure, discount ceiling and rounding decision is computed **server-side** from
`ConfigurationEngine` and arrives already correct. Widening who can read the
settings document is a security decision, not a formatting one, and was
deliberately left out of this milestone.

---

## 6. Tests

| Suite | Covers |
|---|---|
| `SERVER/src/utils/__tests__/configMerge.test.ts` | Merge preserves siblings; arrays replace wholesale; corrupt blocks; **the `.partial()` defaults leak**; every cross-field rule; post-merge conflict detection |
| `CLIENT/src/features/settings/__tests__/validation.test.ts` | Every validation rule, error-to-field mapping, critical-change detection |
| `CLIENT/src/features/settings/__tests__/patch.test.ts` | `applyPatch` mirrors the server merge; change counting |
| `CLIENT/src/utils/__tests__/formatters.test.ts` | Currency/locale propagation, invalid-input fallbacks |

Run: `npm run test:unit` (SERVER), `npm test` (CLIENT).

Per the client testing policy in `vitest.config.ts`, these are **pure logic**
tests. Component/DOM tests remain a separate infrastructure milestone and were
deliberately not bolted on here.

---

## 7. Things to know before changing this module

1. **Never assign a config block; always merge.** §3.2. This is the failure mode
   that reverts a store's business rules with no error.
2. **Never use `.partial()` on a config schema for a patch.** Use
   `toPatchSchema()`. §3.2.
3. **Cross-field rules must run post-merge.** §3.3.
4. **`systemConfig` and `integrationConfig` are not their column names.** §3.1.
5. **Client validation is UX, not enforcement.** Every rule is re-checked
   server-side. When one changes, change both — they can drift independently.
6. **Do not put credentials in `integrationConfig`.** The settings row is
   returned in full to any OWNER and is copied verbatim into the audit log.
   Secrets belong in environment variables; the schema models booleans and
   non-secret addresses only.

---

## 8. TODO — public read-only store configuration

**Status: planned, additive, not built.** Tracked in
[MODULE_STATUS.md §3](./MODULE_STATUS.md).

### 8.1 The problem

`GET /configuration` is OWNER-only and must stay that way — it returns security
policy, discount ceilings, audit retention and integration wiring. But three of
its fields are pure presentation and are needed by **every** role:

```
currency                    e.g. "INR"
timeZone                    e.g. "Asia/Kolkata"
systemConfig.numberLocale   e.g. "en-IN"
systemConfig.dateFormat     e.g. "DD-MM-YYYY"
systemConfig.timeFormat     e.g. "12H"
```

Because a cashier cannot read them, `SettingsSync` and the `useStoreConfig`
hooks are role-gated and fall back to defaults (§5.3). A store configured to
`AED` shows `₹` on every cashier screen.

The amounts themselves are always correct — they are computed server-side from
`ConfigurationEngine` and arrive formatted-agnostic — so this is a **display
inconsistency, not a correctness bug**. That is why it was deferred rather than
solved by widening access to the full document.

### 8.2 The shape

Additive. Changes nothing that exists.

```
GET /api/v1/configuration/public        authenticate, NO requireRole
```

```jsonc
{
  "currency": "INR",
  "timeZone": "Asia/Kolkata",
  "storeName": "CEX Fashion",     // already on receipts the cashier prints
  "dateFormat": "DD-MM-YYYY",
  "timeFormat": "12H",
  "numberLocale": "en-IN",
  "version": 12                    // so the client can cache on it
}
```

### 8.3 ⚠ Rules for whoever builds it

1. **Positive allowlist, never a deletion.** Build the response by naming the
   fields to include. Do NOT take the full configuration and strip keys — the
   next field added to `securityConfig` would silently join the public payload.
   A test must assert the response has exactly the expected key set.
2. **`authenticate` yes, `requireRole` no.** It is not anonymous; it is
   any-authenticated-role. Do not mount it before the auth middleware.
3. **Read-only.** No PATCH counterpart. Writes stay OWNER-only on `/settings`.
4. **Serve it from `ConfigurationEngine`,** like `GET /configuration` does — it is a
   memory read, not a query, so it can be called on every session boot.
5. **`storeName` is in and nothing else from `storeConfig` is.** A cashier
   already prints it on receipts. Address, GST, phone and email are business
   identity — leave them out until something concretely needs them.

### 8.4 Client changes it unlocks

- `SettingsSync` drops its `isOwner` gate and uses the public endpoint.
- `useStoreConfig`'s hooks read whichever document is available, preferring the
  full one when the user is an OWNER (so a settings edit updates formatting
  live without a second fetch).
- The fallback constants stay. They are still the pre-load and
  endpoint-unavailable path, and they must keep mirroring the server's Zod
  defaults.

---

## 9. Binding constraints for future settings work

These are **decisions, not preferences.** They were set with the Store Settings
milestone (2026-08-03) and confirmed at review. Re-open them explicitly if
needed — do not drift from them by building around them.

### 9.1 One settings infrastructure

`CLIENT/src/features/settings` is the **single foundation for every settings
page**. Receipt & Invoice Settings, Barcode Settings and anything after them use
`useSettingsForm`, the `SettingsSection`/`Row`/`Toggle` primitives,
`SettingsSaveBar`, `SettingsSkeleton`/`SettingsErrorState`,
`CriticalChangeDialog` and the shared query/mutation layer.

**Do not duplicate settings infrastructure.** A second dirty-check, a second
patch differ, or a locally-defined settings row is how three screens end up with
three different unsaved-changes behaviours and only one of them correct. If a
screen needs something the shared layer lacks, **extend the shared layer** so
every screen gets it.

New screens should need **no new API or hook code** — the endpoints already
carry every block.

### 9.2 Optimistic concurrency is mandatory

Every settings screen sends `expectedVersion` and handles
**409 `SETTINGS_VERSION_CONFLICT`**. `useSettingsForm` does this automatically;
a screen gets it by using the hook, and loses it by hand-rolling a mutation.

The version is a property of the **whole settings document**, not of a block, so
two owners editing different screens still conflict — correctly. Both are
writing the same row.

### 9.3 Merge-based patches, always

Partial updates **merge**; they never replace a configuration block. This holds
on both sides of the wire:

- **Server:** `mergeConfigBlock` over the stored value, and `toPatchSchema()`
  (never `.partial()`) so absent keys stay absent. §3.2.
- **Client:** send only changed fields (`useSettingsForm`'s diff), and mirror the
  same merge in `applyPatch` for the optimistic update.

Replacing a block silently reverts every field the patch did not mention to its
Zod default. It throws nothing and logs nothing. §3.2 is the full account; the
regression suites in §6 exist to keep it fixed.
