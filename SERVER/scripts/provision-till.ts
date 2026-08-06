/* eslint-disable no-console */
// =============================================================================
// FRESH TILL PROVISIONING
//
// Takes a brand-new cashier PC from "nothing installed" to "verified mirror,
// ready for Offline Mode" in one command.
//
// Usage:
//   npm run till:provision -- --dry-run
//   npm run till:provision
//   npm run till:provision -- --i-understand-this-destroys-the-mirror
//   npm run till:provision -- --verify-against-cloud
//
// ── What it will NOT do ──────────────────────────────────────────────────────
// It refuses, with no override, to run when the local queue holds un-uploaded
// sales. Those rows are the only copy of that money anywhere; the answer is
// always to drain them, never to provision through them. It also refuses on a
// node that is not configured as an edge till.
//
// An existing mirror is never deleted — it is renamed to
// `pos-local.db.superseded-<timestamp>` and restored automatically if any stage
// fails. The disk cost is a few hundred MB on a machine that has plenty; the
// benefit is that a bad run costs an operator nothing but time.
//
// ── Exit codes ───────────────────────────────────────────────────────────────
//   0  provisioned and verified (or dry run passed)
//   1  refused by preflight, or a stage failed and was rolled back
//   2  rolled back, but the restore ALSO failed — needs a human now
// =============================================================================

import "dotenv/config";

// ── Environment must be shaped BEFORE the offline module graph is imported ───
// `offlineConfig()` memoizes on first read, and the provisioning path is
// meaningless unless this process resolves as an enabled edge node. Setting the
// two switches here means an operator can run the command without having to
// export them by hand on a machine whose service env is not yet in place —
// while OFFLINE_DEVICE_ID, SYNC_CLOUD_URL and SYNC_DEVICE_SECRET are
// deliberately NOT defaulted, because guessing an identity is the one mistake
// this whole workflow exists to prevent.
process.env["OFFLINE_MODE_ENABLED"] = "true";
process.env["OFFLINE_ROLE"] = "edge";
// The provisioning download drives its own single pass. The background loop
// would otherwise start a competing run against a half-built mirror.
process.env["SYNC_AUTO_ENABLED"] = "false";

const CONFIRM_FLAG = "--i-understand-this-destroys-the-mirror";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmed = args.has(CONFIRM_FLAG);
const compareWithCloud = args.has("--verify-against-cloud");
const skipDownload = args.has("--skip-download");

// =============================================================================
// OUTPUT
// =============================================================================

const RULE = "─".repeat(78);

function heading(title: string): void {
  console.log(`\n${RULE}\n${title}\n${RULE}`);
}

