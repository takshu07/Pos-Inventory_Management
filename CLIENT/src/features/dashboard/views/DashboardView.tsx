/**
 * @file features/dashboard/views/DashboardView.tsx
 *
 * Purpose: Smart container that renders the appropriate dashboard layout 
 * based on the current user's role (RBAC).
 *
 * Architecture Note:
 * - We do NOT conditionally render inside a single mega-component.
 * - AdminDashboard and EmployeeDashboard are entirely separate components 
 *   with their own layout concerns and data requirements.
 */

import { useAuthStore } from "@/store/auth.store";
import { AdminDashboard } from "../components/admin/AdminDashboard";
import { EmployeeDashboard } from "../components/employee/EmployeeDashboard";

export default function DashboardView() {
  const user = useAuthStore((s) => s.user);

  // If user is somehow null (should be caught by route guard, but type safety), return empty
  if (!user) return null;

  // Owners and Managers get the full enterprise analytics dashboard
  if (user.role === "OWNER" || user.role === "MANAGER") {
    return <AdminDashboard />;
  }

  // Cashiers get the operational daily execution dashboard
  return <EmployeeDashboard />;
}
