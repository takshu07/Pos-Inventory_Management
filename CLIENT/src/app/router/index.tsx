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
import { GuestRoute, AdminRoute, AuthBootstrapper, SessionExpiredModal } from "@/features/auth";

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

  // ─── Authenticated Routes (all roles — protected by MainLayout) ──────────
  {
    path: "/",
    Component: MainLayout, // Contains isAuthenticated guard + Sidebar + Navbar
    children: [
      // Employee-level screens (Cashier + Manager + Owner)
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
        path: "exchanges",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Exchange" /> };
        },
      },
      {
        path: "customers",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Customers" /> };
        },
      },
      {
        path: "customers/:customerId",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Customer Profile" /> };
        },
      },
      {
        path: "products/lookup",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Product Lookup" /> };
        },
      },
      {
        path: "finance/register",
        async lazy() {
          return { Component: () => <PlaceholderPage title="Cash Register" /> };
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

      // Admin-level screens (Manager + Owner only — wrapped in AdminRoute)
      {
        Component: AdminRoute,
        children: [
          {
            path: "admin/products",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Product Management" /> };
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
            path: "admin/employees",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Employee Management" /> };
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
