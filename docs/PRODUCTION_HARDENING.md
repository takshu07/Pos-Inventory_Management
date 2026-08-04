# Production hardening — observability, reliability & security

What was added in the production-hardening phase (2026-08-04), why each piece
exists, and how to operate it.

This phase deliberately changed **no business logic, no API contract, no schema
and no RBAC boundary**. Every change is either an observation point, a failure
path, or a dependency bump.

---

## 0. What this phase found

The audit's first result was that most of the requested surface was **already
built**: Helmet, a CORS whitelist, global + auth rate limiters, gzip
compression, a tuned pg pool, trigram and composite indexes, Pino with secret
redaction, graceful shutdown, an error boundary, table virtualization and route
code-splitting. The earlier performance engagement (Phases A–H) closed most of
the performance scope.

The genuine gaps were concentrated in **observability** — and one of them found
a real cost problem within five minutes of being switched on (§5).

---

## 1. Request correlation

**Problem.** `app.ts` minted a `reqId` per request and returned it as
`X-Request-Id`, but nothing below the middleware could see it. A repository
logging a slow query, or the error handler logging a 500, had no way to say
which request it belonged to. A user reporting "it failed at 2:41pm" could not
be tied to the log line explaining it.

**Solution.** `config/requestContext.ts` — an `AsyncLocalStorage` store bound to
the request's async execution chain. Any code awaited at any depth reads the
same context without it being threaded through every signature (which would
have meant touching every layer of Routes → Controllers → Services → Engines →
Repositories).

| Field | Meaning |
|---|---|
| `reqId` | Correlation id; also the `X-Request-Id` header |
| `method` / `path` | Route, for grouping |
| `userId` / `role` | Actor — populated by `authenticate`, absent when anonymous |
| `dbQueryCount` | SQL statements this request issued — **the direct N+1 signal** |
| `dbTimeMs` | Cumulative time this request spent waiting on SQL |

> ⚠ **This is observability metadata, never authorization state.** `req.user`
> remains the sole source of truth for who the caller is. A missing context (a
> background job, the print queue, a test) must never read as "authorized".

**The client closes the loop.** `lib/api/requestId.ts` reads the id back off a
failed response (header first, body fallback), the API client attaches it to the
rejected `Error`, and the `ErrorBoundary` renders it as a copyable
"Reference:" line. A support conversation now starts with an id that locates the
exact server log line.

---

## 2. Slow-query detection

`config/queryInstrumentation.ts` times **every SQL statement** and warns on
those over `SLOW_QUERY_THRESHOLD_MS` (default 300ms).

### Why the pg.Pool, and not Prisma

Two documented alternatives were rejected:

1. **`prisma.$extends({ query })`** — returns a *different* client type, and
   `config/prisma.ts` exports `prisma` explicitly typed as `PrismaClient`.
   Adopting the extended type would ripple through ~100 repository files. It
   also times the Prisma *operation*, not the statement, so one `findMany` with
   relations reports a single number for several statements.
2. **`log: [{ emit: "event", level: "query" }]`** — pays serialization cost on
   *every* query even when nothing is slow, which is the overhead the previous
   phase removed.

`PrismaPg` accepts an existing `pg.Pool`, so the pool is constructed here and
handed over. Queries execute identically; they are merely timed. The exported
`prisma` keeps its exact type, so no consumer changed.

Both statement paths are instrumented: `pool.query` (one-off statements) **and**
`pool.connect` (the borrowed client used by interactive transactions). Without
the second, everything inside a `$transaction` — checkout, void, product
creation, the slowest and most important code in the system — would be
invisible. Verified: a probe transaction logged `BEGIN`, the inner statement and
`COMMIT`, all correlated to the request.

### Security: statement text is logged, parameter values never are

pg sends parameterized SQL — the text carries `$1`/`$2` placeholders and the
values travel separately. Logging `query.text` is safe; logging `query.values`
would leak password hashes, customer phone numbers and payment amounts into the
log aggregator. **The values array is never read by this file.** That is the
reason it only ever touches `.text`.

