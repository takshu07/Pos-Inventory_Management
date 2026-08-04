// =============================================================================
// PRISMA CLI CONFIG — LOCAL (SQLite) MIRROR
//
// Used only by the Prisma CLI when generating the local client and pushing the
// local schema (`npm run db:local:generate`, `npm run db:local:push`). The
// running server never reads this file: it constructs the SQLite client with a
// better-sqlite3 driver adapter in `src/offline/datasource/localClient.ts`.
//
// The default path matches `LOCAL_DATABASE_PATH` in src/offline/config.ts, so
// the CLI and the server operate on the same file when neither is overridden.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import "dotenv/config";
import { defineConfig } from "prisma/config";

// The URL is built here rather than read straight from the environment because
// a SQLite `file:` URL must be an OS-native absolute path. Passing a POSIX-ish
// path on Windows (what a Git Bash `$(pwd)` produces) makes the CLI silently
// create the database on the current DRIVE ROOT instead — `db push` reports
// success while the server, using the correct path, sees an empty file.
// Resolving against this file's directory removes the ambiguity entirely.
function resolveLocalDatabaseUrl(): string {
  const configured = process.env["LOCAL_DATABASE_URL"]?.trim();
  if (configured) return configured;

  const fromPath = process.env["LOCAL_DATABASE_PATH"]?.trim();
  const absolute = fromPath
    ? path.resolve(process.cwd(), fromPath)
    : // Default matches src/offline/config.ts → <SERVER>/data/pos-local.db
      path.resolve(import.meta.dirname, "..", "..", "data", "pos-local.db");

  // `file:` + a native absolute path — NOT a pathToFileURL() href. Prisma's
  // SQLite connector rejects the RFC-8089 `file:///D:/...` form on Windows
  // with "The specified path is invalid (os error 161)".
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return `file:${absolute}`;
}

// Non-URL paths are resolved relative to THIS file's directory (prisma/local/),
// not to the server root — unlike the top-level prisma.config.ts, which sits at
// the root and therefore spells its paths out in full.
export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    // The local database is rebuilt with `db push`, never migrated: an edge
    // node's SQLite file is a disposable cache of the cloud plus an
    // un-uploaded queue, and a schema change ships as a new build rather than
    // as a migration history to be replayed on every till.
    path: "migrations",
  },
  datasource: {
    url: resolveLocalDatabaseUrl(),
  },
});
