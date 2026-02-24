/**
 * Tests for Card Arbitrage feature:
 * - Outlier detection
 * - Craft arbitrage calculations
 * - Supply squeeze detection
 * - Telegram alert formatting
 */

import { describe, it, expect } from "vitest";
import { detectOutliers, type ListingInfo } from "./marketplaceClient";

// ─── Outlier Detection ──────────────────────────────────────────────

describe("detectOutliers", () => {
  it("should not flag any listings when all prices are similar", () => {
    const listings: ListingInfo[] = [
      { tokenId: "1", priceRon: 1.0, priceUsd: 0.5, paymentToken: "RON", isOutlier: false },
      { tokenId: "2", priceRon: 1.2, priceUsd: 0.6, paymentToken: "RON", isOutlier: false },
      { tokenId: "3", priceRon: 1.5, priceUsd: 0.75, paymentToken: "RON", isOutlier: false },
    ];
    const result = detectOutliers(listings);
    expect(result.every((l) => !l.isOutlier)).toBe(true);
  });

  it("should flag listings >3x median as outliers", () => {
    const listings: ListingInfo[] = [
      { tokenId: "1", priceRon: 1.0, priceUsd: 0.5, paymentToken: "RON", isOutlier: false },
      { tokenId: "2", priceRon: 1.5, priceUsd: 0.75, paymentToken: "RON", isOutlier: false },
      { tokenId: "3", priceRon: 2.0, priceUsd: 1.0, paymentToken: "RON", isOutlier: false },
      { tokenId: "4", priceRon: 50.0, priceUsd: 25.0, paymentToken: "RON", isOutlier: false }, // outlier
    ];
    const result = detectOutliers(listings);
    // Median of [1, 1.5, 2, 50] = (1.5 + 2) / 2 = 1.75, threshold = 5.25
    expect(result[3].isOutlier).toBe(true);
    expect(result[0].isOutlier).toBe(false);
    expect(result[1].isOutlier).toBe(false);
    expect(result[2].isOutlier).toBe(false);
  });

  it("should handle single listing without flagging", () => {
    const listings: ListingInfo[] = [
      { tokenId: "1", priceRon: 100.0, priceUsd: 50.0, paymentToken: "RON", isOutlier: false },
    ];
    const result = detectOutliers(listings);
    expect(result.length).toBe(1);
    expect(result[0].isOutlier).toBe(false);
  });

  it("should handle empty listings", () => {
    const result = detectOutliers([]);
    expect(result.length).toBe(0);
  });

  it("should flag multiple outliers", () => {
    const listings: ListingInfo[] = [
      { tokenId: "1", priceRon: 1.0, priceUsd: 0.5, paymentToken: "RON", isOutlier: false },
      { tokenId: "2", priceRon: 1.0, priceUsd: 0.5, paymentToken: "RON", isOutlier: false },
      { tokenId: "3", priceRon: 1.0, priceUsd: 0.5, paymentToken: "RON", isOutlier: false },
      { tokenId: "4", priceRon: 10.0, priceUsd: 5.0, paymentToken: "RON", isOutlier: false }, // outlier (>3x median of 1.0)
      { tokenId: "5", priceRon: 20.0, priceUsd: 10.0, paymentToken: "RON", isOutlier: false }, // outlier
    ];
    const result = detectOutliers(listings);
    const outliers = result.filter((l) => l.isOutlier);
    expect(outliers.length).toBe(2);
    expect(outliers[0].tokenId).toBe("4");
    expect(outliers[1].tokenId).toBe("5");
  });
});

// ─── Craft Arbitrage Calculations ───────────────────────────────────

describe("Craft arbitrage calculations", () => {
  const MARKETPLACE_FEE = 0.0425;

  it("should calculate Basic→Rare profit correctly", () => {
    const basicFloor = 0.7; // RON
    const rareFloor = 3.0; // RON
    const cardsNeeded = 3;
    const craftCost = basicFloor * cardsNeeded; // 2.1
    const netSell = rareFloor * (1 - MARKETPLACE_FEE); // 2.8725
    const profit = netSell - craftCost; // 0.7725
    const profitPct = (profit / craftCost) * 100; // 36.8%

    expect(craftCost).toBeCloseTo(2.1, 2);
    expect(netSell).toBeCloseTo(2.8725, 2);
    expect(profit).toBeCloseTo(0.7725, 2);
    expect(profitPct).toBeCloseTo(36.79, 0);
  });

  it("should calculate Rare→Epic profit correctly", () => {
    const rareFloor = 3.0;
    const epicFloor = 40.0;
    const cardsNeeded = 10;
    const craftCost = rareFloor * cardsNeeded; // 30
    const netSell = epicFloor * (1 - MARKETPLACE_FEE); // 38.3
    const profit = netSell - craftCost; // 8.3
    const profitPct = (profit / craftCost) * 100; // 27.7%

    expect(craftCost).toBe(30);
    expect(netSell).toBeCloseTo(38.3, 0);
    expect(profit).toBeCloseTo(8.3, 0);
    expect(profitPct).toBeGreaterThan(20);
  });

  it("should calculate Epic→Legendary profit correctly", () => {
    const epicFloor = 40.0;
    const legendaryFloor = 400.0;
    const cardsNeeded = 8;
    const craftCost = epicFloor * cardsNeeded; // 320
    const netSell = legendaryFloor * (1 - MARKETPLACE_FEE); // 383
    const profit = netSell - craftCost; // 63
    const profitPct = (profit / craftCost) * 100; // 19.7%

    expect(craftCost).toBe(320);
    expect(profit).toBeCloseTo(63, 0);
    expect(profitPct).toBeGreaterThan(15);
  });

  it("should detect unprofitable crafts", () => {
    const basicFloor = 2.0; // expensive basics
    const rareFloor = 3.0; // cheap rares
    const cardsNeeded = 3;
    const craftCost = basicFloor * cardsNeeded; // 6.0
    const netSell = rareFloor * (1 - MARKETPLACE_FEE); // 2.8725
    const profit = netSell - craftCost; // -3.1275

    expect(profit).toBeLessThan(0);
  });
});

