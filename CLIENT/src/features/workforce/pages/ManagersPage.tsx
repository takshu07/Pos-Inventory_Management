/**
 * Managers roster (/admin/managers).
 *
 * A thin variant binding over RosterPage — the two rosters differ only in the
 * endpoint, the columns and the copy, all of which RosterPage takes as a
 * `variant`. It is a separate file purely so the router can lazy-load each
 * roster on its own route.
 */

import { RosterPage } from "./RosterPage";

export default function ManagersPage() {
  return <RosterPage variant="managers" />;
}
