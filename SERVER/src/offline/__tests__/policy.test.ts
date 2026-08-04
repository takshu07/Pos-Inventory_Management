// =============================================================================
// SYNC POLICY — CLASSIFICATION AND AUTHORITY
//
// ⚠ Partly a SECURITY suite. The direction rules are what stop an edge node
// writing to cloud-authoritative tables, and the Employee case in particular is
// a privilege-escalation boundary: if a till could author an Employee row it
// could mint itself an OWNER account and sync it up.
//
// The completeness test guards the more insidious failure. Adding a table
// without classifying it means its local writes are never captured and never
// uploaded — silent, permanent data loss, introduced by the single most
// ordinary act in this codebase.
// =============================================================================

import { describe, expect, it } from "vitest";

import manifest from "../../../prisma/local/manifest.json" with { type: "json" };
import {
  allPolicies,
  capturedTables,
  downloadEntities,
  entityForTable,
  policyFor,
  requirePolicy,
  uploadEntities,
} from "../sync/policy";

// =============================================================================
// COMPLETENESS
// =============================================================================

describe("classification completeness", () => {
  it("classifies every model in the mirrored schema", () => {
    const classified = new Set(allPolicies().map((p) => p.entity));
    const missing = manifest.models
      .map((model) => model.name)
      .filter((name) => !classified.has(name));

    expect(missing).toEqual([]);
  });

  it("classifies nothing that is not in the schema", () => {
    const known = new Set(manifest.models.map((model) => model.name));
    const phantom = allPolicies()
      .map((p) => p.entity)
      .filter((entity) => !known.has(entity));

    expect(phantom).toEqual([]);
  });

  it("resolves each policy's table and primary key from the manifest", () => {
    for (const policy of allPolicies()) {
      const model = manifest.models.find((m) => m.name === policy.entity);

      expect(model?.table).toBe(policy.table);
      expect(model?.primaryKey).toBe(policy.primaryKey);
    }
  });

  it("gives every entity a unique download order", () => {
    const orders = allPolicies().map((p) => p.downloadOrder);

    expect(new Set(orders).size).toBe(orders.length);
  });
});

// =============================================================================
// AUTHORITY — the security boundary
// =============================================================================

describe("write authority", () => {
  it("never lets a device author identity or permissions", () => {
    // A till that could upload an Employee row could create an OWNER and sync
    // it up. This must stay DOWN-only.
    expect(policyFor("Employee")?.direction).toBe("DOWN");
    expect(policyFor("Employee")?.conflictWinner).toBe("CLOUD");
  });

  it("never lets a device author the catalog, prices or settings", () => {
    for (const entity of [
      "Product",
      "ProductVariant",
      "Category",
      "Brand",
      "Supplier",
      "Settings",
      "DiscountRule",
      "Coupon",
      "Promotion",
    ]) {
      expect(policyFor(entity)?.direction, entity).toBe("DOWN");
      expect(policyFor(entity)?.conflictWinner, entity).toBe("CLOUD");
    }
  });

  it("makes the till authoritative for everything that records a real event", () => {
    for (const entity of [
      "Sale",
      "SaleItem",
      "Payment",
      "Exchange",
      "InventoryMovement",
      "Attendance",
      "Expense",
      "CashRegister",
      "CashTransaction",
    ]) {
      expect(policyFor(entity)?.direction, entity).toBe("UP");
      expect(policyFor(entity)?.conflictWinner, entity).toBe("LOCAL");
    }
  });

  it("uploads the audit trail — a trail with the offline day missing is not a trail", () => {
    expect(policyFor("AuditLog")?.direction).toBe("UP");
  });

  it("keeps device-local records off the wire", () => {
    for (const entity of ["PrintJob", "PrintJobItem", "Asset", "InventorySnapshot"]) {
      expect(policyFor(entity)?.direction, entity).toBe("LOCAL_ONLY");
    }
  });

  it("lets a walk-in customer signed up at the till reach the cloud", () => {
    expect(policyFor("Customer")?.direction).toBe("BIDIRECTIONAL");
    // Cloud still wins on a row it already has — head office may have merged
    // duplicates.
    expect(policyFor("Customer")?.conflictWinner).toBe("CLOUD");
  });
});

// =============================================================================
// DERIVED SETS
// =============================================================================

describe("derived sets", () => {
  it("captures exactly the UP and BIDIRECTIONAL tables", () => {
    const expected = allPolicies()
      .filter((p) => p.direction === "UP" || p.direction === "BIDIRECTIONAL")
      .map((p) => p.table)
      .sort();

    expect([...capturedTables()].sort()).toEqual(expected);
  });

  it("never captures a cloud-authoritative table", () => {
    // A trigger on a DOWN table would queue the cloud's own data straight back
    // up on every download.
    const captured = new Set(capturedTables());

    for (const policy of allPolicies()) {
      if (policy.direction === "DOWN") {
        expect(captured.has(policy.table), policy.entity).toBe(false);
      }
    }
  });

  it("downloads in dependency-safe order — parents before children", () => {
    const order = downloadEntities().map((p) => p.entity);
    const positionOf = (entity: string) => order.indexOf(entity);

    // Local FK enforcement is deliberately ON, so a variant arriving before its
    // product would be rejected outright.
    expect(positionOf("Category")).toBeLessThan(positionOf("Product"));
    expect(positionOf("Brand")).toBeLessThan(positionOf("Product"));
    expect(positionOf("Product")).toBeLessThan(positionOf("ProductVariant"));
    expect(positionOf("Supplier")).toBeLessThan(positionOf("ProductVariant"));
    expect(positionOf("Customer")).toBeLessThan(positionOf("CustomerAddress"));
  });

  it("includes BIDIRECTIONAL entities in both directions", () => {
    const down = new Set(downloadEntities().map((p) => p.entity));
    const up = new Set(uploadEntities().map((p) => p.entity));

    expect(down.has("Customer")).toBe(true);
    expect(up.has("Customer")).toBe(true);
  });

  it("maps a physical table back to its policy", () => {
    expect(entityForTable("sales")?.entity).toBe("Sale");
    expect(entityForTable("inventory_movements")?.entity).toBe("InventoryMovement");
    expect(entityForTable("no_such_table")).toBeUndefined();
  });

  it("throws a named error for an unknown entity rather than returning undefined", () => {
    expect(() => requirePolicy("Nonexistent")).toThrow(/No sync policy/);
  });
});