### Log throttling (see §5 for what forced it)

Each distinct statement logs immediately, then at most once per
`SLOW_QUERY_LOG_WINDOW_MS` (default 60s). Suppression is **not silence**: the
throttled line carries `occurrences` and `maxDurationMs` for the window, so
"this is slow, this often, this badly" survives at bounded cost. Throttling is
**per statement**, so a noisy background query can never mask a genuinely slow
checkout. The tracking map is capped at 500 statements; past the cap throttling
degrades but memory does not grow.

---

## 3. HTTP metrics — `GET /health/metrics`

Per-route latency percentiles and error rates for **this process**.

```jsonc
{
  "uptimeSeconds": 3600,
  "totalRequests": 12043,
  "totalErrors": 3,
  "errorRate": 0.0002,
  "routes": [
    { "route": "POST /api/v1/sales", "count": 412, "avgMs": 180,
      "p50Ms": 140, "p95Ms": 620, "p99Ms": 1400, "maxMs": 2100 }
  ],
  "slowQueryThresholdMs": 300
}
```

Design decisions worth keeping:

- **Percentiles, not averages.** A mean hides the POS failure mode that actually
  hurts: most requests fast, a few catastrophic. A cashier who waited 4 seconds
  does not care that the average was 120ms.
- **Route templates, not URLs.** `/sales/<uuid>` is normalized to
  `/sales/:id`. Without this the map grows with traffic forever — a memory leak
  driven by usage, and the classic way naive per-path metrics become unusable.
- **Bounded memory.** Each route keeps a 500-sample reservoir, so memory is
  capped regardless of uptime.
- **Only 5xx counts as an error.** A 401 or a 409 is the API working correctly;
  folding those in would make a busy login screen look like an outage and
  destroy the signal's value for alerting.
- **Per process.** Behind multiple instances each reports its own slice. Cross
  instance aggregation is the log platform's job.

⚠ **Nearest-rank caveat, pinned by a test:** with exactly 100 samples a single
outlier is the 100th value, so p99 stays fast and `maxMs` is the field that
reports it. Reading p99 as "the worst request" is a misreading.

**Auth:** deliberately unauthenticated, like the other probes. It exposes no
business data — only route templates, counts and timings — and must stay
reachable when authentication is the thing that is broken. If deployed on a
public interface, restrict `/health` at the ingress layer rather than adding
auth here.

---

## 4. Error reporting

`config/errorReporter.ts` is the single funnel for unhandled server errors.

**The bug it fixed.** The old handler logged the full error in development but
only `error.message` in production. A live 500 arrived as one line with no
stack, no request id and no actor — undiagnosable without reproducing it, which
for an intermittent checkout failure is exactly what cannot be done. Pino's
`redact` config already strips credentials, so the stack is safe to keep.

Now every unhandled error logs with `err` (stack included), `reqId`, `route`,
`userId`, `role` and `dbQueryCount`. The 500 response carries `requestId` back
to the client — an opaque UUID that reveals nothing but connects the user's
report to the log. **Stacks are still never sent to a browser.**

### No placeholder delivery (MODULE_STATUS §5.1)

There is deliberately **no inert "Sentry integration"** that swallows errors and
pretends they were sent. Reporting *is* the structured log — Pino JSON to stdout
collected by the platform's pipeline is a real delivery path. An external sink
can be registered at startup via `registerErrorReporter` (server) or
`registerClientErrorReporter` (client). Until one is, there is no second channel
and nothing claims there is.

A reporter that throws is caught and logged; a broken observability sink must
never escalate a handled 500 into a crashed process. Pinned by tests.

---

## 5. The print-queue finding

**The instrumentation paid for itself on its first run.** A five-minute session
produced **106 slow-query warnings, all from one statement** — the print
queue's idle poll.

Investigation with `EXPLAIN (ANALYZE, BUFFERS)`:

```
Execution Time: 0.045 ms     ← server-side
Bitmap Index Scan on "print_jobs_status_createdAt_idx"
```

…against a **982 ms** wall-clock round-trip. So:

