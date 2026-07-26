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

  // Only the OWNER sees the enterprise analytics dashboard (revenue, margin,
  // collections, reports). Analytics is owner-only business administration, so
  // routing a MANAGER here would only produce a 403 → fabricated mock numbers.
  if (user.role === "OWNER") {
    return <AdminDashboard />;
  }

  // MANAGER and CASHIER get the operational dashboard — daily execution, no
  // owner analytics. It draws its figures from data these roles can actually
  // read (their own sales), never from the owner-only analytics engine.
  return <EmployeeDashboard />;
}
