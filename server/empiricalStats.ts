/**
 * Empirical Stats Service — Aggregates actual champion performance from
 * AI-identified winning lineups in completed contests.
 *
 * This provides real-world data to blend with the class-based performance model,
 * improving optimizer accuracy over time as more contest results are identified.
 *
 * Data flow:
 * 1. Completed contests → leaderboard entries → AI identification → identifiedChampions JSON
 * 2. This service aggregates: avg score per champion, appearance frequency, win rate,
 *    scheme synergy, and contest-type performance
 * 3. The optimizer blends empirical stats with the class-based model using a confidence weight
 */

import { eq, and, sql, isNotNull, lte } from "drizzle-orm";
import { getDb } from "./db";
import { leaderboardEntries, contests } from "../drizzle/schema";

// ─── Types ─────────────────────────────────────────────────────────

export interface EmpiricalChampionStats {
  championTokenId: string;
  name: string;
  // Aggregated from actual contest results
  avgScore: number;          // Average score across all appearances
  avgScorePerMatch: number;  // Average score normalized by matches played
  appearances: number;       // How many times this champion appeared in identified lineups
  winningAppearances: number; // Times in a lineup that placed in top 50%
  empiricalWinRate: number;  // winningAppearances / appearances
  // Score distribution
  bestScore: number;
  worstScore: number;
  medianScore: number;
  // Scheme synergy (which schemes this champion performs best with)
  schemeSynergy: Record<string, {
    avgScore: number;
    appearances: number;
  }>;
  // Contest type performance
  contestTypePerformance: Record<string, {
    avgScore: number;
    appearances: number;
  }>;
  // Confidence level (0-1, based on sample size)
  confidence: number;
}

export interface EmpiricalStatsResult {
  champions: Map<string, EmpiricalChampionStats>;
  totalEntriesAnalyzed: number;
  totalContestsAnalyzed: number;
  lastUpdated: Date;
}

// ─── Raw Entry Type ────────────────────────────────────────────────

interface IdentifiedChampion {
  name: string;
  championTokenId: string;
  rarity: string;
  confidence?: number;
}

interface RawEntry {
  score: number;
  rank: number;
  matchesCompleted: number | null;
  totalMatches: number | null;
  identifiedChampions: IdentifiedChampion[];
  identifiedScheme: string | null;
  aiConfidence: string | null;
  contestId: number;
  contestName: string;
  contestFormat: string;
  rarityRestriction: string | null;
  maxEntries: number | null;
  totalEntries: number;
}

// ─── Confidence Calculation ────────────────────────────────────────

/**
 * Calculate confidence level based on sample size.
 * Uses a logarithmic curve: 5 appearances = ~0.5, 20+ = ~0.85, 50+ = ~0.95
 */
function calculateConfidence(appearances: number): number {
  if (appearances === 0) return 0;
  if (appearances === 1) return 0.15;
  if (appearances === 2) return 0.25;
  // Logarithmic growth: approaches 1.0 asymptotically
  const confidence = Math.min(0.98, 0.15 + 0.83 * (1 - 1 / Math.log2(appearances + 1)));
  return Math.round(confidence * 100) / 100;
}

// ─── Main Aggregation ──────────────────────────────────────────────

/**
 * Aggregate empirical champion stats from all AI-identified leaderboard entries.
 * Only includes entries with aiConfidence >= minConfidence.
 */
