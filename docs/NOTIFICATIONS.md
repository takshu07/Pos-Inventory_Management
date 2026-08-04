# Notifications

Alerts about inventory, sales, employees and security — listed, filtered,
searchable, and markable.

Route `/notifications`. **Every authenticated employee.**

Built 2026-08-03, replacing the `PlaceholderPage`. **No schema change, no
migration, and no change to how notifications are written** — all 18 existing
dispatch sites are untouched.

---

## 1. What this module is

| | |
|---|---|
| Route | `/notifications` (outside `OwnerRoute`) |
| Access | Any authenticated employee; **Preferences tab is OWNER-only** |
| Feature dir | `CLIENT/src/features/notifications` (own lazy chunk) |
| API | `/api/v1/notifications` — 3 additive endpoints, 3 pre-existing |
| Schema change | **None** |

### 1.1 Why there is no role guard

Notifications are addressed to **a person or a role**, so the access boundary is
the **audience**, not the caller's rank. A cashier has notifications; hiding the
screen from them would hide alerts written for them.

The boundary is enforced in the repository: `audienceWhere(userId, role)` is
AND-ed into every query and every mutation, so a request can only ever touch
rows addressed to the caller, their role, or everyone. It is a single exported
predicate rather than a repeated inline clause precisely so the list, the counts
and the bulk actions cannot disagree about what a user can see.

The **Preferences** tab is the exception: it edits `integrationConfig`, which is
OWNER-only server-side, so it is not rendered for other roles rather than
showing a panel that would 403.

---

## 2. Category and severity are DERIVED, never stored

`notifications.type` is a free-text column already written by 18 call sites.
There is no `category` column and no `severity` column.

Adding them would have meant a migration, a backfill of every historical row,
and touching every writer — and any writer that forgot to set them would produce
uncategorised notifications forever. So both are derived from `type` in
`SERVER/src/constants/notificationTaxonomy.ts`:

| Category | Types |
|---|---|
| **INVENTORY** | `LOW_STOCK`, `OUT_OF_STOCK`, `NEGATIVE_STOCK`, `ADJUSTMENT_REQUESTED`, `LARGE_ADJUSTMENT`, `DAMAGED_INVENTORY`, `CYCLE_COUNT_COMPLETED`, `PURCHASE_RECEIVED`, `INVENTORY_EDITED` |
| **SALES** | `LARGE_SALE`, `HIGH_REFUND_RATE`, `LARGE_DISCOUNT` |
| **EMPLOYEES** | `ATTENDANCE_LATE`, `ATTENDANCE_ABSENT`, `EMPLOYEE_IDLE`, `TOP_PERFORMER` |
| **SECURITY** | `FAILED_LOGIN_ATTEMPTS`, `PASSWORD_RESET` |
| **SYSTEM** | *everything unmapped* — the fallback bucket |

This mirrors how Audit Logs derives severity from `action`: same problem, same
answer, same trade-off.

> ⚠ **Adding a new alert type?** Add it to `NOTIFICATION_TYPE_META` in the same
> change. An unmapped type still appears (it falls back to SYSTEM/INFO) but
> lands in the wrong bucket and cannot be filtered for. A test enumerates every
> dispatched type and **fails** if one is unmapped.

### 2.1 The SYSTEM asymmetry

Because SYSTEM means "not explicitly mapped", its filter cannot be an `IN` list.
`typeFilterForCategories` returns:

- a normal category → `{ type: { in: [...] } }`
- SYSTEM alone → `{ type: { notIn: allMappedTypes() } }`
- both → an `OR` of the two

Getting this backwards makes System notifications either invisible or the only
visible ones. It is pinned by four tests.

---

## 3. API — three additive endpoints

| Endpoint | Purpose |
|---|---|
| `GET /notifications/feed` | Paginated, filtered, searchable list |
| `GET /notifications/summary` | Unread badge + per-category/severity counts |
| `POST /notifications/read` | Bulk mark-as-read |

**Three pre-existing endpoints are unchanged:**

