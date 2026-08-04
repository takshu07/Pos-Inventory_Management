/**
 * Offline synchronization — public surface.
 *
 * ⚠ The app shell must NOT import from this barrel. It re-exports
 * `SyncStatusPage`, which is lazy-loaded; a barrel import from the Navbar would
 * pull that chunk into the main bundle. Import
 * `@/features/sync/components/SyncIndicator` directly there — same rule the
 * notifications feature follows for the same reason.
 */

export { SyncIndicator } from "./components/SyncIndicator";
export { SyncStatusPage } from "./pages/SyncStatusPage";

export {
  useSyncStatus,
  useSyncHealthState,
  useSyncHistory,
  useSyncQueue,
  useSyncConflicts,
  useRunSync,
  useRetryFailedSync,
  deriveSyncHealth,
  syncKeys,
} from "./hooks/useSync";

export { syncApi } from "./api/syncApi";

export type {
  SyncStatus,
  SyncHealth,
  SyncRunSummary,
  SyncQueueItem,
  SyncConflict,
  SyncHealthReport,
  ConnectivityState,
} from "./types";
