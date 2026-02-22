/**
 * Opponent Crusher — Counter-lineup builder.
 *
 * Given an opponent's 4 champions, find the best 4 champions from the user's
 * owned cards that maximize total H2H win rate against those specific opponents.
 *
 * Algorithm:
 * 1. Fetch H2H win rates for all (owned champion × opponent champion) pairs
 * 2. For each candidate lineup of 4 owned champions, compute the total expected
 *    win rate summed across all 4 vs-opponent matchups
 * 3. Return the top 3 counter-lineups ranked by total expected win rate
 *
 * When H2H data is sparse, fall back to overall performance score as a proxy.
 */

import { getBulkHeadToHead, getBulkMatchPerformance } from "./matchupAnalytics";
import { getDb } from "./db";
import { userCards } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────

export interface CounterChampionSlot {
  championTokenId: number;
  championName: string;
  championClass: string;
  imageUrl?: string | null;
  /** Average win rate vs the full opponent lineup (across all 4 opponents) */
  avgWinRateVsOpponents: number;
  /** Win rate vs each specific opponent */
  vsOpponents: Array<{
    opponentTokenId: number;
    opponentName: string;
    winRate: number;
    totalMatches: number;
    confidence: "high" | "medium" | "low" | "none";
  }>;
}

export interface CounterLineup {
  rank: number;
  champions: CounterChampionSlot[];
  totalExpectedWinRate: number; // Sum of best matchup win rates (0–400 scale)
  avgWinRate: number; // totalExpectedWinRate / 4
  dataQuality: "high" | "medium" | "low";
}