function indent(text: string, prefix = "      "): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${prefix}${line.trimStart()}`))
    .join("\n");
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<number> {
  const { offlineConfig } = await import("../src/offline/config");
  const { provisionTill } = await import("../src/offline/provisioning/provision");

  const config = offlineConfig();

  heading("FRESH TILL PROVISIONING");
  console.log(`  device id     : ${config.deviceId || "(unset)"}`);
  console.log(`  mirror path   : ${config.localDatabasePath}`);
  console.log(`  cloud         : ${config.cloudBaseUrl || "(unset)"}`);
  console.log(`  mode          : ${dryRun ? "DRY RUN (nothing is written)" : "LIVE"}`);
  console.log(`  confirmation  : ${confirmed ? "given" : "not given"}`);
  console.log(
    `  cloud compare : ${compareWithCloud ? "on (re-pages every entity)" : "off"}`
  );

  const result = await provisionTill({
    confirmed,
    dryRun,
    skipDownload,
    compareWithCloud,
  });

  // ── Preflight ─────────────────────────────────────────────────────────────
  heading("PREFLIGHT");

  if (result.preflight.findings.length === 0) {
    console.log("  ✔ no findings — this node is a clean edge till");
  }

  for (const finding of result.preflight.findings) {
    const mark =
      finding.severity === "BLOCKING"
        ? "✖ BLOCKING"
        : finding.severity === "CONFIRMABLE"
          ? "▲ CONFIRM  "
          : "· NOTE     ";
    console.log(`  ${mark} [${finding.code}]`);
    console.log(`      ${indent(finding.message)}`);
    console.log(`      → ${indent(finding.remedy)}`);
  }

  if (result.failedStage === "PREFLIGHT") {
    const blocking = result.preflight.findings.filter((f) => f.severity === "BLOCKING");

    heading("RESULT: REFUSED");

    // ADVISORY findings never cause a refusal, so the "would destroy" branch
    // below is reached only for genuinely CONFIRMABLE ones.
    if (blocking.length > 0) {
      console.log("  Provisioning was refused. These findings have NO override:\n");
      for (const finding of blocking) console.log(`    • ${finding.code}`);
      console.log(
        "\n  Nothing was written. The local database is exactly as it was."
      );
    } else {
      console.log(
        "  Provisioning would destroy an existing mirror. Its queue is clean, so\n" +
          "  nothing unsent would be lost — but the operation must be stated out loud.\n" +
          `\n  Re-run with:  npm run till:provision -- ${CONFIRM_FLAG}`
      );
    }

    return 1;
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  if (result.messages.length > 0) {
    heading("PROVISIONING");
    for (const message of result.messages) console.log(`  ${indent(message, "    ")}`);
  }

  // ── Download ──────────────────────────────────────────────────────────────
  if (result.download !== undefined) {
    heading("DOWNLOAD");
    const rows = [...result.download.entities].sort((a, b) => b.rows - a.rows);
    for (const entity of rows.slice(0, 20)) {
      const status = entity.error === undefined ? "✔" : "✖";
      console.log(
        `  ${status} ${entity.entity.padEnd(28)} ${String(entity.rows).padStart(7)} row(s)` +
          `${entity.error === undefined ? "" : `  — ${entity.error}`}`
      );
    }
    if (rows.length > 20) console.log(`    … and ${rows.length - 20} more entities`);
    console.log(`\n  total: ${result.download.totalRows} row(s)`);
  }

  // ── Verification ──────────────────────────────────────────────────────────
  if (result.verification !== undefined) {
    heading("MIRROR VERIFICATION");
    for (const check of result.verification.checks) {
      const mark = check.passed ? "✔" : check.advisory === true ? "▲" : "✖";
      console.log(`  ${mark} ${check.name.padEnd(42)} ${check.detail}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const seconds = (result.durationMs / 1000).toFixed(1);

  if (result.ok) {
    heading("RESULT: PROVISIONED");
    console.log(`  Completed in ${seconds}s.`);

    if (dryRun) {
      console.log(
        "\n  This was a DRY RUN. Preflight passed and nothing was written.\n" +
          "  Re-run without --dry-run to build the mirror."
      );
      return 0;
    }

    console.log(
      "\n  This till holds a freshly downloaded, verified mirror and is READY for\n" +
        "  Offline Mode enablement.\n"
    );
    if (!compareWithCloud) {
      console.log(
        "  Note: row counts were NOT reconciled against the cloud. For the first\n" +
          "  till of a rollout, re-run with --verify-against-cloud.\n"
      );
    }
    if (result.quarantinePath !== undefined) {
      console.log(
        `  The previous mirror is preserved at:\n    ${result.quarantinePath}\n` +
          "  Delete it only after this till has completed a successful sync.\n"
      );
    }

    console.log("  Next:  set OFFLINE_MODE_ENABLED=true and restart the service.");
    return 0;
  }

  heading("RESULT: FAILED");
  console.log(`  Stage: ${result.failedStage ?? "unknown"}   (${seconds}s)`);

  const restoreFailed = result.messages.some((m) => m.includes("ROLLBACK FAILED"));

  if (restoreFailed) {
    console.log(
      "\n  ⚠ The rollback ALSO failed. This till currently has no usable mirror and\n" +
        "    the previous one is still under its .superseded- name. Restore it by\n" +
        "    hand before restarting the service. Do not enable Offline Mode."
    );
    return 2;
  }

  console.log(
    result.rolledBack
      ? "\n  The previous mirror was restored. This till is exactly as it was before\n" +
          "  the command ran — no data was lost. Fix the cause and re-run; the command\n" +
          "  is safe to retry."
      : "\n  This was a first-time provisioning, so there was nothing to restore. The\n" +
          "  partial mirror was discarded. Fix the cause and re-run."
  );

  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("\n  Provisioning crashed:", error);
    console.error(
      "\n  If a mirror was moved aside it is still present under its .superseded-\n" +
        "  name and must be restored by hand. Do NOT enable Offline Mode."
    );
    process.exit(2);
  });
