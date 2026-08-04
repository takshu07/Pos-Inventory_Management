# Barcode Settings

Symbology, printed size, print quality, and when barcodes are produced.

Route `/admin/labels?tab=barcode`. **OWNER only.**

Resolved 2026-08-03. **This milestone deliberately did not build a settings
screen.** Barcode configuration was implemented as a section of the Label
Engine, and `/admin/settings/barcode` redirects into it.

**No schema change, no migration, no new endpoint.**

---

## 1. The scope decision

The open question from [MODULE_STATUS.md §8](./MODULE_STATUS.md) was whether
Barcode Settings is a standalone screen or part of the Label Engine. The
investigation answered it decisively: **every barcode concern already had an
owner, and that owner was the Label Engine.**

| Concern | Already owned by | Location |
|---|---|---|
| Symbology selection | `PrinterSetting.barcodeSymbology` | `schema.prisma` → `printer_settings` |
| Encoding to geometry | Barcode Engine registry | `engines/label/barcode/barcode.engine.ts` |
| Per-template override | `LabelTemplate.barcodeSymbology` | `labelTemplate.service.ts` |
| Label size & margins | `PrinterSetting.default*Mm` | `printer_settings` |
| Print quality | `PrinterSetting.darkness` / `printSpeed` | `printer_settings` |
| Which symbologies exist | `listSymbologies()` | `barcode.engine.ts` |

A standalone screen would have had to either write to `printer_settings` from
outside the module that owns it, or introduce a second store for the same
value. Both are the same mistake in different clothes.

**Decision: Barcode Settings is a tab in the Label Engine, not a screen.**

---

## 2. ⚠ The setting that did nothing

**The most important change in this milestone is a deletion.**

`invoiceConfig.barcodeFormat` was a two-option select (`CODE128` | `EAN13`) in
Receipt & Invoice Settings. It was validated, persisted, audited, and typed on
both sides.

**Nothing read it.** Not one consumer, anywhere in the codebase.

The Label Engine resolves symbology from `PrinterSetting.barcodeSymbology`:

```
LabelService.resolveOptions        label.service.ts:159
  → settings.barcodeSymbology              (PrinterSetting)
  → labelDataResolver.resolveOne           labelData.resolver.ts:163
  → barcodeEngine.resolveSymbologyForValue barcode.engine.ts:126
```

So an owner could open Receipt & Invoice Settings, switch Barcode Symbology to
EAN-13, save successfully, see it persist across a reload — and every label
would carry on printing precisely as before.

That is the exact failure mode the Receipt & Invoice page header was written to
prevent. Worse, the header **claimed the field was wired**:

```
 *   • barcodeFormat → read by the Label Engine for product labels.   ← FALSE
```

The comment asserted a consumer that did not exist, which is how the field
survived a review.

### 2.1 Why it was retired rather than wired

Wiring `barcodeFormat` into the Label Engine was rejected as the fix. It offers
two symbologies; the engine supports eight. Making it authoritative would have
**narrowed** a working capability and inverted module ownership so that the
invoice block dictated label behaviour.

---

## 3. What "retired" means precisely

| Layer | Action | Why |
|---|---|---|
| Receipt & Invoice UI | Control **removed**, replaced by a link to the Label Engine | A dead control is worse than no control |
| `BARCODE_FORMAT_OPTIONS` | **Deleted** | Orphaned; options now come from live server capabilities |
| Client type `InvoiceConfig` | Kept, marked `@deprecated` | The server still returns the key |
| Server Zod schema | Kept, marked `@deprecated` | See below |

**The Zod field was deliberately NOT removed.** Every stored configuration
document already contains `barcodeFormat`, and older clients still PATCH it.
Dropping it from the schema would make those requests `400`, and the merge
would strip the key from stored documents. It validates and persists; it simply
has no consumer. Remove it only in a release that also migrates stored
documents.

---

## 4. Active vs. reserved

The brief required active and future settings to be distinguishable. Every
control on the Barcode tab is **live** — it is read on the next print. The
reserved items are the symbologies themselves:

| Symbology | Status | Surfaced as |
|---|---|---|
| EAN-13, UPC, Code 128, Code 39, ITF-14 | **Active** | Selectable |
| QR, DataMatrix | **Reserved** | `— not available yet`, option disabled |
| NONE | Active | Selectable (suppresses the barcode) |

