// =============================================================================
// DATASOURCE ROUTER
//
// Decides which database the `prisma` export in src/config/prisma.ts actually
// talks to. This is the seam that lets the offline layer exist WITHOUT editing
// the 40-odd services, 26 repositories and 34 route modules that already import
// that one symbol — they keep calling `prisma.sale.create(...)` and the router
// puts it in the right place.
//
// ── The rule ─────────────────────────────────────────────────────────────────
//
//   OFFLINE_MODE_ENABLED unset/false  →  the Neon client, eagerly, exactly as
//                                        before this feature existed.
//   role = "cloud"                    →  the Neon client.
//   role = "edge"                     →  the local SQLite client, ALWAYS.
//
// ── Why an edge node uses SQLite even while it is online ─────────────────────
// This is the design decision the whole feature turns on, so it is worth being
// explicit: connectivity does NOT select the database.
//
// The tempting alternative — "use Neon when online, fall back to SQLite when
// the link drops" — is wrong in a way that costs money. A store that flips
// mid-afternoon writes the morning's sales to Neon and the afternoon's to
// SQLite. Now the day's takings live in two places; the register never
// reconciles; a return processed against a sale in the other database fails; and
// stock counts diverge because each database saw only half the movements. The
// failure is silent and only shows up at close of business.
//
// So an edge node is offline-first in the literal sense: SQLite is its
// operational database for the whole business day, and connectivity governs
// only whether the SYNC ENGINE may run. That matches the brief — "SQLite
// becomes the source of truth for day-to-day operations until synchronization
// occurs" — and it makes offline the normal path rather than an emergency one,
// which is the only way the offline path stays tested.
//
// ── Compatibility, verified rather than assumed ──────────────────────────────
// Routing works because the two generated clients are interchangeable at the
// points that matter, which was checked against this repo's actual usage:
//
//   • `Prisma.Decimal` is the SAME class in both generated clients, so the
//     `instanceof Prisma.Decimal` checks in finance.engine.ts and
//     cashRegister.engine.ts behave identically.
//   • `Prisma.PrismaClientKnownRequestError` is likewise shared, so the P2002
//     check in finance.service.ts and the duck-typed check in
//     error.middleware.ts both still fire.
//   • Model delegates, `$transaction`, `$queryRaw` and `$executeRaw` are
//     structurally identical.
//
// Raw SQL is the one place the dialects genuinely differ; that is handled
// separately by the dialect layer, not here.
// =============================================================================

import type { PrismaClient } from "../../../generated/prisma";
import { logger } from "../../config/logger";
import { isEdgeNode, type DataSourceMode } from "../config";
import { getLocalClient } from "./localClient";

// =============================================================================
// MODE
// =============================================================================

/**
 * The datasource this process serves business traffic from.
 *
 * Fixed for the lifetime of the process: it is a deployment property (which
 * role this node plays), not a runtime reaction to the network.
 */
export function getDataSourceMode(): DataSourceMode {
  return isEdgeNode() ? "local" : "cloud";
}

export function isServingFromLocal(): boolean {
  return getDataSourceMode() === "local";
}

// =============================================================================
// ROUTING PROXY
// =============================================================================

/**
 * Methods on the client instance itself (as opposed to model delegates) that
 * must stay bound to the client they came from.
 */
function bindIfFunction(value: unknown, target: object): unknown {
  return typeof value === "function" ? (value as (...args: never[]) => unknown).bind(target) : value;
}

/**
 * Builds a `PrismaClient`-shaped object that forwards every access to the local
 * SQLite client.
 *
 * A Proxy rather than simply returning `getLocalClient()` for two reasons:
 *
 *  1. Laziness. `src/config/prisma.ts` is imported by almost every module,
 *     including unit tests that never touch a database. Opening the SQLite file
 *     at import time would make those tests depend on a local mirror existing.
 *     The Proxy defers `getLocalClient()` to first real use.
 *
 *  2. Testability. `__setLocalClientForTesting()` can swap the underlying
 *     client between suites, and callers holding the `prisma` reference pick up
 *     the new one automatically.
 *
 * The cast to `PrismaClient` is deliberate and safe: the local client is
 * generated from the same models, and the scalar-list bridge restores the only
 * field types that differ. TypeScript cannot see that equivalence across two
 * generated packages, but it holds by construction — the generator asserts it.
 */
function createLocalRoutingProxy(): PrismaClient {
  // The Proxy needs a callable-free base object; the handler ignores it.
  const base = {} as PrismaClient;

  return new Proxy(base, {
    get(_target, property, _receiver) {
      const client = getLocalClient() as unknown as object;
      const value = Reflect.get(client, property, client);
      return bindIfFunction(value, client);
    },

    set(_target, property, value) {
      const client = getLocalClient() as unknown as object;
      return Reflect.set(client, property, value);
    },

    has(_target, property) {
      return Reflect.has(getLocalClient() as unknown as object, property);
    },

    ownKeys(_target) {
      return Reflect.ownKeys(getLocalClient() as unknown as object);
    },

    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        getLocalClient() as unknown as object,
        property
      );

      // A Proxy may not report a property as non-configurable unless the target
      // actually has it that way, so normalize before returning.
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },

    getPrototypeOf(_target) {
      return Reflect.getPrototypeOf(getLocalClient() as unknown as object);
    },
  });
}

// =============================================================================
// ENTRY POINT
// =============================================================================

/**
 * Returns the client that `src/config/prisma.ts` should export.
 *
 * `createCloudClient` is passed as a thunk rather than a value so that an edge
 * node never constructs a Neon pool at all — a till has no DATABASE_URL and no
 * business holding production database credentials. It talks to the cloud over
 * the authenticated sync API instead.
 */
export function resolvePrimaryClient(createCloudClient: () => PrismaClient): PrismaClient {
  if (!isEdgeNode()) {
    return createCloudClient();
  }

  logger.info(
    { mode: "local" },
    "offline: serving business traffic from the local SQLite database"
  );

  return createLocalRoutingProxy();
}
