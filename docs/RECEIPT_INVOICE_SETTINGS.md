# Receipt & Invoice Settings

Document numbering and printed-receipt content.

Route `/admin/settings/receipt`. **OWNER only.**

Built 2026-08-03. The **second** screen on the centralized settings architecture,
and the one that proves it: the page contains no data fetching, no dirty
tracking, no patch diffing and no version-conflict handling. All of that comes
from `useSettingsForm`.

**No schema change, no migration, no new endpoint.** `invoiceConfig` was already
carried by `GET/PATCH /configuration` and already typed in `features/settings`.

---

## 1. What this module is

| | |
|---|---|
| Route | `/admin/settings/receipt` |
| Access | OWNER only (`OwnerRoute` + `requireRole("OWNER")` on `/configuration`) |
| Owns | The `invoiceConfig` block, and only that block |
| API | The existing `GET/PATCH /api/v1/configuration` |
| New client code | One page, one validator, one preview util, two option lists |
| Chunk cost | `settings` grew 35 kB → 44 kB (9.7 → 11.7 kB gzip) for a whole second screen |

That last row is the point. A second settings screen cost ~2 kB gzipped because
it reuses the hooks and primitives rather than restating them.

---

## 2. ⚠ The settings that did nothing

**The most important change in this milestone is on the server, not the screen.**

`invoiceConfig.invoicePrefix` and `invoiceConfig.invoiceNumberLength` had existed
in the settings document since the schema was written. **Nothing read them.**
`InvoiceService.generateNextInvoiceNumber` hardcoded `INV-` and a 6-digit
sequence.

Shipping a settings screen over those fields would have been worse than shipping
nothing: an owner would set a prefix, save successfully, see it persist, and
watch every invoice keep coming out as `INV-…`. So the generator was wired to
configuration first, and the screen built second.

### 2.1 What changed in the generator

```
{PREFIX}-{YYYYMMDD}-{SEQUENCE}          ← format unchanged
```

- Prefix and sequence width now come from `ConfigurationEngine.getInvoiceSettings()`.
- **Stock settings reproduce the previous output byte-for-byte** (`INV`, 6) —
  asserted by the first test in `invoiceNumbering.test.ts`.
- The day's last-number lookup now filters on `saleNumber startsWith prefix`, not
  only on the date. See §2.2.
- Falls back to the historical constants if the engine is uninitialised, so a
  seed script or a unit test can never fail for want of a cache — and neither can
  a sale.

### 2.2 Why a mid-day prefix change is safe

Because the lookup is scoped to the **full prefix**, changing `INV` → `BILL` at
noon means:

- the afternoon starts a fresh sequence at `BILL-20260712-000001`;
- the morning's `INV-20260712-000041` keeps its number;
- both are unique, so the `saleNumber` unique constraint still holds;
- nothing is renumbered.

Had the lookup filtered only on the date, the first `BILL` invoice would have
continued the `INV` sequence — harmless — but a change *back* to `INV` later the
same day would have collided with an existing number and thrown P2002 on commit.

Narrowing the sequence width mid-day is safe for a related reason: `padStart`
only pads, never truncates, so a sequence that has outgrown the configured width
simply gets longer rather than colliding.

---

## 3. What is wired, and what is only stored

A settings screen that offers fields nothing reads invites someone to configure a
receipt footer and wonder why it never prints. Each field on this screen states
its status **in the UI**, not just here.

| Field | Status |
|---|---|
| `invoicePrefix`, `invoiceNumberLength` | **LIVE.** Read on every sale (§2). |
| ~~`barcodeFormat`~~ | ⚠ **RETIRED 2026-08-03.** This row previously said "LIVE — read by the Label Engine for product labels". **That was false; nothing read it.** The Label Engine resolves symbology from `PrinterSetting.barcodeSymbology`, so changing this control printed identical labels. The control is gone and the section now links to `/admin/labels?tab=barcode`. The Zod field is retained as deprecated for backward compatibility. See [BARCODE_SETTINGS.md §2](./BARCODE_SETTINGS.md). |
| `exchangePrefix`, `purchasePrefix` | Stored. Exchange and purchase numbering still derive their own formats. |
| `receiptHeader`, `receiptFooter`, `qrCodeEnabled` | Stored. Consumed when the receipt renderer is built — the "Future Expansion" block in `invoice.service.ts` names these as the fields it should read. |
| `financialYearReset` | Stored. Pairs with `storeConfig.financialYearStart`. |