export async function aggregateEmpiricalStats(
  minConfidence: number = 0.7
): Promise<EmpiricalStatsResult> {
  const db = await getDb();
  if (!db) {
    return {
      champions: new Map(),
      totalEntriesAnalyzed: 0,
      totalContestsAnalyzed: 0,
      lastUpdated: new Date(),
    };
  }

  // Join leaderboard entries with contests to get contest metadata
  const rows = await db
    .select({
      score: leaderboardEntries.score,
      rank: leaderboardEntries.rank,
      matchesCompleted: leaderboardEntries.matchesCompleted,
      totalMatches: leaderboardEntries.totalMatches,
      identifiedChampions: leaderboardEntries.identifiedChampions,
      identifiedScheme: leaderboardEntries.identifiedScheme,
      aiConfidence: leaderboardEntries.aiConfidence,
      contestId: leaderboardEntries.contestId,
      contestName: contests.name,
      contestFormat: contests.format,
      rarityRestriction: contests.rarityRestriction,
      maxEntries: contests.maxEntries,
      totalEntries: contests.entries,
    })
    .from(leaderboardEntries)
    .innerJoin(contests, eq(leaderboardEntries.contestId, contests.id))
    .where(
      and(
        isNotNull(leaderboardEntries.identifiedChampions),
        sql`CAST(${leaderboardEntries.aiConfidence} AS DECIMAL(5,2)) >= ${minConfidence}`
      )
    );

  if (rows.length === 0) {
    return {
      champions: new Map(),
      totalEntriesAnalyzed: 0,
      totalContestsAnalyzed: 0,
      lastUpdated: new Date(),
    };
  }

  // Track per-champion data
  const championData = new Map<string, {
    name: string;
    scores: number[];
    scoresPerMatch: number[];
    winCount: number;
    schemeSynergy: Map<string, { scores: number[]; count: number }>;
    contestTypePerf: Map<string, { scores: number[]; count: number }>;
  }>();

  const contestIds = new Set<number>();

  for (const row of rows) {
    const champions = row.identifiedChampions as IdentifiedChampion[] | null;
    if (!champions || !Array.isArray(champions)) continue;

    const totalEntries = row.totalEntries ?? row.maxEntries ?? 50;
    const isWinning = row.rank <= Math.ceil(totalEntries * 0.5); // Top 50% = "winning"
    const matchesPlayed = row.matchesCompleted ?? row.totalMatches ?? 1;
    const scorePerMatch = matchesPlayed > 0 ? row.score / matchesPlayed : row.score;
    const scheme = row.identifiedScheme ?? "unknown";
    const contestType = row.rarityRestriction ?? "OPEN";

    contestIds.add(row.contestId);

    // Attribute score equally to each champion in the lineup (4 champions share the score)
    // We use the full entry score for each champion since we can't break it down per-champion
    const perChampionScore = row.score / Math.max(champions.length, 1);
    const perChampionScorePerMatch = scorePerMatch / Math.max(champions.length, 1);

    for (const champ of champions) {
      if (!champ.championTokenId) continue;

      let data = championData.get(champ.championTokenId);
      if (!data) {
        data = {
          name: champ.name,
          scores: [],
          scoresPerMatch: [],
          winCount: 0,
          schemeSynergy: new Map(),
          contestTypePerf: new Map(),
        };
        championData.set(champ.championTokenId, data);
      }

      data.scores.push(perChampionScore);
      data.scoresPerMatch.push(perChampionScorePerMatch);
      if (isWinning) data.winCount++;

      // Scheme synergy
      let schemeData = data.schemeSynergy.get(scheme);
      if (!schemeData) {
        schemeData = { scores: [], count: 0 };
        data.schemeSynergy.set(scheme, schemeData);
      }
      schemeData.scores.push(perChampionScore);
      schemeData.count++;

      // Contest type performance
      let typeData = data.contestTypePerf.get(contestType);
      if (!typeData) {
        typeData = { scores: [], count: 0 };
        data.contestTypePerf.set(contestType, typeData);
      }
      typeData.scores.push(perChampionScore);
      typeData.count++;
    }
  }

  // Build final stats
  const champions = new Map<string, EmpiricalChampionStats>();

  for (const [tokenId, data] of Array.from(championData.entries())) {
    const sortedScores = [...data.scores].sort((a: number, b: number) => a - b);
    const median = sortedScores.length % 2 === 0
      ? (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2
      : sortedScores[Math.floor(sortedScores.length / 2)];

    const avgScore = data.scores.reduce((a: number, b: number) => a + b, 0) / data.scores.length;
    const avgScorePerMatch = data.scoresPerMatch.reduce((a: number, b: number) => a + b, 0) / data.scoresPerMatch.length;

    const schemeSynergy: Record<string, { avgScore: number; appearances: number }> = {};
    for (const [scheme, sData] of Array.from(data.schemeSynergy.entries())) {
      schemeSynergy[scheme] = {
        avgScore: Math.round(sData.scores.reduce((a: number, b: number) => a + b, 0) / sData.scores.length),
        appearances: sData.count,
      };
    }

    const contestTypePerformance: Record<string, { avgScore: number; appearances: number }> = {};
    for (const [type, tData] of Array.from(data.contestTypePerf.entries())) {
      contestTypePerformance[type] = {
        avgScore: Math.round(tData.scores.reduce((a: number, b: number) => a + b, 0) / tData.scores.length),
        appearances: tData.count,
      };
    }

    champions.set(tokenId, {
      championTokenId: tokenId,
      name: data.name,
      avgScore: Math.round(avgScore),
      avgScorePerMatch: Math.round(avgScorePerMatch),
      appearances: data.scores.length,
      winningAppearances: data.winCount,
      empiricalWinRate: Math.round((data.winCount / data.scores.length) * 100) / 100,
      bestScore: Math.round(sortedScores[sortedScores.length - 1]),
      worstScore: Math.round(sortedScores[0]),
      medianScore: Math.round(median),
      schemeSynergy,
      contestTypePerformance,
      confidence: calculateConfidence(data.scores.length),
    });
  }

  return {
    champions,
    totalEntriesAnalyzed: rows.length,
    totalContestsAnalyzed: contestIds.size,
    lastUpdated: new Date(),
  };
}

// ─── Blended Stats ─────────────────────────────────────────────────

export interface BlendedChampionStats {
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  winRate: number;
  // Blending metadata
  empiricalWeight: number;   // 0-1, how much empirical data influenced the result
  modelWeight: number;       // 0-1, how much the class-based model influenced
  dataSource: "model" | "empirical" | "blended";
  empiricalAppearances: number;
  empiricalAvgScore: number;
}

/**
 * Blend empirical stats with class-based model stats.
 * 
 * The blend uses empirical confidence as the weight:
 * - 0 appearances: 100% model
 * - 5 appearances: ~50% empirical, ~50% model
 * - 20+ appearances: ~85% empirical, ~15% model
 * - 50+ appearances: ~95% empirical, ~5% model
 * 
 * For empirical data, we reverse-engineer kills/balls/wart/winRate from the
 * observed average score using the V4 scoring formula proportions.
 */
export function blendStats(
  modelStats: { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number },
  empirical: EmpiricalChampionStats | undefined,
  rarity: string
): BlendedChampionStats {
  if (!empirical || empirical.appearances === 0) {
    return {
      ...modelStats,
      empiricalWeight: 0,
      modelWeight: 1,
      dataSource: "model",
      empiricalAppearances: 0,
      empiricalAvgScore: 0,
    };
  }

  const confidence = empirical.confidence;

  // Reverse-engineer per-stat estimates from empirical avg score
  // Official Season 1 formula: score = kills*80 + balls*50 + wart*0.5625 + winRate*300 (per champion, before rarity)
  // We know the per-champion score and can estimate stat proportions
  const rarityMultiplier: Record<string, number> = {
    Basic: 1.0, Common: 1.0, Rare: 1.25, Epic: 1.5, Legendary: 1.75,
  };
  const rm = rarityMultiplier[rarity] ?? 1.0;

  // Model's predicted per-champion score (without rarity)
  const modelBaseScore = modelStats.avgKills * 80 + modelStats.avgBalls * 50 +
    modelStats.avgWartDistance * 0.5625 + modelStats.winRate * 300;

  // Empirical per-champion score (remove rarity multiplier to get base)
  const empiricalBaseScore = empirical.avgScore / rm;

  // Scale factor: how much better/worse the champion actually performs vs model prediction
  const scaleFactor = modelBaseScore > 0 ? empiricalBaseScore / modelBaseScore : 1;

  // Apply scale factor to model stats to get empirical estimates
  const empiricalKills = modelStats.avgKills * scaleFactor;
  const empiricalBalls = modelStats.avgBalls * scaleFactor;
  const empiricalWart = modelStats.avgWartDistance * scaleFactor;
  const empiricalWinRate = Math.min(1, empirical.empiricalWinRate); // Use actual win rate

  // Blend: weighted average based on confidence
  const blendedKills = modelStats.avgKills * (1 - confidence) + empiricalKills * confidence;
  const blendedBalls = modelStats.avgBalls * (1 - confidence) + empiricalBalls * confidence;
  const blendedWart = modelStats.avgWartDistance * (1 - confidence) + empiricalWart * confidence;
  const blendedWinRate = modelStats.winRate * (1 - confidence) + empiricalWinRate * confidence;

  return {
    avgKills: Math.round(blendedKills * 100) / 100,
    avgBalls: Math.round(blendedBalls * 100) / 100,
    avgWartDistance: Math.round(blendedWart * 100) / 100,
    winRate: Math.round(blendedWinRate * 1000) / 1000,
    empiricalWeight: confidence,
    modelWeight: Math.round((1 - confidence) * 100) / 100,
    dataSource: confidence >= 0.7 ? "empirical" : confidence > 0 ? "blended" : "model",
    empiricalAppearances: empirical.appearances,
    empiricalAvgScore: empirical.avgScore,
  };
}

// ─── Summary Stats ─────────────────────────────────────────────────

/**
 * Get a summary of the empirical data available for the optimizer.
 */
export async function getEmpiricalSummary(): Promise<{
  totalIdentifiedEntries: number;
  uniqueChampions: number;
  avgConfidence: number;
  topChampions: Array<{ name: string; championTokenId: string; avgScore: number; appearances: number; winRate: number }>;
}> {
  const result = await aggregateEmpiricalStats(0.7);

  const topChampions = Array.from(result.champions.values())
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10)
    .map((c) => ({
      name: c.name,
      championTokenId: c.championTokenId,
      avgScore: c.avgScore,
      appearances: c.appearances,
      winRate: c.empiricalWinRate,
    }));

  const avgConfidence = result.champions.size > 0
    ? Array.from(result.champions.values()).reduce((sum, c) => sum + c.confidence, 0) / result.champions.size
    : 0;

  return {
    totalIdentifiedEntries: result.totalEntriesAnalyzed,
    uniqueChampions: result.champions.size,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    topChampions,
  };
}

