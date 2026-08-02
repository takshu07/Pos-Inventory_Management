/**
 * Users & Roles feature — public API.
 *
 * The router lazy-imports the page; nothing else should reach into this
 * feature's internals. The api layer and components stay private so this module
 * owns how account data is fetched and rendered.
 *
 * `accountRules` is exported because it is the single source of truth for who
 * may administer whom, and other surfaces (nav config, future audit-log
 * filters) legitimately need to ask that question rather than re-deriving it.
 */

export { default as UsersRolesPage } from "./pages/UsersRolesPage";

export { userKeys } from "./hooks/useUsers";

export {
  canAdministerUsers,
  denyModify,
  denyRoleChange,
  denyRoleAssignment,
  denyStatusChange,
  denyPasswordReset,
  assignableRolesFor,
} from "./utils/accountRules";
export type { Actor, Denial } from "./utils/accountRules";

export type {
  AssignableRole,
  CreateUserPayload,
  UpdateUserPayload,
  User,
  UserListParams,
  UserSortBy,
} from "./types";
