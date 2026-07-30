/**
 * Staff roster (/admin/staff).
 *
 * A thin variant binding over RosterPage — see ManagersPage for why the two
 * rosters are separate files over one shared component.
 */

import { RosterPage } from "./RosterPage";

export default function EmployeesPage() {
  return <RosterPage variant="staff" />;
}
