/**
 * Workforce Management feature — public API.
 *
 * The router lazy-imports the pages; nothing else should reach into this
 * feature's internals. Types are exported because other features (dashboards,
 * profile screens) legitimately describe workforce records, and the hooks are
 * exported for the same reason — but the components and the api layer stay
 * private so this module owns how workforce data is fetched and rendered.
 */

export { default as ManagersPage } from "./pages/ManagersPage";
export { default as EmployeesPage } from "./pages/EmployeesPage";
export { default as WorkforceActivityPage } from "./pages/ActivityPage";
export { default as AttendancePage } from "./pages/AttendancePage";
export { default as PerformancePage } from "./pages/PerformancePage";
export { default as LoginHistoryPage } from "./pages/LoginHistoryPage";

export { useWorkforceSummary, workforceKeys } from "./hooks/useWorkforce";

export type {
  AttendanceStatus,
  EmploymentStatus,
  PresenceStatus,
  WorkforceEmployee,
  WorkforceEmployeeDetail,
  WorkforceSummary,
} from "./types";
