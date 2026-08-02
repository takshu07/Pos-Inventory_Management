# Users & Roles, and My Profile

Account administration (`/admin/settings/users`) and the self-service profile
screen (`/profile`, `/cashier/profile`).

Built 2026-08-03. **Frontend-only** — no new endpoints, no schema change, no
migration. Both screens compose APIs that already existed.

---

## 1. What each screen is for

| | Users & Roles | My Profile |
|---|---|---|
| Route | `/admin/settings/users` | `/profile` and `/cashier/profile` |
| Access | OWNER only | Every authenticated role |
| Question it answers | "Who can sign in, as what?" | "What is my account, and how do I change my password?" |
| Feature dir | `CLIENT/src/features/users` | `CLIENT/src/features/profile` |

### 1.1 Users & Roles vs. Workforce — why both exist

They both list employees, and that is deliberate rather than duplicated. They
answer different questions and hit different backend trees.

| | Workforce (`/admin/staff`, `/admin/managers`) | Users & Roles |
|---|---|---|
| Question | "How is this person **doing**?" | "Can this person **get in**?" |
| Shows | Presence, attendance, shift, revenue, performance score | Identity, role, account status, credentials |
| Polls? | Yes — a stale "online" dot is misleading | No — account data is not presence-bearing |
| Access | MANAGER+ (read-only for managers) | OWNER only |
| Writes | Shift, employment status, target, notes | Identity, role, activation, password |

Neither is a superset. Workforce cannot create an account or assign a role;
Users & Roles has no opinion on whether somebody clocked in. Merging them would
produce a screen that polls sales figures in order to change a phone number.

---

## 2. Backend surfaces used

Nothing here is new. The feature spans **two** existing trees, and which one it
calls per operation is load-bearing.

| Operation | Endpoint | Guard |
|---|---|---|
| List accounts | `GET /employees` | `requireRole("MANAGER")` |
| Read one | `GET /employees/:id` | `requireRole("MANAGER")` |
| Create | `POST /employees` | `requireRole("OWNER")` |
| Edit identity | `PATCH /employees/:id` | `requireRole("OWNER")` |
| Activate / deactivate | `PATCH /employees/:id` (`isActive`) | `requireRole("OWNER")` |
| **Change role** | `PATCH /owner/workforce/employees/:id/role` | OWNER (whole tree) |
| **Reset password** | `POST /owner/workforce/employees/:id/reset-password` | OWNER (whole tree) |
| Own profile | `GET /auth/me` | `authenticate` |
| Own password | `PATCH /auth/change-password` | `authenticate` |

### 2.1 Why role change does NOT use `PATCH /employees/:id`

`employee.service.updateEmployee` accepts `role` and enforces the hierarchy, so
routing a role change through it *would appear to work*. It is deliberately not
used, because that path **does not revoke the target's sessions**. The role is
embedded in the JWT, so a demoted manager would keep manager access until their
token expired.

`workforce.service.changeRole` is the only path that calls
`invalidateAuthContext` and `closeOpenSessions`. Same reasoning for password
reset. This is documented at the top of `usersApi.ts` and pinned by a test —
see §5.

---

## 3. RBAC and privilege-escalation prevention

The server is the boundary. `CLIENT/src/features/users/utils/accountRules.ts`
mirrors it so the UI can *explain* a refusal instead of offering a button that
403s.

**Every rule is enforced in at least two places:**

| Rule | Server | Client mirror |
|---|---|---|
| Only OWNER administers accounts | `requireRole("OWNER")` on both trees | `canAdministerUsers` + `OwnerRoute` |
| Actor must strictly outrank target | `employee.service.enforceHierarchy` | `denyModify` |
| An OWNER cannot be deactivated | `employee.service.updateEmployee` | `denyStatusChange` |
| An OWNER's role cannot change | `workforce.service.changeRole` | `denyRoleChange` |
| OWNER is not an assignable role | `z.enum(["MANAGER","CASHIER"])` | `AssignableRole` type + `assignableRolesFor` |
| Cannot change your own role | (owner-guard covers it today) | `denyRoleChange` |
| Cannot deactivate yourself | (owner-guard covers it today) | `denyStatusChange` |
| Cannot owner-reset your own password | — | `denyPasswordReset` |

The last three are **stricter on the client than the server strictly requires**,
and that is intentional:

- *Self role change / self deactivation* — the server's `enforceHierarchy`
  permits self-modification, and for an owner the owner-guards happen to catch
  both. Stating them explicitly means the rule survives if a non-owner
  administrator role is ever added, and "lock yourself out permanently" is never
  an intended click.
- *Self password reset* — the owner-reset path needs no current password.
  Allowing it against your own account would turn any unlocked session into a
  permanent account takeover. Changing your own password belongs in My Profile,
  which requires the current one.