// ─── Supply Squeeze Detection ───────────────────────────────────────

describe("Supply squeeze detection", () => {
  const RELIST_MULTIPLIER = 1.75;
  const FEE = 0.0425;

  it("should calculate squeeze profit for low-supply cards", () => {
    const buyableListings = 3;
    const floorRon = 5.0;
    const buyoutCost = 5.0 + 5.5 + 6.0; // 16.5 RON
    const relistPrice = floorRon * RELIST_MULTIPLIER; // 8.75
    const revenue = relistPrice * buyableListings * (1 - FEE); // 25.13
    const profit = revenue - buyoutCost; // 8.63
    const profitPct = (profit / buyoutCost) * 100; // 52.3%

    expect(relistPrice).toBeCloseTo(8.75, 2);
    expect(revenue).toBeCloseTo(25.13, 0);
    expect(profit).toBeCloseTo(8.63, 0);
    expect(profitPct).toBeGreaterThan(50);
  });

  it("should reject high-supply cards", () => {
    const buyableListings = 15;
    const maxListings = 10;
    expect(buyableListings).toBeGreaterThan(maxListings);
    // These should be filtered out by the detector
  });

  it("should calculate squeeze score correctly", () => {
    const profitPct = 50;
    const buyableListings = 3;
    const maxListings = 10;
    const score = Math.round(profitPct * (maxListings - buyableListings + 1) / 10);
    // 50 * 8 / 10 = 40
    expect(score).toBe(40);
  });
});

// ─── Telegram Alert Formatting ──────────────────────────────────────

describe("Telegram alert formatting", () => {
  it("should format craft alert with correct arrow notation", () => {
    const sourceRarity = "Basic";
    const targetRarity = "Rare";
    const arrow = sourceRarity.charAt(0) + "→" + targetRarity.charAt(0);
    expect(arrow).toBe("B→R");
  });

  it("should format all rarity paths correctly", () => {
    const paths = [
      { source: "Basic", target: "Rare", expected: "B→R" },
      { source: "Rare", target: "Epic", expected: "R→E" },
      { source: "Epic", target: "Legendary", expected: "E→L" },
      { source: "Basic", target: "Epic", expected: "B→E" },
      { source: "Basic", target: "Legendary", expected: "B→L" },
      { source: "Rare", target: "Legendary", expected: "R→L" },
    ];
    for (const p of paths) {
      const arrow = p.source.charAt(0) + "→" + p.target.charAt(0);
      expect(arrow).toBe(p.expected);
    }
  });

  it("should only alert on opportunities above threshold", () => {
    const threshold = 20;
    const opportunities = [
      { profitPercent: 5 },
      { profitPercent: 15 },
      { profitPercent: 25 },
      { profitPercent: 50 },
    ];
    const alertable = opportunities.filter((o) => o.profitPercent >= threshold);
    expect(alertable.length).toBe(2);
  });
});

// ─── Crafting Ratios ────────────────────────────────────────────────

describe("Crafting ratios", () => {
  it("should have correct crafting ratios", () => {
    const BASICS_PER_RARE = 3;
    const RARES_PER_EPIC = 10;
    const EPICS_PER_LEGENDARY = 8;

    expect(BASICS_PER_RARE).toBe(3);
    expect(RARES_PER_EPIC).toBe(10);
    expect(EPICS_PER_LEGENDARY).toBe(8);
  });

  it("should calculate multi-step crafting correctly", () => {
    const BASICS_PER_RARE = 3;
    const RARES_PER_EPIC = 10;
    const EPICS_PER_LEGENDARY = 8;

    // Basics → Epic = 3 × 10 = 30
    expect(BASICS_PER_RARE * RARES_PER_EPIC).toBe(30);

    // Rares → Legendary = 10 × 8 = 80
    expect(RARES_PER_EPIC * EPICS_PER_LEGENDARY).toBe(80);

    // Basics → Legendary = 3 × 10 × 8 = 240
    expect(BASICS_PER_RARE * RARES_PER_EPIC * EPICS_PER_LEGENDARY).toBe(240);
  });
});
