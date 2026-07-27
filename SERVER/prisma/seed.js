/**
 * Auth seed — canonical portal accounts.
 *
 * Run with:  npm run db:seed   (see package.json)
 *
 * Purpose
 * -------
 * Establishes exactly the accounts the two portals need and removes every other
 * login, per the current requirement of "no demo users until further notice":
 *
 *   • MANAGER  9876543210 / Manager@123   → Manager portal (full management)
 *   • OWNER    9876500000 / Owner@123     → Manager portal + owner-only screens
 *   • CASHIER  9876511111 / Cashier@123   → Cashier portal (POS + Profile only)
 *
 * The Owner and Cashier accounts exist so every portal and RBAC path is
 * actually testable; the Manager is the primary account described in the brief.
 *
 * Safety
 * ------
 * Employee foreign keys use `onDelete: Restrict` (sales, purchases, audit logs,
 * …). Hard-deleting an employee who has transacted would throw. So for any
 * account that is NOT one of the three canonical ones we:
 *   1. try to delete it (clean when it has no history), and
 *   2. fall back to deactivating it (isActive=false) when history blocks the
 *      delete — a deactivated account cannot log in (auth.service checks
 *      isActive), which satisfies "no other credentials" without destroying
 *      audit history.
 *
 * Passwords are hashed through the SAME hashPassword util the app uses, so these
 * accounts are indistinguishable from ones created via the normal flow. No
 * credential is ever hardcoded on the frontend — the client only ever sees what
 * a user types into the login form.
 *
 * Idempotent: safe to run repeatedly. Upserts by the unique `phone`.
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/hash";
if (process.env["NODE_ENV"] === "production") {
    console.error("CRITICAL: refusing to run the auth seed in production.");
    process.exit(1);
}
// Reconciliation is keyed on `phone` (the login identifier). employeeCode is NOT
// pinned here — an existing account keeps its code, and new accounts get the
// next free EMP-###### so we never collide with a pre-existing owner created by
// the one-time setup flow.
const ACCOUNTS = [
    {
        firstName: "Store",
        lastName: "Owner",
        phone: "9876500000",
        email: "owner@cexpos.local",
        password: "Owner@123",
        role: "OWNER",
    },
    {
        firstName: "Store",
        lastName: "Manager",
        phone: "9876543210",
        email: "manager@cexpos.local",
        password: "Manager@123",
        role: "MANAGER",
    },
    {
        firstName: "Front",
        lastName: "Cashier",
        phone: "9876511111",
        email: "cashier@cexpos.local",
        password: "Cashier@123",
        role: "CASHIER",
    },
];
const CANONICAL_PHONES = new Set(ACCOUNTS.map((a) => a.phone));
/**
 * Computes the next free employeeCode in the EMP-###### series by scanning the
 * highest existing numeric suffix. Used only when creating a brand-new account.
 */
async function nextEmployeeCode() {
    const codes = await prisma.employee.findMany({ select: { employeeCode: true } });
    let max = 0;
    for (const { employeeCode } of codes) {
        const m = /^EMP-(\d+)$/.exec(employeeCode);
        if (m && m[1])
            max = Math.max(max, parseInt(m[1], 10));
    }
    return `EMP-${String(max + 1).padStart(6, "0")}`;
}
async function upsertAccount(account) {
    const hashedPassword = await hashPassword(account.password);
    const existing = await prisma.employee.findUnique({
        where: { phone: account.phone },
        select: { id: true, employeeCode: true },
    });
    // Free the target email if a DIFFERENT row currently holds it — otherwise the
    // unique(email) constraint would reject our update/create. Such a row is not
    // one of our canonical phones (or we'd have matched it above), so nulling its
    // email is safe; purgeOtherAccounts will deactivate/remove it afterwards.
    const emailHolder = await prisma.employee.findUnique({
        where: { email: account.email },
        select: { id: true },
    });
    if (emailHolder && emailHolder.id !== existing?.id) {
        await prisma.employee.update({ where: { id: emailHolder.id }, data: { email: null } });
    }
    if (existing) {
        // Update in place — keep the account's existing employeeCode. Reset role,
        // password and reactivate (this file is the source of truth). Bump
        // refreshTokenVersion so any token minted before the re-seed is invalidated.
        await prisma.employee.update({
            where: { id: existing.id },
            data: {
                firstName: account.firstName,
                lastName: account.lastName,
                email: account.email,
                password: hashedPassword,
                role: account.role,
                isActive: true,
                refreshTokenVersion: { increment: 1 },
            },
        });
    }
    else {
        await prisma.employee.create({
            data: {
                employeeCode: await nextEmployeeCode(),
                firstName: account.firstName,
                lastName: account.lastName,
                phone: account.phone,
                email: account.email,
                password: hashedPassword,
                role: account.role,
                isActive: true,
                joiningDate: new Date(),
                refreshTokenVersion: 0,
            },
        });
    }
    console.log(`  ✓ ${account.role.padEnd(7)} ${account.phone}  (${account.email})`);
}
/**
 * Removes every login that is not one of the canonical three. Deletes cleanly
 * where possible; deactivates where transaction history forbids deletion.
 */
async function purgeOtherAccounts() {
    const others = await prisma.employee.findMany({
        where: { phone: { notIn: [...CANONICAL_PHONES] } },
        select: { id: true, phone: true, employeeCode: true },
    });
    if (others.length === 0) {
        console.log("  (no other accounts to remove)");
        return;
    }
    for (const emp of others) {
        try {
            await prisma.employee.delete({ where: { id: emp.id } });
            console.log(`  ✗ deleted   ${emp.employeeCode} (${emp.phone})`);
        }
        catch {
            // Restrict FK (has sales/audit/etc.) — can't delete without orphaning
            // history. Deactivate instead so the account can no longer authenticate.
            await prisma.employee.update({
                where: { id: emp.id },
                data: { isActive: false, refreshTokenVersion: { increment: 1 } },
            });
            console.log(`  ⊘ disabled  ${emp.employeeCode} (${emp.phone}) — had history, kept for audit`);
        }
    }
}
async function ensureSettingsSingleton() {
    // Login/setup normally creates the Settings singleton. The seed may run on a
    // fresh DB before setup, so guarantee it exists to keep the app bootable.
    await prisma.settings.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton", storeName: "CEX POS" },
    });
}
async function main() {
    console.log("Seeding canonical portal accounts…\n");
    await ensureSettingsSingleton();
    // Purge BEFORE upserting: a leftover account (e.g. an owner from the one-time
    // setup) may hold an email we want or block deletion via history. Clearing it
    // first keeps the canonical upserts collision-free.
    console.log("Removing other logins:");
    await purgeOtherAccounts();
    console.log("\nUpserting accounts:");
    for (const account of ACCOUNTS) {
        await upsertAccount(account);
    }
    console.log("\nDone. Portal logins:");
    console.log("  Manager : 9876543210 / Manager@123  → /");
    console.log("  Owner   : 9876500000 / Owner@123     → /");
    console.log("  Cashier : 9876511111 / Cashier@123   → /cashier/pos");
}
main()
    .catch((err) => {
    console.error("\nSeed failed:", err);
    process.exit(1);
})
    .finally(() => {
    void prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map