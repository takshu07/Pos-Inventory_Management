// =============================================================================
// WARM THE TEST NEON BRANCH
//
// Neon auto-suspends an idle branch. The first connection after that suspension
// has to wait for the compute to resume, and until it does every caller sees a
// connection error rather than a slow success — which is why the rig's failure
// mode was "cloud node won't start, DatabaseNotReachable, run it again and it
// works". That is not a flake to be retried by hand; it is a cold start with no
// one waiting for it.
//
// This makes the wait explicit and bounded: connect, retry through the errors
// that mean "still resuming", and refuse to return until the branch has served
// a real query. Once it has, provisioning and node startup are deterministic —
// they begin against a compute that is already awake.
//
//   node scripts/warm-test-branch.mjs                 # uses TEST_DATABASE_URL
//   node scripts/warm-test-branch.mjs --timeout 120   # allow a longer resume
//
// Exit 0 = the branch answered a query. Exit 1 = it did not, within the budget.
//
// Driven by:  .\scripts\offline-test.ps1  (provision / start / online)
// =============================================================================

import pg from "pg";

const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const at = args.indexOf(name);
  if (at === -1 || at + 1 >= args.length) return fallback;
  const parsed = Number.parseInt(args[at + 1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const timeoutSec = flagValue("--timeout", 90);
const quiet = args.includes("--quiet");

// Read straight from the environment. The rig exports TEST_DATABASE_URL from
// .env.offline-test for exactly this call, and NOT loading dotenv here means
// this script can never silently fall back to whatever .env holds — which for
// a warm-up aimed at the test branch would mean waking production instead.
const url = process.env["TEST_DATABASE_URL"] ?? "";

if (url === "") {
  console.error("  X TEST_DATABASE_URL is not set — nothing to warm.");
  process.exit(1);
}

// Same guard the rig itself carries. A warm-up is a connection like any other,
// and this script is runnable by hand.
if (/frosty-moon/.test(url)) {
  console.error("  X TEST_DATABASE_URL points at PRODUCTION. Refusing to connect.");
  process.exit(1);
}

const endpoint = (/^(ep-[a-z0-9-]+?)(-pooler)?\./.exec(/@([^/?]+)/.exec(url)?.[1] ?? "") ?? [, "?"])[1];

const log = (message) => {
  if (!quiet) console.log(message);
};

/**
 * True for errors that mean "the compute is still coming up", as opposed to
 * "your credentials are wrong". Retrying the first is the whole point; retrying
 * the second just burns the timeout before reporting a fault that will never
 * clear on its own — a wrong password must surface in seconds, not 90.
 */
function isResuming(error) {
  const code = error?.code ?? "";
  const message = String(error?.message ?? "").toLowerCase();

  // 28P01 (bad password) and 3D000 (no such database) are terminal: the branch
  // is reachable and actively rejecting us. Fail immediately.
  if (code === "28P01" || code === "3D000") return false;

  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "57P03" || // cannot_connect_now — Postgres is starting up
    message.includes("timeout") ||
    message.includes("terminating connection") ||
    message.includes("compute") ||
    message.includes("endpoint is not")
  );
}

const started = Date.now();
const deadline = started + timeoutSec * 1000;

log(`  warming ${endpoint} (up to ${timeoutSec}s) ...`);

let attempt = 0;
let lastError;

while (Date.now() < deadline) {
  attempt += 1;
  const client = new pg.Client({
    connectionString: url,
    // Well under the deadline so a hung connect cannot consume the whole
    // budget in a single attempt and starve the retries.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  });

  try {
    await client.connect();
    // Connecting is not proof of readiness — a query is. Neon can accept the
    // socket while the compute is still finishing its resume.
    await client.query("SELECT 1");
    await client.end();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    log(
      `  ${endpoint} is awake (${elapsed}s, ${attempt} attempt${attempt === 1 ? "" : "s"})`
    );
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      // The connect failed; there may be no socket to close. Nothing to do.
    }

    if (!isResuming(error)) {
      console.error(`  X ${endpoint} rejected the connection: ${error.message}`);
      console.error("    This will not clear by waiting — check the credentials in");
      console.error("    .env.offline-test. A branch that was deleted and recreated");
      console.error("    reports 28P01 even though the password never changed.");
      process.exit(1);
    }

    const remaining = Math.max(0, deadline - Date.now());
    if (remaining === 0) break;
    log(`    attempt ${attempt}: still resuming (${error.code ?? error.message})`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, remaining)));
  }
}

console.error(
  `  X ${endpoint} did not answer within ${timeoutSec}s (${attempt} attempts).` +
    `\n    Last error: ${lastError?.message ?? "unknown"}` +
    `\n    The branch may be suspended beyond the resume budget, or deleted.` +
    `\n    Check the Neon console before re-running.`
);
process.exit(1);
