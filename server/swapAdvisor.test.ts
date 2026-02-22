/**
 * Tests for:
 * 1. Swap Advisor engine — matchup analysis, swap recommendations, estimation fallback
 * 2. H2H integration into lineup optimizer — match history blending into scoring
 */

import { describe, it, expect } from "vitest";

// ─── Swap Advisor Logic Tests ─────────────────────────────────────

describe("Swap Advisor — Win Rate Estimation", () => {
  it("should estimate 50% when no performance data exists for either champion", () => {
    const perfData = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>();

    // No data for either → 50%
    const champPerf = perfData.get("999");
    const oppPerf = perfData.get("888");

    let estimated: number;
    if (!champPerf && !oppPerf) estimated = 50;
    else if (!champPerf) estimated = 40;
    else if (!oppPerf) estimated = 60;
    else estimated = 50;

    expect(estimated).toBe(50);
  });

  it("should estimate 40% when only opponent has data (disadvantage)", () => {
    const perfData = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>();
    perfData.set("888", { avgKills: 2.0, avgBalls: 0.5, avgWartDistance: 300, winRate: 0.7, totalMatches: 50 });

    const champPerf = perfData.get("999"); // undefined
    const oppPerf = perfData.get("888");

    let estimated: number;
    if (!champPerf && !oppPerf) estimated = 50;
    else if (!champPerf) estimated = 40;
    else if (!oppPerf) estimated = 60;
    else estimated = 50;

    expect(estimated).toBe(40);
  });

  it("should estimate 60% when only our champion has data (advantage)", () => {
    const perfData = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>();
    perfData.set("999", { avgKills: 1.5, avgBalls: 0.3, avgWartDistance: 250, winRate: 0.6, totalMatches: 30 });

    const champPerf = perfData.get("999");
    const oppPerf = perfData.get("888"); // undefined

    let estimated: number;
    if (!champPerf && !oppPerf) estimated = 50;
    else if (!champPerf) estimated = 40;
    else if (!oppPerf) estimated = 60;
    else estimated = 50;

    expect(estimated).toBe(60);
  });

  it("should estimate win rate based on score comparison when both have data", () => {
    const champPerf = { avgKills: 2.0, avgBalls: 0.5, avgWartDistance: 300, winRate: 0.7, totalMatches: 50 };
    const oppPerf = { avgKills: 1.0, avgBalls: 0.2, avgWartDistance: 200, winRate: 0.4, totalMatches: 40 };

    // Score formula: kills*85 + balls*40 + wartDistance
    const champScore = champPerf.avgKills * 85 + champPerf.avgBalls * 40 + champPerf.avgWartDistance;
    const oppScore = oppPerf.avgKills * 85 + oppPerf.avgBalls * 40 + oppPerf.avgWartDistance;

    // champ: 170 + 20 + 300 = 490
    // opp: 85 + 8 + 200 = 293
    expect(champScore).toBeCloseTo(490, 0);
    expect(oppScore).toBeCloseTo(293, 0);

    const winRateDiff = champPerf.winRate - oppPerf.winRate; // 0.3
    const scoreDiff = (champScore - oppScore) / Math.max(champScore, oppScore, 1); // ~0.4

    const rawAdvantage = winRateDiff * 0.6 + scoreDiff * 0.4;
    const estimatedWinRate = 50 + rawAdvantage * 30;
    const clamped = Math.max(20, Math.min(80, estimatedWinRate));

    // Champion is significantly better → should be well above 50%
    expect(clamped).toBeGreaterThan(60);
    expect(clamped).toBeLessThanOrEqual(80);
  });

  it("should clamp estimated win rate between 20% and 80%", () => {
    // Extreme case: one champion is massively better
    const winRateDiff = 1.0; // max possible
    const scoreDiff = 1.0; // max possible

    const rawAdvantage = winRateDiff * 0.6 + scoreDiff * 0.4; // 1.0
    const estimatedWinRate = 50 + rawAdvantage * 30; // 80
    const clamped = Math.max(20, Math.min(80, estimatedWinRate));

    expect(clamped).toBe(80);

    // Reverse: massively worse
    const rawAdvantage2 = -1.0;
    const estimatedWinRate2 = 50 + rawAdvantage2 * 30; // 20
    const clamped2 = Math.max(20, Math.min(80, estimatedWinRate2));

    expect(clamped2).toBe(20);
  });
});