export interface OpponentCrusherResult {
  opponentChampions: Array<{
    tokenId: number;
    name: string;
    championClass: string;
  }>;
  counterLineups: CounterLineup[];
  totalOwnedCandidates: number;
  dataQuality: {
    totalH2hPairs: number;
    pairsWithData: number;
    coveragePct: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function getConfidence(matches: number): "high" | "medium" | "low" | "none" {
  if (matches >= 20) return "high";
  if (matches >= 5) return "medium";
  if (matches >= 1) return "low";
  return "none";
}

/**
 * Estimate win rate from overall performance when no H2H data exists.
 * Uses the champion's avg score relative to a baseline of 400 pts.
 */
function estimateWinRate(
  champPerf: { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number; avgEstimatedScore?: number } | undefined
): number {
  if (!champPerf) return 50;
  // Use empirical win rate as the estimate
  return Math.round(champPerf.winRate * 100) / 100;
}

// ─── Main Engine ───────────────────────────────────────────────────

/**
 * Build counter-lineups from the user's owned champions against an opponent lineup.
 */
export async function buildCounterLineup(
  opponentChampionIds: number[],
  ownedChampionIds: number[],
  gameDataLookup: Map<number, { name: string; championClass: string; imageUrl?: string | null }>
): Promise<OpponentCrusherResult> {
  const opponentInfo = opponentChampionIds.map((id) => ({
    tokenId: id,
    name: gameDataLookup.get(id)?.name ?? `#${id}`,
    championClass: gameDataLookup.get(id)?.championClass ?? "Unknown",
  }));

  if (ownedChampionIds.length < 4) {
    return {
      opponentChampions: opponentInfo,
      counterLineups: [],
      totalOwnedCandidates: ownedChampionIds.length,
      dataQuality: { totalH2hPairs: 0, pairsWithData: 0, coveragePct: 0 },
    };
  }

  // Fetch H2H data for all owned vs all opponents
  const h2hMatrix = await getBulkHeadToHead(ownedChampionIds, opponentChampionIds);

  // Fetch overall performance for fallback estimates
  const perfMap = await getBulkMatchPerformance(ownedChampionIds);

  // Compute data quality
  const totalPairs = ownedChampionIds.length * opponentChampionIds.length;
  let pairsWithData = 0;
  for (const champId of ownedChampionIds) {
    for (const oppId of opponentChampionIds) {
      if ((h2hMatrix.get(champId)?.get(oppId)?.totalMatches ?? 0) > 0) {
        pairsWithData++;
      }
    }
  }

  // Score each owned champion against the full opponent lineup
  const scoredCandidates = ownedChampionIds.map((champId) => {
    const info = gameDataLookup.get(champId);
    const perf = perfMap.get(String(champId));
    const vsOpponents = opponentChampionIds.map((oppId) => {
      const h2h = h2hMatrix.get(champId)?.get(oppId);
      const winRate = h2h && h2h.totalMatches > 0
        ? h2h.winRate
        : estimateWinRate(perf);
      return {
        opponentTokenId: oppId,
        opponentName: gameDataLookup.get(oppId)?.name ?? `#${oppId}`,
        winRate,
        totalMatches: h2h?.totalMatches ?? 0,
        confidence: getConfidence(h2h?.totalMatches ?? 0),
      };
    });
    const avgWinRate = vsOpponents.length > 0
      ? vsOpponents.reduce((s, v) => s + v.winRate, 0) / vsOpponents.length
      : 50;
    return {
      championTokenId: champId,
      championName: info?.name ?? `#${champId}`,
      championClass: info?.championClass ?? "Unknown",
      imageUrl: info?.imageUrl ?? null,
      avgWinRateVsOpponents: Math.round(avgWinRate * 100) / 100,
      vsOpponents,
    } as CounterChampionSlot;
  });

  // Sort candidates by avg win rate descending
  scoredCandidates.sort((a, b) => b.avgWinRateVsOpponents - a.avgWinRateVsOpponents);

  // Build top counter lineups using a greedy approach:
  // - Lineup 1: top 4 by avg win rate (no duplicate champion names)
  // - Lineup 2: next best 4 (excluding lineup 1 picks)
  // - Lineup 3: next best 4 (excluding lineup 1+2 picks)
  const counterLineups: CounterLineup[] = [];
  const usedNames = new Set<string>();
  const usedIds = new Set<number>();

  for (let rank = 1; rank <= 3; rank++) {
    const lineupChamps: CounterChampionSlot[] = [];
    const lineupNames = new Set<string>();
    const lineupIds = new Set<number>();

    for (const candidate of scoredCandidates) {
      if (usedIds.has(candidate.championTokenId)) continue;
      const nameLower = candidate.championName.toLowerCase();
      if (usedNames.has(nameLower) || lineupNames.has(nameLower)) continue;
      lineupChamps.push(candidate);
      lineupNames.add(nameLower);
      lineupIds.add(candidate.championTokenId);
      if (lineupChamps.length === 4) break;
    }

    if (lineupChamps.length < 4) break; // Not enough unique champions

    // Mark used for next lineup
    lineupIds.forEach((id) => usedIds.add(id));
    lineupNames.forEach((name) => usedNames.add(name));

    const totalWinRate = lineupChamps.reduce((s, c) => s + c.avgWinRateVsOpponents, 0);
    const avgWinRate = Math.round((totalWinRate / 4) * 100) / 100;

    // Assess data quality for this lineup
    const h2hCoverage = lineupChamps.flatMap((c) => c.vsOpponents)
      .filter((v) => v.confidence !== "none").length;
    const totalSlots = lineupChamps.length * opponentChampionIds.length;
    const coveragePct = totalSlots > 0 ? h2hCoverage / totalSlots : 0;
    const quality: "high" | "medium" | "low" =
      coveragePct >= 0.7 ? "high" : coveragePct >= 0.3 ? "medium" : "low";

    counterLineups.push({
      rank,
      champions: lineupChamps,
      totalExpectedWinRate: Math.round(totalWinRate * 100) / 100,
      avgWinRate,
      dataQuality: quality,
    });
  }

  return {
    opponentChampions: opponentInfo,
    counterLineups,
    totalOwnedCandidates: ownedChampionIds.length,
    dataQuality: {
      totalH2hPairs: totalPairs,
      pairsWithData,
      coveragePct: totalPairs > 0 ? Math.round((pairsWithData / totalPairs) * 100) : 0,
    },
  };
}

/**
 * Get the user's owned champion token IDs from the database.
 */
export async function getOwnedChampionIds(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const cards = await db
    .select({ championTokenId: userCards.championTokenId })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardType, "MOKI")));
  return cards
    .map((c) => Number(c.championTokenId))
    .filter((id) => !isNaN(id) && id > 0);
}
