import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluateExchangeWindow } from "../exchangeWindow";
import { ConfigurationEngine } from "../../engines/configuration.engine";

/** Mock the config source so tests assert the rule reads from it, not a constant. */
function mockWindow(days: number) {
  vi.spyOn(ConfigurationEngine, "getExchangeSettings").mockReturnValue({
    exchangeWindowDays: days,
    billRequired: true,
    tagsRequired: true,
    managerOverrideRequired: false,
    defaultExchangeReasons: [],
  });
}

const DAY = 1000 * 60 * 60 * 24;
const NOW = new Date("2026-07-24T12:00:00Z");

describe("evaluateExchangeWindow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the window length from ConfigurationEngine, not a hardcoded value", () => {
    mockWindow(7);
    // A 5-day-old sale is rejected under a hardcoded 3-day rule but eligible at 7.
    const saleDate = new Date(NOW.getTime() - 5 * DAY);
    const status = evaluateExchangeWindow(saleDate, NOW);
    expect(status.windowDays).toBe(7);
    expect(status.eligible).toBe(true);
    expect(status.daysRemaining).toBe(2);
  });

  it("treats a same-day sale as day 0 with the full window remaining", () => {
    mockWindow(3);
    const status = evaluateExchangeWindow(NOW, NOW);
    expect(status.elapsedDays).toBe(0);
    expect(status.eligible).toBe(true);
    expect(status.daysRemaining).toBe(3);
  });

  it("keeps a sale eligible on the final day of the window", () => {
    mockWindow(3);
    const saleDate = new Date(NOW.getTime() - 3 * DAY);
    const status = evaluateExchangeWindow(saleDate, NOW);
    expect(status.eligible).toBe(true);
    expect(status.daysRemaining).toBe(0);
  });

  it("rejects a sale once the window has passed and clamps daysRemaining to 0", () => {
    mockWindow(3);
    const saleDate = new Date(NOW.getTime() - 4 * DAY);
    const status = evaluateExchangeWindow(saleDate, NOW);
    expect(status.eligible).toBe(false);
    expect(status.daysRemaining).toBe(0);
  });

  it("honors a 0-day window (exchanges only on the day of purchase)", () => {
    mockWindow(0);
    expect(evaluateExchangeWindow(NOW, NOW).eligible).toBe(true);
    const yesterday = new Date(NOW.getTime() - 1 * DAY);
    expect(evaluateExchangeWindow(yesterday, NOW).eligible).toBe(false);
  });
});