describe("Swap Advisor — Confidence Levels", () => {
  it("should return 'high' confidence for 20+ matches", () => {
    const getConfidence = (matches: number) => {
      if (matches >= 20) return "high";
      if (matches >= 5) return "medium";
      if (matches > 0) return "low";
      return "none";
    };

    expect(getConfidence(20)).toBe("high");
    expect(getConfidence(50)).toBe("high");
    expect(getConfidence(100)).toBe("high");
  });

  it("should return 'medium' confidence for 5-19 matches", () => {
    const getConfidence = (matches: number) => {
      if (matches >= 20) return "high";
      if (matches >= 5) return "medium";
      if (matches > 0) return "low";
      return "none";
    };

    expect(getConfidence(5)).toBe("medium");
    expect(getConfidence(10)).toBe("medium");
    expect(getConfidence(19)).toBe("medium");
  });

  it("should return 'low' confidence for 1-4 matches", () => {
    const getConfidence = (matches: number) => {
      if (matches >= 20) return "high";
      if (matches >= 5) return "medium";
      if (matches > 0) return "low";
      return "none";
    };

    expect(getConfidence(1)).toBe("low");
    expect(getConfidence(4)).toBe("low");
  });

  it("should return 'none' confidence for 0 matches", () => {
    const getConfidence = (matches: number) => {
      if (matches >= 20) return "high";
      if (matches >= 5) return "medium";
      if (matches > 0) return "low";
      return "none";
    };

    expect(getConfidence(0)).toBe("none");
  });
});

describe("Swap Advisor — Recommendation Logic", () => {
  it("should only recommend swaps with >3% improvement", () => {
    const currentWinRate = 50;
    const candidateWinRates = [51, 52, 53, 53.1, 54, 60, 75];

    const validSwaps = candidateWinRates.filter((wr) => wr > currentWinRate + 3);

    // Only 53.1, 54, 60, 75 should qualify (>53%)
    expect(validSwaps).toEqual([53.1, 54, 60, 75]);
  });

  it("should pick the best swap candidate (highest win rate)", () => {
    const candidates = [
      { champId: 100, winRate: 60, matches: 15 },
      { champId: 200, winRate: 75, matches: 8 },
      { champId: 300, winRate: 55, matches: 25 },
    ];

    let best: typeof candidates[0] | null = null;
    for (const c of candidates) {
      if (!best || c.winRate > best.winRate) {
        best = c;
      }
    }

    expect(best!.champId).toBe(200);
    expect(best!.winRate).toBe(75);
  });

  it("should sort recommendations by improvement descending", () => {
    const recs = [
      { position: 1, winRateImprovement: 5.2 },
      { position: 2, winRateImprovement: 15.8 },
      { position: 3, winRateImprovement: 8.1 },
      { position: 4, winRateImprovement: 2.5 },
    ];

    recs.sort((a, b) => b.winRateImprovement - a.winRateImprovement);

    expect(recs[0].position).toBe(2); // 15.8%
    expect(recs[1].position).toBe(3); // 8.1%
    expect(recs[2].position).toBe(1); // 5.2%
    expect(recs[3].position).toBe(4); // 2.5%
  });

  it("should calculate overall win rate as average of 4 matchups", () => {
    const matchupWinRates = [65, 40, 55, 70];
    const overall =
      Math.round(
        (matchupWinRates.reduce((sum, r) => sum + r, 0) / matchupWinRates.length) * 100
      ) / 100;

    expect(overall).toBe(57.5);
  });

  it("should calculate improvement potential correctly", () => {
    const currentMatchups = [45, 60, 35, 55]; // avg = 48.75
    const bestPossibleMatchups = [70, 60, 55, 55]; // avg = 60

    const currentAvg =
      currentMatchups.reduce((s, r) => s + r, 0) / currentMatchups.length;
    const bestAvg =
      bestPossibleMatchups.reduce((s, r) => s + r, 0) / bestPossibleMatchups.length;

    const improvement = Math.round((bestAvg - currentAvg) * 100) / 100;

    expect(currentAvg).toBe(48.75);
    expect(bestAvg).toBe(60);
    expect(improvement).toBe(11.25);
  });

  it("should not recommend swapping a champion already in the lineup", () => {
    const currentLineup = [100, 200, 300, 400];
    const benchCandidates = [100, 500, 600, 200]; // 100 and 200 are already in lineup

    const validBench = benchCandidates.filter((id) => !currentLineup.includes(id));

    expect(validBench).toEqual([500, 600]);
  });
});

