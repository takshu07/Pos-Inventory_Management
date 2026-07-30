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
import {
  GuestRoute,
  OwnerRoute,
  ManagerRoute,
  CashierRoute,
  AuthBootstrapper,
  SessionExpiredModal,
} from "@/features/auth";
import { RouteProgress } from "@/components/ui";

/**
 * RootLayout runs inside the Router context, providing global auth utilities
 * that require access to React Router hooks (like useNavigate).
 *
 * RouteProgress lives here rather than in MainLayout/CashierLayout so that a
 * SINGLE bar covers every navigation in the app — including login → portal and
 * the cross-portal redirects the role guards perform. Every route below is
 * lazy(), so without it a click has no visible effect until its chunk lands.
 */
function RootLayout() {
  return (
    <>
      <RouteProgress />
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
      // The Manager Product Catalog (/products and /products/lookup) is the
      // READ-ONLY operational module: fast search, filters, and read-only product
      // detail. It is deliberately OUTSIDE OwnerRoute so managers can reach it,
      // and hits the manager-scoped (financial-free, GET-only) backend. Employee
      // Activity is a read-only staff monitor.
      {
        path: "products",
        async lazy() {
          const { ManagerProductsPage } = await import("@/features/manager/products");
          return { Component: ManagerProductsPage };
        },
      },
      {
        path: "products/lookup",
        async lazy() {
          const { ManagerProductsPage } = await import("@/features/manager/products");
          return { Component: ManagerProductsPage };
        },
      },
      // The Manager Category Browser (/categories) is the READ-ONLY companion to
      // the product catalog: browse how the catalog is organised, then jump into
      // a category's products. Like /products it sits OUTSIDE OwnerRoute and hits
      // the manager-scoped (GET-only) backend. Owners administer categories at
      // /admin/categories instead, so there is one category entry point per role.
      {
        path: "categories",
        async lazy() {
          const { ManagerCategoriesPage } = await import("@/features/manager/categories");
          return { Component: ManagerCategoriesPage };
        },
      },
      // ── Workforce Management — read-only monitoring (MANAGER + OWNER) ─────
      // Deliberately OUTSIDE OwnerRoute: watching who is on shift, what the
      // team is doing and how attendance is tracking is operational work a
      // manager must be able to do. Every page here reads from the
      // manager-scoped (GET-only) workforce tree, and the backend narrows the
      // payload by actor — salary, for instance, is stripped for managers.
      // The OWNER-only writes (edit employee, change role, reset password)
      // live on the owner tree and 403 independently of any nav hiding.
      {
        path: "admin/employees",
        async lazy() {
          const { WorkforceActivityPage } = await import("@/features/workforce");
          return { Component: WorkforceActivityPage };
        },
      },
      {
        path: "admin/managers",
        async lazy() {
          const { ManagersPage } = await import("@/features/workforce");
          return { Component: ManagersPage };
        },
      },
      {
        path: "admin/staff",
        async lazy() {
          const { EmployeesPage } = await import("@/features/workforce");
          return { Component: EmployeesPage };
        },
      },
      {
        path: "admin/attendance",
        async lazy() {
          const { AttendancePage } = await import("@/features/workforce");
          return { Component: AttendancePage };
        },
      },
      {
        path: "admin/performance",
        async lazy() {
          const { PerformancePage } = await import("@/features/workforce");
          return { Component: PerformancePage };
        },
      },
      {
        path: "admin/login-history",
        async lazy() {
          const { LoginHistoryPage } = await import("@/features/workforce");
          return { Component: LoginHistoryPage };
        },
      },

      // ── Label printing — operational (MANAGER + OWNER) ─────────────────────
      // Deliberately OUTSIDE OwnerRoute: printing labels and watching the queue
      // is shop-floor work a manager must be able to do. Printer/template
      // CONFIGURATION lives at /admin/labels inside OwnerRoute instead, and the
      // backend enforces that split independently.
      {
        path: "labels",
        async lazy() {
          const { default: LabelPrintingPage } = await import(
            "@/features/labels/pages/LabelPrintingPage"
          );
          return { Component: LabelPrintingPage };
        },
      },

      // ── Business administration — OWNER only (wrapped in OwnerRoute) ───────
      // A MANAGER who types any of these URLs is redirected to /unauthorized by
      // OwnerRoute; the backend independently returns 403. Nav links are hidden
      // from managers, but the guard — not the hiding — is the boundary.
      {
        Component: OwnerRoute,
        children: [
          // ── Owner Product Management — full catalog CRUD (OWNER only) ─────────
          // The complete administration module: dashboard, financial columns,
          // create/edit/delete/archive/duplicate, pricing & stock. A MANAGER who
          // types this URL is redirected to /unauthorized by OwnerRoute, and every
          // write independently returns 403 from the OWNER-gated backend.
          {
            path: "admin/products",
            async lazy() {
              const { OwnerProductsPage } = await import("@/features/owner/products");
              return { Component: OwnerProductsPage };
            },
          },
          {
            path: "finance/register",
            async lazy() {
              return { Component: () => <PlaceholderPage title="Cash Register" /> };
            },
          },
          // ── Owner Category Management — full CRUD + analytics (OWNER only) ──
          // Create/edit/archive/safe-delete, bulk actions, images, discounts and
          // the activity timeline. Analytics is a separate route because that
          // query is expensive and shouldn't run just to rename a category.
          {
            path: "admin/categories",
            async lazy() {
              const { OwnerCategoriesPage } = await import("@/features/owner/categories");
              return { Component: OwnerCategoriesPage };
            },
          },
          {
            path: "admin/categories/analytics",
            async lazy() {
              const { OwnerCategoryAnalyticsPage } = await import("@/features/owner/categories");
              return { Component: OwnerCategoryAnalyticsPage };
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
          // ── Inventory — the stock ledger (OWNER full surface) ─────────────
          // Managers reach a narrowed version of these same screens through
          // the manager API tree; the service strips cost figures for them and
          // the mutating endpoints are absent from their routes entirely.
          {
            path: "admin/inventory",
            async lazy() {
              const { InventoryDashboardPage } = await import("@/features/inventory");
              return { Component: InventoryDashboardPage };
            },
          },
          {
            path: "admin/inventory/stock",
            async lazy() {
              const { StockOverviewPage } = await import("@/features/inventory");
              return { Component: StockOverviewPage };
            },
          },
          {
            path: "admin/inventory/movements",
            async lazy() {
              const { MovementsPage } = await import("@/features/inventory");
              return { Component: MovementsPage };
            },
          },
          {
            path: "admin/inventory/adjustments",
            async lazy() {
              const { AdjustmentsPage } = await import("@/features/inventory");
              return { Component: AdjustmentsPage };
            },
          },
          {
            path: "admin/inventory/cycle-counts",
            async lazy() {
              const { CycleCountsPage } = await import("@/features/inventory");
              return { Component: CycleCountsPage };
            },
          },
          {
            path: "admin/inventory/cycle-counts/:countId",
            async lazy() {
              const { CycleCountSessionPage } = await import("@/features/inventory");
              return { Component: CycleCountSessionPage };
            },
          },
          {
            path: "admin/inventory/valuation",
            async lazy() {
              const { ValuationPage } = await import("@/features/inventory");
              return { Component: ValuationPage };
            },
          },
          {
            path: "admin/inventory/damaged",
            async lazy() {
              const { DamagedStockPage } = await import("@/features/inventory");
              return { Component: DamagedStockPage };
            },
          },
          {
            path: "admin/inventory/low-stock",
            async lazy() {
              const { LowStockPage } = await import("@/features/inventory");
              return { Component: LowStockPage };
            },
          },
          {
            path: "admin/inventory/out-of-stock",
            async lazy() {
              const { OutOfStockPage } = await import("@/features/inventory");
              return { Component: OutOfStockPage };
            },
          },
          {
            path: "admin/inventory/reorder",
            async lazy() {
              const { ReorderPage } = await import("@/features/inventory");
              return { Component: ReorderPage };
            },
          },
          {
            path: "admin/inventory/dead-stock",
            async lazy() {
              const { DeadStockPage } = await import("@/features/inventory");
              return { Component: DeadStockPage };
            },
          },
          {
            path: "admin/inventory/fast-moving",
            async lazy() {
              const { FastMovingPage } = await import("@/features/inventory");
              return { Component: FastMovingPage };
            },
          },
          {
            path: "admin/inventory/slow-moving",
            async lazy() {
              const { SlowMovingPage } = await import("@/features/inventory");
              return { Component: SlowMovingPage };
            },
          },
          // Label Engine administration: printers, templates and defaults.
          // OWNER-only — "never expose printer management to Managers or
          // Cashiers" is enforced here AND by requireRole("OWNER") server-side.
          {
            path: "admin/labels",
            async lazy() {
              const { default: LabelSettingsPage } = await import(
                "@/features/labels/pages/LabelSettingsPage"
              );
              return { Component: LabelSettingsPage };
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
          // ── Catalog Discounts — the shelf-price rule layer (OWNER only) ──────
          // Rules here feed ProductVariant.sellingPrice through the pricing
          // engine. Cart-level promotions applied at checkout are separate.
          {
            path: "admin/discounts",
            async lazy() {
              const { DiscountsPage } = await import("@/features/owner/discounts");
              return { Component: DiscountsPage };
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
