// =============================================================================
// MANUAL MIGRATION APPLIER
//
// `prisma migrate dev` / `migrate deploy` cannot be used in this project: the
// historical migration 20260723000000_perf_search_and_composite_indexes fails
// shadow-database replay ("customerCode does not exist"). Until that migration
// is repaired, new migrations are applied with this script, which:
//
//   1. reads prisma/migrations/<name>/migration.sql
//   2. executes it through the app's Prisma singleton — the generated client
//      REQUIRES the PrismaPg adapter, so a bare DATABASE_URL connection is not
//      sufficient
//   3. records the migration in _prisma_migrations so a future `migrate deploy`
//      (once the historical migration is fixed) does not try to re-apply it
//
// Usage:  npx tsx scripts/applyMigration.ts <migration_folder_name> [--dry-run]
//
// The whole SQL file runs inside ONE transaction: if any statement fails the
// database is left untouched.
// =============================================================================
import "dotenv/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/config/prisma";
const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");
async function main() {
    const name = process.argv[2];
    const dryRun = process.argv.includes("--dry-run");
    if (!name) {
        console.error("Usage: npx tsx scripts/applyMigration.ts <migration_folder_name> [--dry-run]");
        process.exit(1);
    }
    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
        console.error(`Migration file not found: ${sqlPath}`);
        process.exit(1);
    }
    const sql = fs.readFileSync(sqlPath, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const already = await prisma.$queryRaw `
    SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = ${name}`;
    if (already.length > 0 && already[0]?.finished_at) {
        console.log(`✓ Migration "${name}" is already applied. Nothing to do.`);
        return;
    }
    if (dryRun) {
        console.log(`--dry-run: would apply ${sqlPath}`);
        console.log(`   checksum ${checksum}`);
        console.log(`   ${sql.split("\n").length} lines`);
        return;
    }
    console.log(`Applying migration "${name}" …`);
    const startedAt = new Date();
    // $executeRawUnsafe runs the whole file as a single multi-statement command.
    // Wrapped in an interactive transaction so a failure part-way leaves nothing
    // behind. maxWait/timeout are generous: this runs against a remote Neon
    // instance where every round-trip costs real latency.
    await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        await tx.$executeRaw `
        INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES
          (${crypto.randomUUID()}, ${checksum}, ${new Date()}, ${name}, NULL, NULL, ${startedAt}, 1)`;
    }, { maxWait: 30_000, timeout: 120_000 });
    console.log(`✓ Applied "${name}" and recorded it in _prisma_migrations.`);
}
main()
    .then(() => process.exit(0))
    .catch((e) => {
    console.error("✗ Migration failed — database left unchanged.");
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=applyMigration.js.map