- **There is no query defect.** The plan is optimal and the index already
  exists. No index was added, because none was missing.
- The cost is **entirely the round-trip**, and the problem is **volume**:
  `IDLE_POLL_MS = 2000` means the worker polls forever whether or not anything
  is queued — roughly **43,000 round-trips a day on a completely idle store**.
- On the measured Neon instance the worker held a pool connection roughly **half
  the time** while doing nothing, and Neon's compute could never autosuspend.

**What was changed:** the default is **unchanged at 2000ms**, so print latency
behaves exactly as before. `IDLE_POLL_MS` is now env-tunable via
`PRINT_QUEUE_IDLE_POLL_MS` so a deployment on a high-latency or autosuspending
database can widen it without a code change. Raising it only delays the *start*
of a job; throughput once printing is governed by `BUSY_POLL_MS`, untouched.

**Recommended follow-up (not done — it is a behavior change):** replace polling
with an in-process signal on enqueue, falling back to a long poll. That is a
design change to the Label Engine and belongs in its own piece of work.

---

## 6. Reliability: shutdown & readiness

**The bug.** Graceful shutdown went straight to `server.close()`. A load
balancer keeps routing here until a *probe* fails — so for the seconds between
SIGTERM and the socket closing, the LB was still sending requests to an instance
refusing them. Cashiers saw failed sales on every deploy.

**The fix — drain first:**

1. `beginShutdown()` makes `/health/ready` return 503 **while still serving**.
2. Wait `DRAIN_DELAY_MS` (default 5000 in production, 0 in dev) so the LB's next
   probe takes this instance out of rotation.
3. `server.close()`, then stop the print queue, then `$disconnect()`, then close
   the pool.

`/health/live` deliberately stays 200 during shutdown: a failing *liveness*
probe tells an orchestrator the process is wedged and should be SIGKILLed —
which would abort the very drain being performed.

**Pool ownership.** Because this app hands `PrismaPg` a pool it constructed,
Prisma treats it as externally owned and will not end it. `closeDatabasePool()`
does. Without it, a rolling deploy holds Neon connection slots the incoming
instance needs.

**`unhandledRejection`** now exits through the *same graceful path* rather than
an immediate `process.exit(1)`. The old behavior killed the process
mid-statement: an in-flight checkout lost its response, and because a sale is
written in an interactive transaction, the client could not tell whether it
committed.

**`uncaughtException` still exits immediately, deliberately.** After an uncaught
exception the interpreter state is genuinely untrustworthy, so running further
code — including a shutdown that writes to the database — risks corrupting data
rather than protecting it.

---

## 7. Reliability: client error boundaries

The `ErrorBoundary` was mounted **once, at the root, with a full-screen
fallback**. Any component that threw — one dashboard widget with an unexpected
null — replaced the entire application with "Something went wrong" and a Refresh
button. For a POS that is severe: a broken analytics widget should never stop a
cashier taking payment.

Now:

- `variant="app"` — the root boundary, unchanged in spirit.
- `variant="route"` — mounted around the `<Outlet />` in **both**
  `MainLayout` and `CashierLayout`. A crash is contained to the content pane
  while the Navbar and Sidebar stay mounted and usable.
- `resetKey={location.pathname}` — React does not re-attempt a render on its
  own, so without this a boundary that caught an error would still show it after
  navigating elsewhere. Keying on the path makes **navigation the recovery
  action**, which is what a user tries first.
- The fallback shows the server `requestId` when the failure came from an API
  call, and route-level failures get "Try again" (re-render) instead of a full
  page reload.

---

## 8. Security

### Dependency vulnerabilities

| Package | Where | Action |
|---|---|---|
| `ip-address` (2 high) | `express-rate-limit` → **request path** | **Fixed** — bumped to 10.4.0 within the existing `^10.2.0` range |
| `postcss`, `brace-expansion` | client build tooling | **Fixed** via non-breaking `npm audit fix` |
| `hono`, `@hono/node-server`, `fast-uri`, `valibot` | all nested under `@prisma/dev` | **Not fixed — not reachable.** Prisma's local dev tooling, not loaded by the running API. Fixing requires changing Prisma itself, which is a stack change requiring a decision |
| `react-router` (1 high) | client | **Not fixed — not applicable.** The advisory is an **RSC-mode** CSRF bypass; this app uses `createBrowserRouter` client-side data routers, not RSC. The fix is a major bump (7.x → 8.3.0), a breaking stack change |

