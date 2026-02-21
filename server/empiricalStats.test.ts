/**
 * Tests for empirical stats blending logic
 */
import { describe, it, expect } from "vitest";
import { blendStats, type EmpiricalChampionStats } from "./empiricalStats";

const modelStats = {
  avgKills: 2.0,
  avgBalls: 1.0,
  avgWartDistance: 50,
  winRate: 0.3,
};

function makeEmpirical(overrides: Partial<EmpiricalChampionStats> = {}): EmpiricalChampionStats {
  return {
    championTokenId: "123",
    name: "TestChamp",
    appearances: 10,
    avgScore: 600,
    medianScore: 580,
    avgScorePerMatch: 120,
    winningAppearances: 6,
    empiricalWinRate: 0.6,
    bestScore: 800,
    worstScore: 400,
    schemeSynergy: {},
    contestTypePerformance: {},
    confidence: 0.5,
    ...overrides,
  };
}

describe("blendStats", () => {
  it("returns model-only stats when no empirical data exists", () => {
    const result = blendStats(modelStats, undefined, "Epic");
    expect(result.avgKills).toBe(2.0);
    expect(result.avgBalls).toBe(1.0);
    expect(result.avgWartDistance).toBe(50);
    expect(result.winRate).toBe(0.3);
    expect(result.dataSource).toBe("model");
    expect(result.empiricalWeight).toBe(0);
    expect(result.empiricalAppearances).toBe(0);
  });

  it("returns model-only stats when empirical has zero appearances", () => {
    const result = blendStats(modelStats, makeEmpirical({ appearances: 0 }), "Epic");
    expect(result.dataSource).toBe("model");
    expect(result.empiricalWeight).toBe(0);
  });

  it("blends empirical data with model stats when empirical data exists", () => {
    const result = blendStats(modelStats, makeEmpirical({ confidence: 0.5 }), "Epic");

    expect(result.dataSource).toBe("blended");
    expect(result.empiricalWeight).toBe(0.5);
    expect(result.empiricalAppearances).toBe(10);

    // Blended winRate should be between model (0.3) and empirical (0.6)
    expect(result.winRate).toBeGreaterThan(0.3);
    expect(result.winRate).toBeLessThan(0.6);
  });

  it("gives higher empirical weight with higher confidence", () => {
    const resultLow = blendStats(modelStats, makeEmpirical({ confidence: 0.2 }), "Epic");
    const resultHigh = blendStats(modelStats, makeEmpirical({ confidence: 0.6 }), "Epic");

    expect(resultHigh.empiricalWeight).toBeGreaterThan(resultLow.empiricalWeight);
  });

  it("labels dataSource as 'empirical' when confidence >= 0.7", () => {
    const result = blendStats(modelStats, makeEmpirical({ confidence: 0.7 }), "Epic");
    expect(result.dataSource).toBe("empirical");
    expect(result.empiricalWeight).toBe(0.7);
  });

  it("labels dataSource as 'blended' when confidence between 0 and 0.7", () => {
    const result = blendStats(modelStats, makeEmpirical({ confidence: 0.4 }), "Epic");
    expect(result.dataSource).toBe("blended");
  });

  it("applies rarity multiplier correctly when reverse-engineering empirical scores", () => {
    // Same empirical data but different rarities should produce different blended stats
    // because the empirical base score is divided by the rarity multiplier
    const resultBasic = blendStats(modelStats, makeEmpirical({ confidence: 0.5, avgScore: 600 }), "Basic");
    const resultLegendary = blendStats(modelStats, makeEmpirical({ confidence: 0.5, avgScore: 600 }), "Legendary");

    // With the same raw score, a Legendary card's base score (600/1.75) is lower than Basic's (600/1.0)
    // so the scale factor is smaller for Legendary, meaning less of a boost
    // This means blended kills for Legendary should be different from Basic
    expect(resultBasic.avgKills).not.toBe(resultLegendary.avgKills);
  });

  it("preserves model stats structure in the output", () => {
    const result = blendStats(modelStats, makeEmpirical({ confidence: 0.3 }), "Rare");
    expect(typeof result.avgKills).toBe("number");
    expect(typeof result.avgBalls).toBe("number");
    expect(typeof result.avgWartDistance).toBe("number");
    expect(typeof result.winRate).toBe("number");
    expect(typeof result.empiricalWeight).toBe("number");
    expect(typeof result.modelWeight).toBe("number");
    expect(typeof result.dataSource).toBe("string");
    expect(typeof result.empiricalAppearances).toBe("number");
    expect(typeof result.empiricalAvgScore).toBe("number");
  });
});