### 3.1 Refusals are shown, not hidden

An action the actor may not perform renders **disabled with its reason**, not
hidden. Hiding makes an admin screen feel broken — the owner knows "change role"
exists and cannot tell why it vanished from one row. Each guard returns a
reason string (or `null` when allowed) so the UI has something to say.

---

## 4. Design decisions worth keeping

**Deactivation is this system's "delete".** There is no employee delete
endpoint and there should not be one: sales, attendance, register sessions and
audit rows reference the employee, and those FKs are `onDelete: Restrict`. The
confirmation dialog says so explicitly, because someone hunting for a Delete
button needs to know this is it and that history survives.

**Role change and password are not fields on the edit form.** Both have side
effects the plain PATCH does not (session revocation), so both get their own
confirmation dialog stating the consequence. Folding them into the edit form
would let someone re-role a colleague as a side effect of fixing a typo.

**The edit form sends only dirty fields.** A full-object PATCH would re-submit
the unchanged phone and email on every save, making the server run uniqueness
checks against the user's own current values.

**`email: ""` is meaningful.** The server reads an empty string as "clear this
address" (`if (data.email === "") updateData.email = null`). The transport layer
deliberately does *not* strip it, and neither does the validation schema.

**`isActive: false` is meaningful.** A generic falsy-stripping helper would turn
"show me deactivated accounts" into "show me everything", and would make
deactivation a silent no-op. Both are pinned by tests.

**Stat cards are honest about scope.** There is no `/employees/stats` endpoint,
so only the total is a true total; the role and status breakdowns are computed
from the loaded page and are labelled *"on this page"*. The alternative —
fetching every account to count them — would download the whole employee table
to render four numbers. A real breakdown would be an additive
`GET /employees/stats`.

**My Profile is read-only apart from the password.** There is no self-service
profile-update endpoint: `PATCH /employees/:id` is OWNER-only. Rather than
render inputs that would 403 for two of three roles, the details are presented
as facts with a line pointing at the owner. Adding self-service editing later is
an additive backend change (`PATCH /auth/me`, restricted to non-privileged
fields — never role, never `isActive`, never salary).

**One ProfileView, two routes.** `/profile` and `/cashier/profile` mount the
same component; nothing in it is portal-aware. Same pattern as `PosView`. Every
role sees their own record because the data comes from `/auth/me`, scoped to the
JWT — there is no id in the URL to tamper with.

---

## 5. Tests

Client tests are new to this repo — `CLIENT/vitest.config.ts`, `npm test` in
`CLIENT/`. Scope is pure logic only (node environment, no DOM, no setup file),
mirroring the server's `test:unit` philosophy. Component-rendering tests are
deliberately **not** set up: that needs jsdom + testing-library and is its own
decision, not something to smuggle in alongside a feature build.

| Suite | Tests | Covers |
|---|---|---|
| `users/__tests__/accountRules.test.ts` | 29 | Every RBAC guard, incl. self-demotion, owner deactivation, cross-owner administration, unauthenticated actor |
| `users/__tests__/validation.test.ts` | 39 | Phone/password/role/name/email/salary rules mirroring the server |
| `users/__tests__/format.test.ts` | 28 | Null-safety: "Not recorded" vs ₹0, "Never" vs a date, em dash vs "Invalid Date" |
| `users/__tests__/usersApi.test.ts` | 15 | **Endpoint routing** (role change hits the workforce tree), empty-param dropping, `isActive:false` and `email:""` survival, envelope flattening |
| `SERVER utils/__tests__/employeeValidation.test.ts` | 49 | The server side of the mirrored contract |

**Client: 111 passing. Server: 305 passing** (was 256; +49 from this milestone),
9 integration tests still skipped for want of a test database.

```bash
cd CLIENT && npm test
cd SERVER && npm run test:unit
```

---

## 6. Known gaps

| Gap | Why it was left | Fix if wanted |
|---|---|---|
| No `/employees/stats` | Would be a new endpoint; the screen is honest about page-scoped counts instead | Additive `GET /employees/stats` — **specified in §7.1** |
| No self-service profile edit | No endpoint exists; `PATCH /employees/:id` is OWNER-only | Additive `PATCH /auth/me` — **specified in §7.2** |
| No bulk actions | Deactivating several accounts at once is a rare and high-consequence operation; per-row confirmation is the safer default | — |
| No ownership transfer | Out of scope, and the server has no such process | A dedicated, audited transfer flow — never a role dropdown |
| Audit Logs not linked | The audit read API does not exist yet (MODULE_STATUS §2.3) | Every mutation here already writes `audit_logs`; the screen just needs building |