---

## 4. Architecture reuse

This screen is the worked example for
[STORE_SETTINGS.md §9.1](./STORE_SETTINGS.md) — one settings infrastructure,
extended rather than duplicated.

What it **did not** write:

- No API call. `GET/PATCH /configuration` already carried `invoiceConfig`.
- No query, mutation, or cache key. `useSettings` / `useUpdateSettings`.
- No dirty tracking, diffing, or unsaved-changes guard. `useSettingsForm`.
- No `expectedVersion` handling. It comes free with the hook — §9.2's requirement
  is satisfied by *using* the hook, and would be lost by hand-rolling a mutation.
- No layout primitives, skeleton, or error state.

What it **did** write: a page, a validator, a preview helper, two option lists,
and two `CRITICAL_FIELDS` entries.

### 4.1 The one thing that was extended, not duplicated

`CRITICAL_FIELD_LABELS` moved out of `CriticalChangeDialog.tsx` into
`validation/criticalLabels.ts` so it sits beside `CRITICAL_FIELDS` and can be
imported by a node-environment test without pulling in React. A test now asserts
every critical field has both an explanation and a label — adding one without the
other is the easy half of the mistake, and its only symptom is a dialog asking
someone to approve `invoiceConfig.invoicePrefix`.

That is the sanctioned move when a screen needs something the shared layer lacks:
**extend the shared layer so every screen gets it.**

---

## 5. Validation

Client rules mirror the server's `invoiceConfigSchema`, with two additions the
server does not enforce:

| Rule | Why |
|---|---|
| Prefixes are `[A-Z0-9]+` | The number is `PREFIX-DATE-SEQUENCE`; an embedded `-` makes the segments ambiguous when the sequence is parsed back out. Whitespace and punctuation also break thermal printers and CSV exports. |
| Invoice ≠ exchange prefix | Not required by the server, but sharing one makes two document types indistinguishable on a printed page — which is the only reason the prefix exists. |

Both are UX guardrails. The server remains the enforcement point.

### 5.1 The preview must mirror the server

`previewInvoiceNumber()` renders a value the **server** composes. If it drifts
from `generateNextInvoiceNumber`, the screen confidently shows a number the
system will never issue.

The two are pinned from both sides:
`CLIENT/.../__tests__/receipt.test.ts` and
`SERVER/src/utils/__tests__/invoiceNumbering.test.ts` assert the same format for
the same inputs. **Change one, change both.**

The preview always shows sequence 1 — the real next value depends on how many
sales the store has made today, which this screen does not know and should not
fetch. The *shape* is what is being configured.

---

## 6. Tests

| Suite | Tests | Covers |
|---|---|---|
| `SERVER/.../invoiceNumbering.test.ts` | 10 | Byte-for-byte compatibility under stock settings; configured prefix/width; prefix-scoped lookup; mid-day prefix change; width narrowing without truncation; malformed sequence; date zero-padding; uninitialised-engine fallback |
| `CLIENT/.../receipt.test.ts` | 15 | Prefix character rules, length bounds, duplicate-prefix rule; preview format, mid-edit fallbacks, clamping |
| `CLIENT/.../validation.test.ts` | +1 | Every critical field has a dialog label |

Totals after this milestone: **376 server**, **210 client**, 0 failing.
`npx tsc --noEmit` is clean on both trees.

---

## 7. Before changing this module

1. **Do not add a field here that nothing reads without labelling it as
   stored-only.** §3. The table above is the contract with the user.
2. **The preview and the generator are one format in two places.** §5.1.
3. **Do not hand-roll a mutation.** You lose `expectedVersion` and the 409
   handling with it. [STORE_SETTINGS.md §9.2](./STORE_SETTINGS.md).
4. **When wiring `exchangePrefix` / `purchasePrefix`,** scope their
   last-number lookups to the full prefix the way §2.2 describes, or a prefix
   change becomes a P2002 waiting to happen.
