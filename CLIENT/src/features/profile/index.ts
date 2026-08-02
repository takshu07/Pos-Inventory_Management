/**
 * My Profile feature — public API.
 *
 * ONE view, mounted by the router at both `/profile` (manager portal) and
 * `/cashier/profile` (cashier portal). See ProfileView's header for why it is
 * a single implementation rather than one per portal.
 */

export { default as ProfileView } from "./views/ProfileView";

export type { ProfileUser } from "./types";