| Endpoint | Still serves |
|---|---|
| `GET /notifications` | Unread-only, unpaginated — legacy callers |
| `POST /notifications/read-all` | Mark everything read (reused, not duplicated) |
| `PATCH /notifications/:id/read` | Single mark-as-read |

> ⚠ **`/notifications` and `/notifications/feed` both return 200.** Pointing the
> screen at the bare path would not error — it would silently show only unread
> rows and ignore every filter and page. That is a bug shaped like a product
> decision, so the routing is pinned by tests (see §6).

### 3.1 Three surfaces, one source (completed 2026-08-03)

Notifications appear in three places, and all three now read the same server
data through this module. They previously did not, which is the whole point of
this section.

| Surface | Reads | Note |
|---|---|---|
| **Notification Center** (`/notifications`) | `GET /notifications/feed` | Paged, filtered, searchable. |
| **Navbar bell** (both portals) | `GET /notifications/summary` | Live audience-scoped unread count. **Was a static red dot** that claimed unread mail unconditionally, including when there was none. |
| **Cashier portal** (`/cashier/notifications`) | same page | The SAME `NotificationsPage`, mounted twice — see §3.2. |
| **Dashboard widget** | `GET /notifications/feed` | Newest slice, capped. **Was three hardcoded rows** — it announced a "System Update" that was never scheduled while a real out-of-stock alert sat unread on the other screen. |

