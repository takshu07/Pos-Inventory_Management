# Configuration ownership boundaries

Which module owns which setting, and the rules for adding new ones.

Written 2026-08-03, after the Barcode Settings consolidation. **Read this before
adding any configuration field or settings screen.**

The system has **two independent configuration stores**. They look similar from
a screen, which is exactly why they get confused — and confusing them is how
`invoiceConfig.barcodeFormat` came to exist as a control that changed nothing
for months (see [BARCODE_SETTINGS.md §2](./BARCODE_SETTINGS.md)).

---

## 1. The two stores

| | **Store Configuration** | **Printer / Label Settings** |
|---|---|---|
| Table | `Settings` (singleton, JSON blocks) | `printer_settings` (singleton row) |
| API (server) | `GET/PATCH /api/v1/configuration` | `GET/PATCH /api/v1/owner/labels/settings` |
| API (client calls) | `/configuration` ✅ (was `/settings` — see §7) | `/owner/labels/settings` ✅ |
| Concurrency | Optimistic — `expectedVersion`, 409 on conflict | Last-write-wins, optimistic UI + rollback |
| Commit model | Draft → explicit **Save** | **Write-on-change** per control |
| Client data layer | `features/settings` (`useSettingsForm`) | `features/labels` (`useUpdateLabelSettings`) |
| Owns | Business rules, identity, policy | How bytes reach a printer |

**They are not merged, and must not be.** Different rows, different endpoints,
different concurrency models, different commit semantics. A single hook cannot
serve both without one side inheriting behaviour that is wrong for it.

---

## 2. Ownership table

### 2.1 Store Configuration (`features/settings`)

| Block | Owns | Screen |
|---|---|---|
| `storeConfig` | Identity, GST, address, hours, financial year | Store Settings |
| `invoiceConfig` | Document numbering, receipt content | Receipt & Invoice |
| `pricingConfig` | Tax, rounding, discount ceilings | Store Settings |
| `exchangeConfig` | Exchange window and its requirements | Store Settings |
| `inventoryConfig` | Stock thresholds, SKU generation, reservations | Store Settings |
| `securityConfig` | Sessions, lockout, JWT, audit retention | Store Settings |
| `reportingConfig` | Business day boundaries, dashboard period | Store Settings |
| `systemConfig` | Date/time/number presentation, density | Store Settings |
| `integrationConfig` | Channel toggles (never credentials) | Store Settings |

### 2.2 Label Engine (`features/labels`)

**The Label Engine is the single authoritative owner of ALL barcode and label
configuration.** No exceptions, and no second surface.

| Concern | Stored on | Edited at |
|---|---|---|
| Default symbology | `PrinterSetting.barcodeSymbology` | `/admin/labels?tab=barcode` |
| Per-template symbology | `LabelTemplate.barcodeSymbology` | Templates tab |
| Encoding → geometry | *(no storage — pure registry)* | `barcode.engine.ts` |
| Label size, margins | `PrinterSetting.default*Mm`, `margin*Mm` | Barcode / Defaults tabs |
| Print quality | `PrinterSetting.darkness`, `printSpeed` | Barcode tab |
| Output mode | `PrinterSetting.outputMode` | Defaults tab |
| Printer devices | `Printer` | Printers tab |
| Print workflow triggers | `PrinterSetting.printAfter*` | Barcode tab |

**Future barcode work extends this module.** QR and DataMatrix encoders, new
symbologies, printer capabilities and template overrides all belong here — a
new symbology is a one-line addition to the registry in `barcode.engine.ts` and
appears in the UI automatically, because the client builds its options from the
server's `listSymbologies()` capabilities payload. Adding a barcode setting
anywhere else is a bug, not a style preference.

---

## 3. The decision rule

> **Ask who READS the value at runtime. That module owns it.**

Not who might logically group it on a screen. `barcodeFormat` *looked* like it
belonged with invoice settings; the code that actually reads symbology lives in
the Label Engine, and the mismatch made the control inert.

Adding configuration:

1. **Find the consumer first.** If nothing reads it yet, either wire the
   consumer in the same milestone or label it "stored, not yet read" **in the
   UI** — not just in a comment. A comment claiming a consumer that does not
   exist is how the `barcodeFormat` bug survived review.
2. **Check for an existing owner.** If another module already stores something
   that answers the same question, extend that module.
3. **Only then** pick a block or table.

---

## 4. Presentation vs. data — the reuse rule

The shared settings **UI primitives** (`SettingsSection`, `SettingsRow`,
`SettingsToggle`, `SettingsSaveBar`, `SettingsSkeleton`, `SettingsErrorState`)
are presentation and may be imported by **any** module.

The settings **data layer** (`useSettingsForm`, `useSettings`, `applyPatch`,
`ConfigBlockName`) is bound to the `Settings` document and may be used **only**
by screens that own a block of it.

> **Reuse the primitives freely. Do not force unrelated data sources into the
> settings data layer.**

`BarcodeSettings.tsx` is the reference implementation: it lives in
`features/labels`, renders entirely with the settings primitives, and uses the
Label Engine's own hooks for data. The module owns the data; the settings
architecture owns the presentation.

**Why not just use `useSettingsForm` everywhere?** It assumes one versioned
document behind `/configuration`, with draft-then-Save and 409 conflicts.
Printer settings are a different row behind a different endpoint with
write-on-change semantics. Forcing them through would have required faking a
`ConfigBlockName` or merging two unrelated tables — either one reintroduces the
coupling this document exists to prevent.

---

## 5. Deprecated fields

Legacy configuration keys stay **readable** so stored documents and older
clients keep working, but must be **unwritable** by new code.