Every mutation on this screen is **already audited** — `employee.service` and
`workforce.service` write `CREATE` / `UPDATE` / `ROLE_CHANGED` /
`PASSWORD_RESET` / `EMPLOYEE_DEACTIVATED` / `EMPLOYEE_REACTIVATED` rows via
`auditRepository`. When the Audit Logs screen is built it will show this
screen's history with no change here.

---

## 7. Carried-forward decisions (milestone closed 2026-08-03)

Recorded at merge. §7.3–§7.5 are **standing rules**, not open questions — do
not re-open them by "simplifying" the code they govern.

### 7.1 TODO — `GET /employees/stats` (planned, additive)

**Spec:** `SERVER/src/services/employee.service.ts`, above `listEmployees`.
**Consumer:** `CLIENT/src/features/users/components/UserStatCards.tsx`.

Grouped account counts so Users & Roles — and any future dashboard headcount
tile — can show true global figures instead of page-scoped ones. Today only the
"Accounts" card is a real total (it reads `meta.total`, a COUNT query); the
role and status cards are derived from the loaded page and are labelled
*"on this page"* for that reason.

Unlike the `brand_stats` / `product_stats` rollups in [MODULE_STATUS §3](./MODULE_STATUS.md),
this needs **no denormalisation and no incremental maintenance** — `employees`
is sized by staff count, not transaction count, so one `GROUP BY` answers it.
Different shape of problem, deliberately a different kind of TODO.

Must be `requireRole("OWNER")` and declared before `/:id`, or "stats" is
captured as an employee id.

### 7.2 TODO — `PATCH /auth/me` (planned, additive)

**Spec:** `SERVER/src/services/auth.service.ts`, above `me`.
**Consumer:** `CLIENT/src/features/profile/components/ProfileInfoCards.tsx`.

Self-service profile editing without exposing the OWNER-only employee API.

**The constraint that defines it:** it must never become a privilege-escalation
path. `PATCH /employees/:id` is OWNER-only precisely because it can write
`role`, `isActive` and `salary`. The new endpoint therefore takes a **separate
schema listing permitted fields positively** — `firstName`, `lastName`, `email`,
`gender`, `address`, `dateOfBirth` — never an `omit()` applied to the employee
schema, which is one careless edit away from being reverted.

`phone` is excluded: it is a sign-in identifier, so letting someone move their
own login to a new number is an account-takeover primitive that needs the owner
in the loop.

### 7.3 STANDING RULE — session invalidation stays on the Workforce services

Role change and password reset **must** continue to route through
`/owner/workforce/employees/:id/role` and `.../reset-password`.

Do **not** consolidate them into `PATCH /employees/:id`. That endpoint accepts
`role` and enforces the hierarchy, so the consolidation *would appear to work* —
which is what makes the mistake tempting and its consequence invisible in
testing. Only the workforce path calls `invalidateAuthContext` +
`closeOpenSessions`. Without it a demoted manager keeps manager access until
their JWT expires, and a "reset" password leaves every existing session live.

Session revocation is a **security requirement of these two operations**, not an
implementation detail of where they live. Warnings are in
`workforce.service.ts` (both functions) and `usersApi.ts`; the routing is
asserted by `usersApi.test.ts`.

### 7.4 STANDING RULE — the three client-side self-guards are security rules

No self-role-change, no self-deactivation, no self-password-reset through the
admin interface. These are **intentional security rules, not UI conveniences**,
and must not be relaxed because "the API allows it".

The server's `enforceHierarchy` explicitly permits self-modification
(`if (executor.id === targetId) return;`). For an owner the separate
owner-guards happen to cover the first two *today* — a coincidence of the
current role set, not the rule being enforced. Add any non-owner administrator
role and the server stops covering them at all.

The third has **no server counterpart**: the owner-reset path requires no
current password by design, so pointing it at your own account turns an
unattended unlocked session into a permanent account takeover.

Enforced in `accountRules.ts`, pinned by `accountRules.test.ts`, matrix in §3.

### 7.5 STANDING RULE — client test infrastructure grows deliberately

**Logic tests are mandatory.** Any feature shipping RBAC rules, validation
schemas, money/date maths, filter derivation or transport routing lands with
unit tests covering them. Those are the regressions that are silent — nothing
crashes, types still check, and a permission that stopped being enforced is
invisible until it causes harm.

**Component/UI tests are a separate infrastructure milestone.** They need jsdom,
`@testing-library/react`, a setup file and a house style for queries and async
assertions. That work must not be bolted onto a feature build: a half-adopted
testing library is worse than none, because it sets a precedent nobody follows.
When it happens, add a jsdom project alongside this config rather than flipping
it, so the pure-logic suites keep running with no DOM.

Policy is restated at the top of `CLIENT/vitest.config.ts`.
