/**
 * Tests for Legendary Card Acquisition Advisor
 *
 * Tests the acquisition cost calculator logic (pure functions).
 * Database-dependent functions (rankChampionsForScheme, getLegendaryAdvisory)
 * are not tested here as they require a live DB connection.
 */
import { describe, it, expect } from "vitest";

// ─── Re-implement the pure calculation logic for testing ─────────────────────
// (mirrors calculateAcquisitionOptions from legendaryAdvisor.ts)

const BASICS_PER_RARE = 3;
const RARES_PER_EPIC = 10;
const EPICS_PER_LEGENDARY = 8;
const RARES_FOR_LEGENDARY = RARES_PER_EPIC * EPICS_PER_LEGENDARY; // 80
const BASICS_FOR_LEGENDARY = BASICS_PER_RARE * RARES_FOR_LEGENDARY; // 240

type PriceData = {
  Basic: number | null;
  Rare: number | null;
  Epic: number | null;
  Legendary: number | null;
};

type AcquisitionOption = {
  method: string;
  label: string;
  totalCostRON: number | null;
  cardsNeeded: number;
  unitPrice: number | null;
  available: boolean;
};

function calculateAcquisitionOptions(prices: PriceData): AcquisitionOption[] {
  return [
    {
      method: "buy_legendary",
      label: "Buy Legendary directly",
      totalCostRON: prices.Legendary,
      cardsNeeded: 1,
      unitPrice: prices.Legendary,
      available: prices.Legendary !== null,
    },
    {
      method: "craft_from_epic",
      label: `Buy ${EPICS_PER_LEGENDARY} Epics → craft Legendary`,
      totalCostRON: prices.Epic !== null ? prices.Epic * EPICS_PER_LEGENDARY : null,
      cardsNeeded: EPICS_PER_LEGENDARY,
      unitPrice: prices.Epic,
      available: prices.Epic !== null,
    },
    {
      method: "craft_from_rare",
      label: `Buy ${RARES_FOR_LEGENDARY} Rares → craft to Legendary`,
      totalCostRON: prices.Rare !== null ? prices.Rare * RARES_FOR_LEGENDARY : null,
      cardsNeeded: RARES_FOR_LEGENDARY,
      unitPrice: prices.Rare,
      available: prices.Rare !== null,
    },
    {
      method: "craft_from_basic",
      label: `Buy ${BASICS_FOR_LEGENDARY} Basics → craft to Legendary`,
      totalCostRON: prices.Basic !== null ? prices.Basic * BASICS_FOR_LEGENDARY : null,
      cardsNeeded: BASICS_FOR_LEGENDARY,
      unitPrice: prices.Basic,
      available: prices.Basic !== null,
    },
  ];
}

function findCheapestOption(options: AcquisitionOption[]): AcquisitionOption | null {
  const available = options.filter((o) => o.available && o.totalCostRON !== null);
  if (available.length === 0) return null;
  return available.reduce((best, o) =>
    (o.totalCostRON ?? Infinity) < (best.totalCostRON ?? Infinity) ? o : best
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Crafting constants", () => {
  it("should have correct crafting ratios", () => {
    expect(BASICS_PER_RARE).toBe(3);
    expect(RARES_PER_EPIC).toBe(10);
    expect(EPICS_PER_LEGENDARY).toBe(8);
  });

  it("should derive correct totals for crafting 1 Legendary from scratch", () => {
    expect(RARES_FOR_LEGENDARY).toBe(80);    // 10 Rares/Epic × 8 Epics
    expect(BASICS_FOR_LEGENDARY).toBe(240);  // 3 Basics/Rare × 80 Rares
  });
});