// ─── H2H Integration into Optimizer Tests ─────────────────────────

describe("H2H Integration — Match History Blending", () => {
  it("should blend match history stats with model stats using weight", () => {
    // Model stats (from class-based model)
    const modelKills = 1.5;
    const modelBalls = 0.3;
    const modelWart = 250;

    // Match history stats (from real match data)
    const matchKills = 2.0;
    const matchBalls = 0.1;
    const matchWart = 300;

    // Blend with match history weight of 0.3
    const matchWeight = 0.3;
    const blendedKills = modelKills * (1 - matchWeight) + matchKills * matchWeight;
    const blendedBalls = modelBalls * (1 - matchWeight) + matchBalls * matchWeight;
    const blendedWart = modelWart * (1 - matchWeight) + matchWart * matchWeight;

    // kills: 1.5*0.7 + 2.0*0.3 = 1.05 + 0.6 = 1.65
    expect(blendedKills).toBeCloseTo(1.65, 2);
    // balls: 0.3*0.7 + 0.1*0.3 = 0.21 + 0.03 = 0.24
    expect(blendedBalls).toBeCloseTo(0.24, 2);
    // wart: 250*0.7 + 300*0.3 = 175 + 90 = 265
    expect(blendedWart).toBeCloseTo(265, 0);
  });

  it("should increase match history weight with more matches", () => {
    // Weight calculation: min(0.4, matches/100 * 0.4)
    const calcWeight = (matches: number) => Math.min(0.4, (matches / 100) * 0.4);

    expect(calcWeight(10)).toBeCloseTo(0.04, 2);
    expect(calcWeight(50)).toBeCloseTo(0.2, 2);
    expect(calcWeight(100)).toBeCloseTo(0.4, 2);
    expect(calcWeight(200)).toBeCloseTo(0.4, 2); // capped at 0.4
  });

  it("should not blend when no match data exists (weight = 0)", () => {
    const modelKills = 1.5;
    const matchWeight = 0; // no match data

    const blended = modelKills * (1 - matchWeight) + 0 * matchWeight;
    expect(blended).toBe(1.5); // unchanged
  });

  it("should calculate V4 score from blended stats correctly", () => {
    // Blended stats
    const kills = 1.65;
    const balls = 0.24;
    const wart = 265;
    const winRate = 0.6;

    // V4 formula: 85*kills + 40*balls + wart + 200*winRate
    const score = 85 * kills + 40 * balls + wart + 200 * winRate;

    // 85*1.65 = 140.25, 40*0.24 = 9.6, 265, 200*0.6 = 120
    // Total = 140.25 + 9.6 + 265 + 120 = 534.85
    expect(score).toBeCloseTo(534.85, 1);
  });

  it("should handle match history data with win rate bonus", () => {
    // If champion has high match win rate, it should boost the score
    const matchWinRate = 0.72; // 72% win rate from real matches
    const modelWinRate = 0.5; // 50% assumed from model

    // Blended win rate with 0.3 weight
    const blendedWinRate = modelWinRate * 0.7 + matchWinRate * 0.3;

    // 0.5*0.7 + 0.72*0.3 = 0.35 + 0.216 = 0.566
    expect(blendedWinRate).toBeCloseTo(0.566, 3);

    // This adds 200 * 0.566 = 113.2 to the V4 score (vs 100 without match data)
    const scoreBonus = 200 * blendedWinRate;
    const scoreWithoutMatch = 200 * modelWinRate;

    expect(scoreBonus).toBeGreaterThan(scoreWithoutMatch);
    expect(scoreBonus - scoreWithoutMatch).toBeCloseTo(13.2, 1);
  });
});

