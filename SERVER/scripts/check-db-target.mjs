// =============================================================================
// DATABASE TARGET GUARD
//
// Resolves DATABASE_URL exactly the way the app does — `dotenv/config`, which
// does NOT overwrite a variable already set in the environment — and reports
// which database a command is about to hit.
//
// The point is to make "am I about to run this against production?" a one-line
// scriptable check rather than something you answer by squinting at a
// connection string:
//
//     node scripts/check-db-target.mjs && npm run db:migrate:prod
//
// Exit 0 means the target is NOT production and it is safe to proceed. Non-zero
// means it is production, or DATABASE_URL is missing or unparseable, and the
// `&&` short-circuits. Anything it cannot positively identify fails closed.
//
// Set POS_PROD_ENDPOINT to the production Neon endpoint id for your project.
// =============================================================================

import "dotenv/config";

const PROD_ENDPOINT = process.env["POS_PROD_ENDPOINT"] ?? "ep-frosty-moon-at71qpbs";

const url = process.env["DATABASE_URL"] ?? "";

if (url === "") {
  console.error("  DATABASE_URL is not set — nothing in the environment or .env");
  process.exit(2);
}

const host = (/@([^/?]+)/.exec(url) ?? [, ""])[1] ?? "";
const endpointMatch = /^(ep-[a-z0-9-]+?)(-pooler)?\./.exec(host);

if (endpointMatch === null) {
  // Not a Neon-style host. Could be localhost, could be a production box behind
  // a hostname we do not recognise — either way we cannot vouch for it, and
  // guessing in the permissive direction is how a migration hits production.
  console.error(`  host '${host}' is not a recognisable Neon endpoint — cannot vouch for it`);
  process.exit(2);
}

const endpoint = endpointMatch[1];
const isProduction = endpoint === PROD_ENDPOINT;

console.log(`  endpoint : ${endpoint}`);
console.log(
  `  verdict  : ${
    isProduction
      ? "*** PRODUCTION *** — refusing to vouch for this target"
      : "non-production — safe for migrations, validation and stress runs"
  }`
);

process.exit(isProduction ? 1 : 0);