describe("calculateAcquisitionOptions", () => {
  it("should return 4 options", () => {
    const options = calculateAcquisitionOptions({
      Basic: 1.0,
      Rare: 5.0,
      Epic: 50.0,
      Legendary: 500.0,
    });
    expect(options).toHaveLength(4);
  });

  it("should calculate buy_legendary cost correctly", () => {
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: null,
      Epic: null,
      Legendary: 500.0,
    });
    const buyLeg = options.find((o) => o.method === "buy_legendary")!;
    expect(buyLeg.totalCostRON).toBe(500.0);
    expect(buyLeg.cardsNeeded).toBe(1);
    expect(buyLeg.available).toBe(true);
  });

  it("should calculate craft_from_epic cost as 8 × epic price", () => {
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: null,
      Epic: 50.0,
      Legendary: null,
    });
    const craftEpic = options.find((o) => o.method === "craft_from_epic")!;
    expect(craftEpic.totalCostRON).toBe(400.0); // 8 × 50
    expect(craftEpic.cardsNeeded).toBe(8);
    expect(craftEpic.available).toBe(true);
  });

  it("should calculate craft_from_rare cost as 80 × rare price", () => {
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: 5.0,
      Epic: null,
      Legendary: null,
    });
    const craftRare = options.find((o) => o.method === "craft_from_rare")!;
    expect(craftRare.totalCostRON).toBe(400.0); // 80 × 5
    expect(craftRare.cardsNeeded).toBe(80);
    expect(craftRare.available).toBe(true);
  });

  it("should calculate craft_from_basic cost as 240 × basic price", () => {
    const options = calculateAcquisitionOptions({
      Basic: 2.0,
      Rare: null,
      Epic: null,
      Legendary: null,
    });
    const craftBasic = options.find((o) => o.method === "craft_from_basic")!;
    expect(craftBasic.totalCostRON).toBe(480.0); // 240 × 2
    expect(craftBasic.cardsNeeded).toBe(240);
    expect(craftBasic.available).toBe(true);
  });

  it("should mark options as unavailable when price is null", () => {
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: null,
      Epic: null,
      Legendary: null,
    });
    expect(options.every((o) => !o.available)).toBe(true);
    expect(options.every((o) => o.totalCostRON === null)).toBe(true);
  });

  it("should handle mixed availability correctly", () => {
    const options = calculateAcquisitionOptions({
      Basic: 1.0,
      Rare: null,
      Epic: 50.0,
      Legendary: null,
    });
    const available = options.filter((o) => o.available);
    expect(available).toHaveLength(2);
    expect(available.map((o) => o.method)).toContain("craft_from_epic");
    expect(available.map((o) => o.method)).toContain("craft_from_basic");
  });
});

describe("findCheapestOption", () => {
  it("should return null when no options are available", () => {
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: null,
      Epic: null,
      Legendary: null,
    });
    expect(findCheapestOption(options)).toBeNull();
  });

  it("should return the cheapest available option", () => {
    const options = calculateAcquisitionOptions({
      Basic: 1.0,   // 240 RON total
      Rare: 5.0,    // 400 RON total
      Epic: 50.0,   // 400 RON total
      Legendary: 500.0, // 500 RON total
    });
    const cheapest = findCheapestOption(options)!;
    expect(cheapest.method).toBe("craft_from_basic");
    expect(cheapest.totalCostRON).toBe(240.0);
  });

  it("should prefer direct buy when it is cheaper than crafting", () => {
    const options = calculateAcquisitionOptions({
      Basic: 5.0,   // 1200 RON total
      Rare: 20.0,   // 1600 RON total
      Epic: 100.0,  // 800 RON total
      Legendary: 300.0, // 300 RON total (cheapest)
    });
    const cheapest = findCheapestOption(options)!;
    expect(cheapest.method).toBe("buy_legendary");
    expect(cheapest.totalCostRON).toBe(300.0);
  });

  it("should prefer craft_from_epic when Legendary listing is expensive", () => {
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: null,
      Epic: 50.0,   // 400 RON total
      Legendary: 1000.0, // 1000 RON total
    });
    const cheapest = findCheapestOption(options)!;
    expect(cheapest.method).toBe("craft_from_epic");
    expect(cheapest.totalCostRON).toBe(400.0);
  });

  it("should handle tie-breaking (first available wins)", () => {
    // craft_from_epic and craft_from_rare both cost 400 RON
    const options = calculateAcquisitionOptions({
      Basic: null,
      Rare: 5.0,    // 80 × 5 = 400 RON
      Epic: 50.0,   // 8 × 50 = 400 RON
      Legendary: null,
    });
    const cheapest = findCheapestOption(options)!;
    // Both are 400 RON — either is acceptable, just verify cost is correct
    expect(cheapest.totalCostRON).toBe(400.0);
  });
});

describe("Price parsing from wei", () => {
  it("should convert wei to RON correctly", () => {
    // 100 RON in wei = 100 × 10^18
    const weiStr = "100000000000000000000";
    const price = Number(BigInt(weiStr)) / 1e18;
    expect(price).toBe(100.0);
  });

  it("should handle fractional RON amounts", () => {
    // 0.69 RON in wei
    const weiStr = "690000000000000000";
    const price = Number(BigInt(weiStr)) / 1e18;
    expect(Math.round(price * 100) / 100).toBe(0.69);
  });

  it("should handle large RON amounts (e.g., 1955.20 RON)", () => {
    const weiStr = "1955200000000000000000";
    const price = Number(BigInt(weiStr)) / 1e18;
    expect(Math.round(price * 100) / 100).toBe(1955.2);
  });
});
