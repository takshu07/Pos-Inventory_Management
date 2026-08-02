/**
 * The five consolidated report destinations.
 *
 * Twelve report routes used to occupy twelve sidebar rows. They now group into
 * five pages whose tabs are the original reports, unchanged: each tab renders
 * the exact page component that route rendered before, so every filter, chart,
 * table and export behaves identically. Nothing was rewritten — only re-hosted.
 *
 * The original URLs still resolve: /admin/reports/returns redirects to
 * /admin/reports/sales?tab=returns (see app/router). No report became
 * unreachable, and no bookmark broke.
 */

import { TabbedReportPage, type ReportTabDef } from "../components/ReportTabs";

import SalesReportPage from "./SalesReportPage";
import ProductReportPage from "./ProductReportPage";
import ProfitReportPage from "./ProfitReportPage";
import { CategoryReportPage, BrandReportPage } from "./CategoryBrandReportPages";
import { CustomerReportPage, EmployeeReportPage } from "./CustomerEmployeeReportPages";
import {
  InventoryReportPage,
  PurchaseReportPage,
  PaymentReportPage,
  ReturnReportPage,
} from "./OperationsReportPages";

// =============================================================================
// SALES  —  /admin/reports/sales
// =============================================================================
// Spec lists a "Discounts" tab here. There is no discounts report: the backend
// report keys are sales|products|categories|brands|customers|employees|
// inventory|purchases|payments|returns|profit, with no discounts endpoint to
// call. A tab is therefore not added for it rather than shipping one that
// errors. Discount RULES remain fully available under Marketing → Discounts.
const SALES_TABS: ReportTabDef[] = [
  { id: "sales",    label: "Sales",    render: () => <SalesReportPage /> },
  { id: "payments", label: "Payments", render: () => <PaymentReportPage /> },
  { id: "returns",  label: "Returns",  render: () => <ReturnReportPage /> },
];

export function SalesReportsPage() {
  return <TabbedReportPage tabs={SALES_TABS} label="Sales reports" />;
}

// =============================================================================
// INVENTORY  —  /admin/reports/inventory
// =============================================================================
// "Stock" in the spec is the inventory report itself (stock on hand, velocity,
// dead stock buckets), so it is the first tab rather than a duplicate entry.
const INVENTORY_TABS: ReportTabDef[] = [
  { id: "stock",      label: "Stock",      render: () => <InventoryReportPage /> },
  { id: "products",   label: "Products",   render: () => <ProductReportPage /> },
  { id: "categories", label: "Categories", render: () => <CategoryReportPage /> },
  { id: "brands",     label: "Brands",     render: () => <BrandReportPage /> },
  { id: "purchases",  label: "Purchases",  render: () => <PurchaseReportPage /> },
];

export function InventoryReportsPage() {
  return <TabbedReportPage tabs={INVENTORY_TABS} label="Inventory reports" />;
}

// =============================================================================
// CUSTOMERS  —  /admin/reports/customers
// =============================================================================
// One report today. It still goes through TabbedReportPage so that adding a
// second customer report later is a one-line change and the page furniture
// already matches its siblings.
const CUSTOMER_TABS: ReportTabDef[] = [
  { id: "customers", label: "Customers", render: () => <CustomerReportPage /> },
];

export function CustomerReportsPage() {
  return <TabbedReportPage tabs={CUSTOMER_TABS} label="Customer reports" />;
}

// =============================================================================
// EMPLOYEES  —  /admin/reports/employees
// =============================================================================
const EMPLOYEE_TABS: ReportTabDef[] = [
  { id: "employees", label: "Employees", render: () => <EmployeeReportPage /> },
];

export function EmployeeReportsPage() {
  return <TabbedReportPage tabs={EMPLOYEE_TABS} label="Employee reports" />;
}

// =============================================================================
// FINANCE  —  /admin/reports/finance
// =============================================================================
// A new destination the spec asks for. It hosts the existing Profit report,
// which previously sat at /admin/reports/profit — that URL now redirects here.
const FINANCE_TABS: ReportTabDef[] = [
  { id: "profit", label: "Profit & Loss", render: () => <ProfitReportPage /> },
];

export function FinanceReportsPage() {
  return <TabbedReportPage tabs={FINANCE_TABS} label="Finance reports" />;
}
