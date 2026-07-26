/**
 * @file app/router/index.tsx
 *
 * Purpose: Central route configuration for the entire application.
 *
 * Changes from placeholder version:
 *   1. /login now uses the real LoginView (lazy-loaded from features/auth).
 *   2. /login is wrapped in GuestRoute — authenticated users are redirected away.
 *   3. /admin/* routes are wrapped in AdminRoute — blocks CASHIER role.
 *   4. /unauthorized route added.
 *   5. MainLayout remains the shell for all authenticated routes.
 */

import { createBrowserRouter, Outlet } from "react-router";
import { MainLayout } from "@/components/layouts/MainLayout";
import { CashierLayout } from "@/components/layouts/CashierLayout";
import { useAuthStore, selectRole } from "@/store/auth.store";
import {
  GuestRoute,
  OwnerRoute,
  ManagerRoute,
  CashierRoute,
  AuthBootstrapper,
  SessionExpiredModal,
  canManageProducts,
} from "@/features/auth";

/** 
 * RootLayout runs inside the Router context, providing global auth utilities 
 * that require access to React Router hooks (like useNavigate).
 */
function RootLayout() {
  return (
    <>
      <AuthBootstrapper />
      <SessionExpiredModal />
      <Outlet />
    </>
  );
}

/** Placeholder page until a feature's view is implemented */
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">
        This module is being built. Route, layout, and navigation are wired.
      </p>
      <div className="mt-6 h-48 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
        {title} — Implementation in Progress
      </div>
    </div>
  );
}

/**
 * Products screen placeholder that is role-aware: OWNER sees a "full CRUD"
 * affordance, MANAGER sees an explicit read-only banner. This makes the
 * read-only-for-manager rule concrete today and models how the real Products
 * view should gate its create/edit actions behind `canManageProducts`.
 */
function ProductsPlaceholder() {
  const role = useAuthStore(selectRole);
  const canEdit = canManageProducts(role);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Products</h1>
        {canEdit ? (
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            + New Product
          </button>
        ) : (
          <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
            Read-only — editing is owner-only
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {canEdit
          ? "Full catalog management. Create, edit, and price products."
          : "You can view the catalog. Product changes are restricted to the owner."}
      </p>
      <div className="mt-6 h-48 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
        Products — Implementation in Progress
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    HydrateFallback: () => null, // Silences the React Router hydration warning
    children: [
      // ─── Public Routes (Guest only — redirect authenticated users) ───────────
      {
        // GuestRoute redirects authenticated users to dashboard
        Component: GuestRoute,
        children: [
      {
        path: "/login",
        async lazy() {
          const { default: LoginView } = await import("@/features/auth/views/LoginView");
          return { Component: LoginView };
        },
      },
    ],
  },

  // ─── Error / Info Routes (accessible by all) ─────────────────────────────
  {
    path: "/unauthorized",
    async lazy() {
      const { default: UnauthorizedView } = await import("@/features/auth/views/UnauthorizedView");
      return { Component: UnauthorizedView };
    },
  },

  // ─── Manager / Owner Portal (management shell) ───────────────────────────
  // ManagerRoute gates the entire subtree: a CASHIER who types any of these
  // URLs is redirected to their own portal (/cashier/pos). MainLayout then
  // provides the shell (Sidebar + Navbar). AdminRoute further narrows the
  // admin-only screens to MANAGER/OWNER within this manager portal.
  {
    Component: ManagerRoute,
    children: [
  {
    path: "/",
    Component: MainLayout, // Contains isAuthenticated guard + Sidebar + Navbar
    children: [
      // Manager + Owner screens
      {
        index: true,
        async lazy() {
          const { DashboardView } = await import("@/features/dashboard");
          return { Component: DashboardView };
        },
      },
      {
        path: "pos",
        async lazy() {
          const { PosView } = await import("@/features/pos");
          return { Component: PosView };
        },
      },
      {
        path: "sales",
        async lazy() {
          const { SalesHistoryView } = await import("@/features/sales");
          return { Component: SalesHistoryView };
        },
      },
      {
        path: "sales/:saleId",
        async lazy() {
          const { InvoiceView } = await import("@/features/sales");
          return { Component: InvoiceView };
        },
      },
      {
        path: "customers",
        async lazy() {
          const { CustomersView } = await import("@/features/customers");
          return { Component: CustomersView };
        },
      },
      {
        path: "customers/:customerId",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Customer Profile" /> };
        },
      },
      {
        path: "profile",
        async lazy() {
          return { Component: () => <PlaceholderPage title="My Profile" /> };
        },
      },
      {
        path: "notifications",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Notifications" /> };
        },
      },

      // ── Operational screens visible to MANAGER + OWNER ────────────────────
      // Products and Product Lookup are READ-ONLY for managers (the view hides
      // create/edit actions via canManageProducts); owners get full CRUD on the
      // same screens. Employee Activity is a read-only staff monitor. These are
      // deliberately OUTSIDE OwnerRoute so managers can reach them.
      {
        path: "products/lookup",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Product Lookup (read-only)" /> };
        },
      },
      {
        path: "admin/products",
        async lazy() {
          return { Component: ProductsPlaceholder };
        },
      },
      {
        path: "admin/employees",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Employee Activity" /> };
        },
      },

      // ── Business administration — OWNER only (wrapped in OwnerRoute) ───────
      // A MANAGER who types any of these URLs is redirected to /unauthorized by
      // OwnerRoute; the backend independently returns 403. Nav links are hidden
      // from managers, but the guard — not the hiding — is the boundary.
      {
        Component: OwnerRoute,
        children: [
          {
            path: "finance/register",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Cash Register" /> };
            },
          },
          {
            path: "admin/categories",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Category Management" /> };
            },
          },
          {
            path: "admin/brands",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Brand Management" /> };
            },
          },
          {
            path: "admin/suppliers",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Supplier Management" /> };
            },
          },
          {
            path: "admin/purchases",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Purchase Management" /> };
            },
          },
          {
            path: "admin/inventory",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Inventory" /> };
            },
          },
          {
            path: "admin/reports",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Reports" /> };
            },
          },
          {
            path: "admin/finance",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Finance" /> };
            },
          },
          {
            path: "admin/discounts",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Discounts" /> };
            },
          },
          {
            path: "admin/settings",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Settings" /> };
            },
          },
          {
            path: "admin/audit-logs",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Audit Logs" /> };
            },
          },
        ],
      },
    ],
  },
    ],
  },

  // ─── Cashier Portal (checkout-first shell) ───────────────────────────────
  // CashierRoute gates the entire subtree to the CASHIER role: a MANAGER/OWNER
  // who navigates here is redirected to their management shell. CashierLayout
  // provides the minimal shell (POS Checkout + My Profile only). The POS screen
  // is the SAME PosView component the manager portal uses — no duplicated
  // checkout logic; only the surrounding shell and permitted routes differ.
  {
    Component: CashierRoute,
    children: [
      {
        path: "/cashier",
        Component: CashierLayout,
        children: [
          {
            index: true,
            async lazy() {
              const { PosView } = await import("@/features/pos");
              return { Component: PosView };
            },
          },
          {
            path: "pos",
            async lazy() {
              const { PosView } = await import("@/features/pos");
              return { Component: PosView };
            },
          },
          {
            path: "profile",
            async lazy() {
              return { Component: () => <PlaceholderPage title="My Profile" /> };
            },
          },
        ],
      },
    ],
  },

  // ─── 404 ─────────────────────────────────────────────────────────────────
  {
    path: "*",
    Component: () => (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <p className="text-muted-foreground">Page not found.</p>
      </div>
    ),
      },
    ],
  },
]);