**They share React Query keys on purpose.** The bell reuses the Center's
`notificationKeys.summary()` entry — one cache entry, one request, and marking
rows read on the Center updates the badge in the same tick. The dashboard
widget's key is `[...notificationKeys.all, "dashboardWidget"]`: a *distinct*
entry (its query is a short recent slice, not the Center's paged view) but a
child of the same invalidation root, so the Center's mutations refresh it too.

⚠ **Do not re-key the widget under the dashboard's namespace.** It would leave
the widget showing notifications the user just cleared elsewhere until its own
60-second poll came round — which is exactly the "two screens disagree" bug that
retiring the mock was meant to end.

⚠ **The severity vocabularies differ by one value, and it is the urgent one.**
The server's scale ends at `CRITICAL`; the widget's ends at `ERROR`. The
dashboard maps explicitly (`SEVERITY_TO_WIDGET_TYPE`) rather than casting — a
structural cast compiles and then drops critical alerts into an unstyled
default. Severity is derived server-side and is never re-derived on the client.

### 3.2 ⚠ The bell is portal-aware, and has to be

`NotificationsPage` is mounted on **both** portals — `/notifications` for
MANAGER/OWNER and `/cashier/notifications` for CASHIER. One component, two
routes, exactly the `ProfileView` pattern and for the same reason.

**This is not optional.** The Navbar renders in both shells, and the
manager-portal route sits inside `ManagerRoute`, which bounces a CASHIER to
`/cashier/pos`. A constant `"/notifications"` link would have shown a cashier an
accurate unread count on a bell that then refused to open — the control looks
right, the count behind it *is* right, and clicking it silently dumps them on
the POS screen with no error.

The link resolves through `notificationsPathForRole(role)`, which lives beside
`portalHomeForRole` in `features/auth/utils/permissions.ts` because portal
routing has one source of truth or the guards and the links drift apart. Pinned
by `auth/portalRouting.test.ts` (12 tests), including that the two helpers place
every role in the *same* shell.

⚠ **Any future link added to a shared shell component needs the same
treatment.** The Navbar and Sidebar are rendered by both portals; a hardcoded
`/`-rooted path in either is this bug again.

---

## 4. ⚠ Security fix: an IDOR in `markAsRead`

`notificationRepository.markAsRead` accepted a `userId` **and never used it**:

```ts
// BEFORE
async markAsRead(notificationId: string, userId: string) {
  return prisma.notification.update({ where: { id: notificationId }, ... });
}
```

Any authenticated caller could mark **any** notification read — including
another employee's security alerts — by supplying its id. It was latent while
nothing called it with a foreign id; exposing a real screen that renders ids in
its payloads would have made it reachable.

Now audience-scoped, and `updateMany` rather than `update` so a foreign id
matches **zero rows instead of throwing** — a thrown "record not found" would
confirm to a prober which ids exist. `role` was added as an *optional* final
parameter so existing two-argument callers keep compiling; omitting it is
strictly narrower, never wider.

**Verified live:** a CASHIER attempting to mark an OWNER-only notification read
receives `200 { updated: 0 }` and the row remains unread.

### 4.1 This is now a PERMANENT security suite

`SERVER/src/__tests__/notification.audience.security.test.ts` — **14 tests. Do
not delete, skip, or relax them.** A failure here after a refactor means the
refactor is wrong, not the test.

It covers the original IDOR *and* the boundary as a whole, because the audience
predicate is the **only** access control on this module (there is no
`requireRole` on the tree, by design — §1.1). It asserts that `audienceWhere` is
AND-ed into **every** read (`getUnreadForUser`, `findPage`, `countsByType`,
`findVisibleById`) and **every** mutation (`markAsRead`, `markManyAsRead`,
`markAllAsRead`), including that `findPage`'s count uses the *same* predicate as
its rows — a looser count leaks the existence of invisible rows through the
pager's total even when no row is returned.

⚠ **It mocks Prisma deliberately, so it needs no database.** Integration suites
here self-skip when no wipeable test database is configured, and *a security
test that silently skips on most checkouts is not a security test.* The
trade-off is explicit: this asserts query **shape**, not database behaviour, and
the behaviour was verified live (above). Its value was confirmed by
reintroducing the vulnerable `update({ where: { id } })` — four tests fail,
naming the IDOR.

---

## 5. ⚠ Bug found by end-to-end verification: inverted severity sort

`sortBy=severity&sortOrder=desc` returned **INFO first and CRITICAL last** —
the critical alerts sorted to the bottom of the page, the one place nobody
looks. Unit tests and the type checker both passed; only hitting the running
server exposed it.

The cause is worth recording because it is a copy-paste trap:

| Module | Array order | Correct multiplier |
|---|---|---|
| Audit Logs | `["CRITICAL", "HIGH", "MEDIUM", "LOW"]` — **most severe first** | `desc → +1` |
| Notifications | `["INFO", "SUCCESS", "WARNING", "CRITICAL"]` — **least severe first** | `desc → −1` |

The comparator code is identical in both files; the array orders are opposite,
so the same multiplier is right in one and wrong in the other. **Audit Logs is
correct** — this was a notifications-only defect, introduced by copying its
shape without re-checking the ordering. Pinned by two tests that assert the
resulting order, not the multiplier.

Severity sorting is **page-local**, like Audit Logs: there is no severity column
to `ORDER BY`, so SQL orders by `createdAt` and the returned page is re-sorted.
Filtering by severity is exact regardless, and is what someone hunting critical
alerts actually wants.

---

## 6. Tests

| Suite | Tests | Pins |
|---|---|---|
| `SERVER/.../notificationTaxonomy.test.ts` | 16 | Every dispatched type is mapped; no dead mappings; SYSTEM `notIn` expansion; categories don't overlap; **severity sort direction in both orders** |
| `SERVER/.../notification.audience.security.test.ts` | 14 | ⚠ **PERMANENT SECURITY SUITE (§4.1).** The audience boundary on every read and every mutation; the exact vulnerable query shape is asserted against; `updateMany` not `update`; count and rows share one predicate; omitting `role` narrows rather than widens |
| `CLIENT/.../notificationsApi.test.ts` | 15 | Endpoint routing (`/feed`, never the bare path); `isRead:false` survives serialisation; empty arrays dropped; envelope unwrapped once |
| `CLIENT/.../format.test.ts` | 16 | Bad/missing timestamps render `—` not "Invalid Date"; CRITICAL ≠ WARNING visually; no "1 notifications"; badge caps at 99+ |
| `CLIENT/.../dashboardNotifications.test.ts` | 13 | ⚠ **Single source of truth (§3.1).** The widget issues a real request and never returns the retired mock fixtures; routes to `/feed`; an empty result is a genuine empty state, never a fallback to samples; errors propagate; every severity maps, `CRITICAL → ERROR` explicitly |
| `CLIENT/.../portalRouting.test.ts` | 12 | ⚠ **Portal-aware links (§3.2).** A CASHIER is never sent to a route inside `ManagerRoute`; portal membership is exclusive (never both, never neither); `notificationsPathForRole` and `portalHomeForRole` place every role in the same shell |

**End-to-end against the live backend: 33 checks, 0 failures** — feed shape and
paging, summary buckets, validation 400s, the 401/RBAC boundary, every filter
including the SYSTEM `notIn` path, severity ordering, and that all three legacy
endpoints still behave exactly as before.

---

## 7. UI notes

- **Unread is carried by weight *and* a left accent bar**, never colour alone —
  "which have I dealt with" is the screen's most important signal and must
  survive low colour vision.
- **Chip counts are unfiltered.** A chip shows how much exists in that bucket,
  not how much survives the current filter; a count that changes when you click
  a *different* chip is unreadable.
- **Filter state lives in the URL**, so a filtered view is linkable and survives
  a refresh. Changing a filter clears the selection — a hidden selection is how
  bulk actions surprise people.
- **Preferences marks what is live and what is stored.** `lowStockAlertsEnabled`
  gates a real dispatch path; the email/SMS/WhatsApp channels are stored but not
  yet delivered, and each says so — the same rule Receipt & Invoice follows.
- **The bell badge renders only when there is something unread**, and caps at
  `99+`. The old static dot signalled unread mail unconditionally, which is the
  fastest way to teach someone to ignore a badge. A single digit stays a circle;
  wider values grow into a pill so the header never resizes.

---

## 8. Architecture reuse

The Preferences tab takes its **data** from the settings module
(`useSettingsForm`, because `integrationConfig` genuinely is a block of the
settings document) and its **presentation** from the shared settings primitives.
Notifications owns neither.

This is the sanctioned pattern from
[CONFIGURATION_OWNERSHIP.md §4](./CONFIGURATION_OWNERSHIP.md) — reuse the
primitives freely, and use the settings *hooks* only from a screen that owns a
block. The inbox, whose data lives in `notifications` behind its own endpoints,
correctly uses its own hooks.

---

## 9. Status

**This module is complete for the single-store scope.** The two follow-ups this
section used to list were closed on 2026-08-03:

- ~~The Navbar bell shows a static dot~~ → **done.** Live audience-scoped unread
  count from `/notifications/summary`, sharing the Center's query key (§3.1).
  The count is in the button's accessible name, not only the badge glyph, so a
  screen reader announces "Notifications, 3 unread".
- ~~`dashboardApi.getNotifications` is mock data~~ → **done.** Reads
  `/notifications/feed`; pinned by `dashboardNotifications.test.ts` (§6).

### 9.1 Channel delivery — a documented TODO, not a stub

**Only the in-app channel is delivered.** Email, SMS and push remain TODOs in
`NotificationEngine.dispatch`, each naming the infrastructure it needs: an
SMTP/provider credential and a verified from-domain; an SMS gateway account plus
DLT/sender-ID registration for Indian numbers; a VAPID keypair or FCM project
with a service worker and per-device subscription storage.

⚠ **Do not add a no-op or log-only sender in the meantime.** The owner-facing
Preferences tab already persists per-channel toggles — those record *intent* and
are read by nothing on the dispatch path. A stub would make the toggles read as
working, and a store would trust an out-of-stock email that was never sent. An
absent channel is visibly absent; a fake one is invisibly broken, and is
discovered by the stockout it failed to prevent.

**When a channel is built,** its failure must be **non-fatal**: a dead SMTP host
must not roll back an in-app notification that was already written. The in-app
row is the durable record; every other channel is best-effort on top of it. The
per-channel driver goes behind an interface mirroring `sendInAppNotification`,
and reads its toggle from `integrationConfig`.

Tracked as enhancement #3 in [MODULE_STATUS.md §5](./MODULE_STATUS.md), with the
standing no-placeholder rule at §5.1 there.