This is **not hardcoded in the client.** The server reports `isImplemented` per
symbology from `listSymbologies()`, so when QR lands the option stops being
disabled with no client change. Registering a symbology remains a one-line
registry addition (`barcode.engine.ts`).

One behaviour is shown as permanently on and not configurable: **automatic
fallback**. If the configured symbology cannot encode a value — an internal SKU
under EAN-13 — the engine falls back to Code 128. It is not a toggle because
disabling it can only ever produce labels that do not scan.

---

## 5. Architecture: data vs. presentation

`BarcodeSettings.tsx` lives in `features/labels` but renders with
`SettingsSection` / `SettingsRow` / `SettingsToggle` imported from
`features/settings`.

> **The Label Engine owns the data. The settings architecture owns the
> presentation.**

This satisfies the binding constraint in `features/settings/index.ts` — *do not
duplicate this infrastructure* — from the opposite direction to the one
anticipated. The primitives were reused by a module that is not a settings
screen, so an owner moving between Store Settings and this tab sees one product
rather than two.

Optimistic updates and rollback come from the Label Engine's existing
`useUpdateLabelSettings`, which already implements the snapshot-and-restore
pattern. No second mutation layer was introduced.

### 5.1 Why not `useSettingsForm`

`useSettingsForm` is bound to `GET/PATCH /configuration` and its `ConfigBlockName`
blocks. Barcode settings live in `printer_settings` behind
`GET/PATCH /labels/settings` — a different row, a different endpoint, a
different concurrency model. Forcing them through the settings hook would have
required either merging two unrelated tables or faking a block name.

The tab therefore uses the Label Engine's own hooks and the settings module's
primitives. Both reuse paths are honoured; neither is bent.

---

## 6. Routing and navigation

```
/admin/settings/barcode  →  redirect  →  /admin/labels?tab=barcode
```

The route was **kept rather than deleted** because the sidebar entry and any
existing bookmark point at it. The sidebar keeps the label "Barcode Settings" —
the name owners search for — and its `comingSoon` badge was removed.

`LabelSettingsPage` now holds its active tab in the URL (`?tab=`) rather than
local state, so the redirect can land on the right tab. Tabs became linkable
and back-button-correct as a side effect. An unknown `tab` value falls back to
the default view rather than erroring.

---

## 7. Tests

| Suite | Tests | Pins |
|---|---|---|
| `SERVER/src/engines/__tests__/barcode.engine.test.ts` | 11 | Geometry-not-images, EAN-13 check digits, batch resilience, **automatic fallback**, capabilities payload shape, reserved-symbology flags |
| `CLIENT/src/features/settings/__tests__/barcodeOwnership.test.ts` | 11 | Deprecated key stays **readable** and still round-trips, is `readonly` so writes are a compile error, no screen writes **or imports** it, options constant gone, redirect wired, nav badge cleared |

The client suite reads source text (via Vite `?raw`, not `node:fs` — the app
tsconfig compiles `src` without Node types) rather than rendering. The failure
mode is a developer re-adding a `setField(…, "barcodeFormat", …)` control, which
a render test catches only if it queries that exact control; a source assertion
catches any reintroduction however it is labelled.

One guard exists because the mistake was actually made during this milestone: a
stale `import { BARCODE_FORMAT_OPTIONS }` survived deleting the export. It was
caught by `npm run build` (`tsc -b`, which uses `tsconfig.app.json` and its
`noUnusedLocals`) — **a bare `npx tsc --noEmit` picks up the root config and
does not flag it.** Verify with the build script, not bare `tsc`.

Both guards were **verified to fail** when the regression is reintroduced, not
merely to pass today.

---

## 8. What was not done

- **`qrCodeEnabled` was left alone.** It is receipt QR, not product barcode —
  a different surface with a different consumer (the unbuilt receipt renderer).
  It remains correctly marked "stored, not yet printed" on the receipt screen.
- **No `printer_settings` schema change.** Every field the tab edits existed.
- **QR / DataMatrix encoders were not implemented.** They stay declared and
  disabled; implementing them is a separate milestone.

---

## 9. Where the rules now live

The boundaries this milestone established are written up once, for every module,
in **[CONFIGURATION_OWNERSHIP.md](./CONFIGURATION_OWNERSHIP.md)**: the two
configuration stores, the "who reads it at runtime owns it" rule, the
presentation-vs-data reuse split, the deprecated-field policy, and the
`npm run verify` standard.

Read that before adding any configuration field or settings screen. This
document is the case study; that one is the rule.