// ─── Scheme Performance Rankings ──────────────────────────────────

export interface SchemePerformanceData {
  schemeName: string;
  appearances: number;
  avgScore: number;
  medianScore: number;
  avgRank: number;
  winRate: number;       // % of entries using this scheme that placed in top 50%
  bestScore: number;
  worstScore: number;
  confidence: number;    // Based on sample size
}

/**
 * Aggregate scheme performance from AI-identified winning lineups.
 * Returns performance data for each scheme card, ranked by effectiveness.
 */
export async function aggregateSchemePerformance(
  minConfidence: number = 0.5
): Promise<{
  schemes: SchemePerformanceData[];
  totalEntriesAnalyzed: number;
}> {
  const db = await getDb();
  if (!db) {
    return { schemes: [], totalEntriesAnalyzed: 0 };
  }

  const rows = await db
    .select({
      score: leaderboardEntries.score,
      rank: leaderboardEntries.rank,
      identifiedScheme: leaderboardEntries.identifiedScheme,
      aiConfidence: leaderboardEntries.aiConfidence,
      contestId: leaderboardEntries.contestId,
      maxEntries: contests.maxEntries,
      totalEntries: contests.entries,
    })
    .from(leaderboardEntries)
    .innerJoin(contests, eq(leaderboardEntries.contestId, contests.id))
    .where(
      and(
        isNotNull(leaderboardEntries.identifiedScheme),
        sql`CAST(${leaderboardEntries.aiConfidence} AS DECIMAL(5,2)) >= ${minConfidence}`
      )
    );

  if (rows.length === 0) {
    return { schemes: [], totalEntriesAnalyzed: 0 };
  }

  // Group by scheme
  const schemeData = new Map<string, {
    scores: number[];
    ranks: number[];
    winCount: number;
    totalInContest: number[];
  }>();

  for (const row of rows) {
    const scheme = row.identifiedScheme;
    if (!scheme) continue;

    let data = schemeData.get(scheme);
    if (!data) {
      data = { scores: [], ranks: [], winCount: 0, totalInContest: [] };
      schemeData.set(scheme, data);
    }

    const totalEntries = row.totalEntries ?? row.maxEntries ?? 50;
    const isWinning = row.rank <= Math.ceil(totalEntries * 0.5);

    data.scores.push(row.score);
    data.ranks.push(row.rank);
    data.totalInContest.push(totalEntries);
    if (isWinning) data.winCount++;
  }

  // Build performance data
  const schemes: SchemePerformanceData[] = [];

  for (const [schemeName, data] of Array.from(schemeData.entries())) {
    const sortedScores = [...data.scores].sort((a: number, b: number) => a - b);
    const median = sortedScores.length % 2 === 0
      ? (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2
      : sortedScores[Math.floor(sortedScores.length / 2)];

    const avgScore = data.scores.reduce((a: number, b: number) => a + b, 0) / data.scores.length;
    const avgRank = data.ranks.reduce((a: number, b: number) => a + b, 0) / data.ranks.length;

    schemes.push({
      schemeName,
      appearances: data.scores.length,
      avgScore: Math.round(avgScore),
      medianScore: Math.round(median),
      avgRank: Math.round(avgRank * 10) / 10,
      winRate: Math.round((data.winCount / data.scores.length) * 100) / 100,
      bestScore: Math.round(sortedScores[sortedScores.length - 1]),
      worstScore: Math.round(sortedScores[0]),
      confidence: calculateConfidence(data.scores.length),
    });
  }

  // Sort by avgScore descending
  schemes.sort((a, b) => b.avgScore - a.avgScore);

  return {
    schemes,
    totalEntriesAnalyzed: rows.length,
  };
}