The enforcement is structural, not advisory:

```ts
// types/index.ts — InvoiceConfig
readonly barcodeFormat: "CODE128" | "EAN13";
```

`useSettingsForm.setField` is typed `FullConfiguration[B][K]`, so a `readonly`
key makes any write a **TS2540 compile error** — caught by `npm run build`
rather than by review. Deliberately asymmetric:

| Operation | Status | Why |
|---|---|---|
| Read the field | ✅ Allowed | Stored documents must stay readable |
| Legacy client PATCHes it | ✅ Allowed | `SettingsPatch` stays writable; would 400 otherwise |
| New code writes it | ❌ Compile error | The point of deprecating it |
| Server Zod schema | ✅ Retained | Removing it strips the key on merge and 400s old clients |

Remove a deprecated field entirely only in a release that also migrates stored
documents.

**Currently deprecated:** `invoiceConfig.barcodeFormat` (2026-08-03).

---

## 6. Verification standard

**Frontend changes are verified with `npm run build`, never with bare `tsc`.**

`npm run build` runs `tsc -b`, which uses `tsconfig.app.json` and its
`noUnusedLocals` / `noUnusedParameters`. A bare `npx tsc --noEmit` picks up the
**root** config and silently misses real errors — during the Barcode milestone
it passed a stale import of a deleted export, and it does not flag the TS2540
that enforces §5.

The standard is executable rather than remembered — each package has a `verify`
script, so a milestone ends with:

```bash
cd CLIENT && npm run verify   # tsc -b + vite build + vitest
cd SERVER && npm run verify   # tsc --noEmit + vitest
```

`CLIENT`'s `verify` runs the real `build`, so the `tsc -b` config is always the
one that gates a change. Do not substitute a bare `npx tsc --noEmit`.

Client tests must not import `node:fs` — `tsconfig.app.json` compiles `src`
without Node types. Use Vite `?raw` imports for source-text assertions
(see `barcodeOwnership.test.ts`).

---

## 7. ✅ FIXED — the Settings client called a route that did not exist

**Found 2026-08-03 while documenting §1; fixed and verified the same day.**

### 7.1 What was wrong

`settingsApi.ts` declared `const BASE = "/settings"`. With
`baseURL = http://localhost:3000/api/v1` (`config/env.ts`) that resolved to
`/api/v1/settings` — **a path the server has never mounted.**
`configuration.routes.ts` is mounted at `/api/v1/configuration` (`app.ts:225`),
and no rewrite, alias or proxy reconciled the two (the Vite proxy forwards
`/api` unchanged).

```
GET /api/v1/settings      → 404 {"message":"The requested endpoint does not exist."}
GET /api/v1/configuration → 401 {"message":"Authorization header is missing."}
```

The 401 proved the route existed and was merely unauthenticated; the 404 proved
the client's path did not exist at all. **Every read and write from Store
Settings and Receipt & Invoice Settings 404'd.** It predates and is independent
of the Barcode milestone.

### 7.2 The fix

One line — `const BASE = "/configuration"`. Nothing else changed: no hook, no
component, no server code. The module is named "settings" and the endpoint is
named "configuration"; that mismatch is what made the bug easy to write, so the
constant carries a comment telling the next reader not to "align" it to the
folder name.

### 7.3 End-to-end verification

Run against the live backend as an authenticated OWNER — **31 checks, 0
failures** — covering every operation the two screens perform:

| Area | Verified |
|---|---|
| Load | 200, envelope shape, all 9 config blocks, numeric `version` |
| Save | Store block and invoice block both persist; `version` increments |
| Partial merge | Sibling keys and untouched blocks survive a one-field PATCH |
| Conflict | Stale `expectedVersion` → **409 `SETTINGS_VERSION_CONFLICT`**, write not applied |
| Validation | Out-of-range value → **400**, write not applied |
| Cross-field | Inverted discount ladder → **400** |
| Error states | Unauthenticated → **401**; MANAGER read and write → **403** |
| Scalars | `storeName` saves |
| Regression | `GET /settings` still 404s, confirming the old path was genuinely dead |

The live configuration was captured before the run and restored afterwards;
a post-run diff confirmed it byte-identical to the baseline.

### 7.4 Regression tests

`CLIENT/src/features/settings/__tests__/settingsApi.test.ts` — 10 tests pinning
the endpoint (`/configuration`, never `/settings`), that the path stays relative
to `baseURL`, that the PATCH body and `expectedVersion` are sent verbatim, and
that the envelope is unwrapped exactly once. Reverting the constant fails 5 of
them.

This closes the gap that let the bug through: the settings suites previously
tested pure functions only and never asserted a request URL, unlike
`users/usersApi` and `audit/auditApi`.

### 7.5 Noted, not changed

The API cannot **clear** an optional field once set: `optionalText` maps `""` →
`undefined` (`configuration.validation.ts`) and `mergeConfigBlock` skips
`undefined`, so a `PATCH` can add or change an optional key but never remove it.
Removing one requires a direct database write plus a restart to drop the
`ConfigurationEngine` cache. This is existing behaviour, unrelated to the
routing fix, and was left alone.

---

## 8. Related

- [BARCODE_SETTINGS.md](./BARCODE_SETTINGS.md) — the consolidation and the retired field
- [STORE_SETTINGS.md](./STORE_SETTINGS.md) — the settings architecture itself
- [RECEIPT_INVOICE_SETTINGS.md](./RECEIPT_INVOICE_SETTINGS.md) — second consumer
- [MODULE_STATUS.md](./MODULE_STATUS.md) — what is built
