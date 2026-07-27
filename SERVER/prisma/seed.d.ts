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
//# sourceMappingURL=seed.d.ts.map