Request-path dependencies are clean. The remainder are documented above rather
than silently force-upgraded.

### Export rate limiting

Every other endpoint is bounded work: a page of rows, one sale. An export is
not — it scans a date range, joins across sales/items/payments, and renders a
PDF or CSV in memory. A few concurrent exports can saturate the connection pool
and this process's heap, taking **checkout** down with them. The global 200/min
is far too loose: 200 exports a minute would be an outage.

`exportLimiter` — **30 per 5 minutes**, applied in `app.ts` by *path* match
(`/\/export(\/|$)/`) rather than per route, because export endpoints are spread
across twelve routers and per-route wiring would silently miss any added later.

> ⚠ **Shared-IP note.** All terminals in a store typically egress from one
> public address, so every IP-keyed limit is shared by the whole store, not per
> user. The number above accounts for that. **The same caveat applies to the
> pre-existing `globalLimiter` (200/min): it is a whole-store budget, not a
> per-terminal one.** Worth re-checking against real traffic before a
> multi-terminal rollout.

### Headers

Verified live: Helmet is emitting CSP, HSTS (`max-age=31536000;
includeSubDomains`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
COOP/CORP and `Origin-Agent-Cluster`. No change needed.

---

## 9. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SLOW_QUERY_THRESHOLD_MS` | `300` | Statements slower than this warn. Tuned for Neon, where a round-trip is ~15–40ms at best — a local-Postgres threshold would fire constantly |
| `SLOW_QUERY_LOG_WINDOW_MS` | `60000` | Throttle window per statement |
| `DRAIN_DELAY_MS` | `5000` prod / `0` dev | Time serving traffic after readiness starts failing. Must exceed one LB probe interval |
| `PRINT_QUEUE_IDLE_POLL_MS` | `2000` | Print-queue idle poll. See §5 |

---

## 10. Test coverage added

| Suite | Tests | Pins |
|---|---|---|
| `config/requestContext` | 9 | Isolation under genuine interleaved concurrency; propagation across awaits; no-op outside a request |
| `config/errorReporter` | 7 | **The stack survives** (the production regression); correlation fields; a throwing sink cannot escalate |
| `config/slowQueryThrottle` | 9 | Repetition collapsed; per-statement so noise can't mask a slow checkout; worst-duration retained; memory bounded |
| `utils/metrics` | 20 | Cardinality guard (500 URLs → 1 row); 5xx-only error rate; nearest-rank percentiles incl. the p99 boundary; reservoir bound |
| `lib/errorReporting` (client) | 6 | Cannot throw from `componentDidCatch`, including when the sink or console is broken |
| `lib/api/requestId` (client) | 8 | Header/body precedence, casing, malformed values |

Server observability suites live in `src/config/__tests__/`, added to
`vitest.unit.config.ts` so they run on the fast, no-database path.

---

## 11. What was deliberately NOT done

- **No index was added.** The one query the instrumentation flagged already had
  an optimal plan (§5). Adding an index nothing needed would be cargo cult.
- **No N+1 was "fixed".** The sweep found the loops that exist are deliberate,
  documented and bounded: payroll generation is sequential *because* payment
  numbering requires it (a parallel batch would collide on the unique index);
  per-item loops in sale/exchange go through the InventoryMovement engine as the
  architecture mandates. `dbQueryCount` now makes any *future* N+1 visible as a
  query count that scales with page size.
- **No poll-to-push rewrite of the print queue** — a behavior change (§5).
- **No React Router major bump** — breaking, and the advisory does not apply.
- **No `globalLimiter` change** — raising it weakens security, lowering it risks
  an outage. Flagged in §8 for a decision against real traffic instead.