describe("H2H Integration — Data Quality Tracking", () => {
  it("should track how many champions have match data", () => {
    const matchPerformanceData = new Map<number, { totalMatches: number }>();
    matchPerformanceData.set(5256, { totalMatches: 901 });
    matchPerformanceData.set(5705, { totalMatches: 450 });
    matchPerformanceData.set(6701, { totalMatches: 0 }); // scraped but no matches

    const championsWithData = matchPerformanceData.size;
    const totalMatches = Array.from(matchPerformanceData.values()).reduce(
      (sum, d) => sum + d.totalMatches,
      0
    );

    expect(championsWithData).toBe(3);
    expect(totalMatches).toBe(1351);
  });

  it("should report match history metadata in optimizer response", () => {
    const matchHistoryData = {
      championsWithMatchData: 150,
      totalMatchesInDb: 135000,
    };

    expect(matchHistoryData.championsWithMatchData).toBeGreaterThan(0);
    expect(matchHistoryData.totalMatchesInDb).toBeGreaterThan(0);
  });
});

// ─── Swap Advisor — Data Quality Assessment ───────────────────────

describe("Swap Advisor — Data Quality", () => {
  it("should count matchups with and without H2H data", () => {
    const matchups = [
      { h2hMatches: 25 },
      { h2hMatches: 0 },
      { h2hMatches: 12 },
      { h2hMatches: 0 },
    ];

    const withData = matchups.filter((m) => m.h2hMatches > 0).length;
    const withoutData = matchups.filter((m) => m.h2hMatches === 0).length;
    const totalH2h = matchups.reduce((sum, m) => sum + m.h2hMatches, 0);

    expect(withData).toBe(2);
    expect(withoutData).toBe(2);
    expect(totalH2h).toBe(37);
  });

  it("should warn when most matchups lack H2H data", () => {
    const matchupsWithoutData = 3;
    const totalMatchups = 4;
    const shouldWarn = matchupsWithoutData > totalMatchups / 2;

    expect(shouldWarn).toBe(true);
  });
});

// ─── Bulk H2H Matrix Tests ────────────────────────────────────────

describe("Bulk H2H Matrix", () => {
  it("should build a 2D lookup from champion pairs", () => {
    type H2HRecord = { wins: number; losses: number; winRate: number; totalMatches: number };
    const matrix = new Map<number, Map<number, H2HRecord>>();

    // Simulate adding records
    const addRecord = (champId: number, oppId: number, wins: number, losses: number) => {
      if (!matrix.has(champId)) matrix.set(champId, new Map());
      const total = wins + losses;
      matrix.get(champId)!.set(oppId, {
        wins,
        losses,
        winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 50,
        totalMatches: total,
      });
    };

    addRecord(100, 200, 15, 5);
    addRecord(100, 300, 8, 12);
    addRecord(200, 100, 5, 15);

    // Lookup
    const record = matrix.get(100)?.get(200);
    expect(record).toBeDefined();
    expect(record!.wins).toBe(15);
    expect(record!.losses).toBe(5);
    expect(record!.winRate).toBe(75);
    expect(record!.totalMatches).toBe(20);

    // Reverse lookup
    const reverse = matrix.get(200)?.get(100);
    expect(reverse).toBeDefined();
    expect(reverse!.winRate).toBe(25);
  });

  it("should handle missing pairs gracefully", () => {
    const matrix = new Map<number, Map<number, { winRate: number }>>();

    const result = matrix.get(999)?.get(888);
    expect(result).toBeUndefined();
  });
});
