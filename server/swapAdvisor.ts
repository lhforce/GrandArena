/**
 * Swap Advisor — Post-entry lineup optimization engine.
 *
 * Grand Arena format: Each of your 4 MOKIs plays 5 individual 3v3 matches
 * against 5 different opponents = 20 total matches per round.
 *
 * Flow:
 * 1. User provides their 4 MOKIs and each MOKI's 5 opponents (4×5 = 20 matchups)
 * 2. Engine looks up H2H records for all 20 matchups
 * 3. Engine evaluates each MOKI slot's expected win rate across its 5 opponents
 * 4. Engine tries swapping bench champions into each slot and evaluates
 *    the aggregate win rate across all 5 opponents for that slot
 * 5. Recommends swaps that improve the overall expected outcome
 */

import { getBulkHeadToHead, getBulkMatchPerformance } from "./matchupAnalytics";
import { getDb } from "./db";
import { userCards } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────

/** A single matchup: one of your MOKIs vs one opponent */
export interface SingleMatchup {
  yourChampionTokenId: number;
  yourChampionName: string;
  yourChampionClass: string;
  opponentChampionTokenId: number;
  opponentChampionName: string;
  opponentChampionClass: string;
  h2hWinRate: number; // 0-100
  h2hMatches: number;
  h2hWins: number;
  h2hLosses: number;
  confidence: "high" | "medium" | "low" | "none";
}

/** One of your 4 MOKI slots with its 5 opponents */
export interface MokiSlot {
  slotIndex: number; // 0-3
  yourChampionTokenId: number;
  yourChampionName: string;
  yourChampionClass: string;
  opponents: SingleMatchup[];
  averageWinRate: number; // Average H2H win rate across all 5 opponents
  expectedWins: number; // Out of 5
}

export interface SwapRecommendation {
  slotIndex: number; // Which MOKI slot to swap (0-3)
  currentChampionTokenId: number;
  currentChampionName: string;
  currentAvgWinRate: number; // Current avg across 5 opponents
  currentExpectedWins: number;
  suggestedChampionTokenId: number;
  suggestedChampionName: string;
  suggestedChampionClass: string;
  suggestedAvgWinRate: number; // New avg across 5 opponents
  suggestedExpectedWins: number;
  winRateImprovement: number; // positive = better
  expectedWinsImprovement: number;
  opponentBreakdown: Array<{
    opponentName: string;
    opponentTokenId: number;
    currentWinRate: number;
    suggestedWinRate: number;
    improvement: number;
  }>;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface SwapAnalysisResult {
  slots: MokiSlot[];
  currentOverallWinRate: number; // Average across all 20 matchups
  currentExpectedTotalWins: number; // Out of 20
  recommendations: SwapRecommendation[];
  bestPossibleWinRate: number;
  bestPossibleExpectedWins: number;
  improvementPotential: number;
  dataQuality: {
    matchupsWithData: number;
    matchupsWithoutData: number;
    totalH2hMatchesUsed: number;
    totalMatchups: number;
  };
}

// ─── Input Types ──────────────────────────────────────────────────

export interface SlotInput {
  championTokenId: number;
  opponents: number[]; // Array of 5 opponent championTokenIds
}

// ─── Core Engine ───────────────────────────────────────────────────

/**
 * Analyze current matchups (4 MOKIs × 5 opponents each) and recommend swaps.
 *
 * @param slots - Array of 4 slot inputs, each with a champion and 5 opponents
 * @param benchChampionIds - Array of available bench champion IDs to swap in
 * @param gameData - Game data for champion name/class lookups
 */
export async function analyzeMatchupsAndRecommendSwaps(
  slots: SlotInput[],
  benchChampionIds: number[],
  gameData: Map<number, { name: string; championClass: string; championTokenId?: number }>
): Promise<SwapAnalysisResult> {
  // Collect all unique champion IDs
  const yourIds = slots.map((s) => s.championTokenId);
  const allOpponentIds = Array.from(
    new Set(slots.flatMap((s) => s.opponents))
  );
  const allYourIds = Array.from(new Set([...yourIds, ...benchChampionIds]));

  // Step 1: Fetch H2H data for all your+bench champions vs all opponents
  const h2hMatrix = await getBulkHeadToHead(allYourIds, allOpponentIds);

  // Also get general performance stats for fallback estimation
  const allIds = Array.from(new Set([...allYourIds, ...allOpponentIds]));
  const perfData = await getBulkMatchPerformance(allIds);

  // Step 2: Evaluate current matchups for each slot
  const evaluatedSlots: MokiSlot[] = [];

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const slot = slots[slotIdx];
    const yourId = slot.championTokenId;
    const yourInfo = gameData.get(yourId) ?? {
      name: `#${yourId}`,
      championClass: "Unknown",
    };

    const opponents: SingleMatchup[] = [];
    for (const oppId of slot.opponents) {
      const oppInfo = gameData.get(oppId) ?? {
        name: `#${oppId}`,
        championClass: "Unknown",
      };

      const h2h = h2hMatrix.get(yourId)?.get(oppId);
      const winRate = h2h ? h2h.winRate : estimateWinRate(yourId, oppId, perfData);
      const matches = h2h?.totalMatches ?? 0;

      opponents.push({
        yourChampionTokenId: yourId,
        yourChampionName: yourInfo.name,
        yourChampionClass: yourInfo.championClass,
        opponentChampionTokenId: oppId,
        opponentChampionName: oppInfo.name,
        opponentChampionClass: oppInfo.championClass,
        h2hWinRate: winRate,
        h2hMatches: matches,
        h2hWins: h2h?.wins ?? 0,
        h2hLosses: h2h?.losses ?? 0,
        confidence: getConfidence(matches),
      });
    }

    const avgWinRate =
      opponents.length > 0
        ? Math.round(
            (opponents.reduce((sum, o) => sum + o.h2hWinRate, 0) / opponents.length) * 100
          ) / 100
        : 50;

    const expectedWins =
      opponents.length > 0
        ? Math.round(
            opponents.reduce((sum, o) => sum + o.h2hWinRate / 100, 0) * 100
          ) / 100
        : 2.5;

    evaluatedSlots.push({
      slotIndex: slotIdx,
      yourChampionTokenId: yourId,
      yourChampionName: yourInfo.name,
      yourChampionClass: yourInfo.championClass,
      opponents,
      averageWinRate: avgWinRate,
      expectedWins,
    });
  }

  // Step 3: Calculate current overall stats
  const allMatchups = evaluatedSlots.flatMap((s) => s.opponents);
  const totalMatchups = allMatchups.length;
  const currentOverallWinRate =
    totalMatchups > 0
      ? Math.round(
          (allMatchups.reduce((sum, m) => sum + m.h2hWinRate, 0) / totalMatchups) * 100
        ) / 100
      : 50;
  const currentExpectedTotalWins =
    Math.round(allMatchups.reduce((sum, m) => sum + m.h2hWinRate / 100, 0) * 100) / 100;

  // Step 4: Find best swaps for each slot
  const recommendations: SwapRecommendation[] = [];
  const currentLineupIds = new Set(yourIds);

  for (const slot of evaluatedSlots) {
    const currentAvgWinRate = slot.averageWinRate;
    const currentExpectedWins = slot.expectedWins;

    let bestSwap: {
      champId: number;
      avgWinRate: number;
      expectedWins: number;
      opponentBreakdown: Array<{
        opponentName: string;
        opponentTokenId: number;
        currentWinRate: number;
        suggestedWinRate: number;
        improvement: number;
      }>;
      totalH2hMatches: number;
    } | null = null;

    for (const benchId of benchChampionIds) {
      // Skip if this champion is already in the lineup
      if (currentLineupIds.has(benchId)) continue;

      // Evaluate this bench champion against all 5 opponents in this slot
      let totalWinRate = 0;
      let totalH2hMatches = 0;
      const breakdown: Array<{
        opponentName: string;
        opponentTokenId: number;
        currentWinRate: number;
        suggestedWinRate: number;
        improvement: number;
      }> = [];

      for (const opp of slot.opponents) {
        const oppId = opp.opponentChampionTokenId;
        const h2h = h2hMatrix.get(benchId)?.get(oppId);
        const swapWinRate = h2h ? h2h.winRate : estimateWinRate(benchId, oppId, perfData);
        totalWinRate += swapWinRate;
        totalH2hMatches += h2h?.totalMatches ?? 0;

        breakdown.push({
          opponentName: opp.opponentChampionName,
          opponentTokenId: oppId,
          currentWinRate: opp.h2hWinRate,
          suggestedWinRate: swapWinRate,
          improvement: Math.round((swapWinRate - opp.h2hWinRate) * 100) / 100,
        });
      }

      const avgWinRate =
        slot.opponents.length > 0
          ? Math.round((totalWinRate / slot.opponents.length) * 100) / 100
          : 50;
      const expectedWins =
        Math.round((totalWinRate / 100) * 100) / 100;

      // Only recommend if meaningfully better (>2% avg improvement)
      if (avgWinRate > currentAvgWinRate + 2) {
        if (!bestSwap || avgWinRate > bestSwap.avgWinRate) {
          bestSwap = {
            champId: benchId,
            avgWinRate,
            expectedWins,
            opponentBreakdown: breakdown,
            totalH2hMatches,
          };
        }
      }
    }

    if (bestSwap) {
      const swapInfo = gameData.get(bestSwap.champId) ?? {
        name: `#${bestSwap.champId}`,
        championClass: "Unknown",
      };

      const improvement = Math.round((bestSwap.avgWinRate - currentAvgWinRate) * 100) / 100;
      const winsImprovement = Math.round((bestSwap.expectedWins - currentExpectedWins) * 100) / 100;

      // Build reason string
      const betterCount = bestSwap.opponentBreakdown.filter((b) => b.improvement > 0).length;
      const totalOpps = bestSwap.opponentBreakdown.length;
      let reason = `${swapInfo.name} performs better in ${betterCount}/${totalOpps} matchups`;
      if (bestSwap.totalH2hMatches >= 20) {
        reason += ` (based on ${bestSwap.totalH2hMatches} H2H matches)`;
      } else if (bestSwap.totalH2hMatches > 0) {
        reason += ` (${bestSwap.totalH2hMatches} H2H matches — limited data)`;
      } else {
        reason += ` (estimated from overall performance)`;
      }

      recommendations.push({
        slotIndex: slot.slotIndex,
        currentChampionTokenId: slot.yourChampionTokenId,
        currentChampionName: slot.yourChampionName,
        currentAvgWinRate: currentAvgWinRate,
        currentExpectedWins: currentExpectedWins,
        suggestedChampionTokenId: bestSwap.champId,
        suggestedChampionName: swapInfo.name,
        suggestedChampionClass: swapInfo.championClass,
        suggestedAvgWinRate: bestSwap.avgWinRate,
        suggestedExpectedWins: bestSwap.expectedWins,
        winRateImprovement: improvement,
        expectedWinsImprovement: winsImprovement,
        opponentBreakdown: bestSwap.opponentBreakdown,
        reason,
        confidence: getConfidence(bestSwap.totalH2hMatches) as "high" | "medium" | "low",
      });
    }
  }

  // Sort recommendations by improvement (biggest first)
  recommendations.sort((a, b) => b.winRateImprovement - a.winRateImprovement);

  // Calculate best possible win rate if all swaps are applied
  let bestTotalWinRate = 0;
  let bestTotalExpectedWins = 0;
  for (const slot of evaluatedSlots) {
    const rec = recommendations.find((r) => r.slotIndex === slot.slotIndex);
    if (rec) {
      bestTotalWinRate += rec.suggestedAvgWinRate;
      bestTotalExpectedWins += rec.suggestedExpectedWins;
    } else {
      bestTotalWinRate += slot.averageWinRate;
      bestTotalExpectedWins += slot.expectedWins;
    }
  }
  const bestPossibleWinRate =
    evaluatedSlots.length > 0
      ? Math.round((bestTotalWinRate / evaluatedSlots.length) * 100) / 100
      : 50;
  const bestPossibleExpectedWins = Math.round(bestTotalExpectedWins * 100) / 100;

  const matchupsWithData = allMatchups.filter((m) => m.h2hMatches > 0).length;

  return {
    slots: evaluatedSlots,
    currentOverallWinRate,
    currentExpectedTotalWins,
    recommendations,
    bestPossibleWinRate,
    bestPossibleExpectedWins,
    improvementPotential: Math.round((bestPossibleWinRate - currentOverallWinRate) * 100) / 100,
    dataQuality: {
      matchupsWithData,
      matchupsWithoutData: totalMatchups - matchupsWithData,
      totalH2hMatchesUsed: allMatchups.reduce((sum, m) => sum + m.h2hMatches, 0),
      totalMatchups,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Estimate win rate when no H2H data exists.
 * Falls back to comparing overall performance stats.
 */
function estimateWinRate(
  champId: number,
  oppId: number,
  perfData: Map<
    string,
    {
      avgKills: number;
      avgBalls: number;
      avgWartDistance: number;
      winRate: number;
      totalMatches: number;
    }
  >
): number {
  const champPerf = perfData.get(String(champId));
  const oppPerf = perfData.get(String(oppId));

  if (!champPerf && !oppPerf) return 50;
  if (!champPerf) return 40;
  if (!oppPerf) return 60;

  const champScore =
    champPerf.avgKills * 85 + champPerf.avgBalls * 40 + champPerf.avgWartDistance;
  const oppScore =
    oppPerf.avgKills * 85 + oppPerf.avgBalls * 40 + oppPerf.avgWartDistance;

  const winRateDiff = champPerf.winRate - oppPerf.winRate;
  const scoreDiff =
    champScore > 0 || oppScore > 0
      ? (champScore - oppScore) / Math.max(champScore, oppScore, 1)
      : 0;

  const rawAdvantage = winRateDiff * 0.6 + scoreDiff * 0.4;
  const estimatedWinRate = 50 + rawAdvantage * 30;

  return Math.round(Math.max(20, Math.min(80, estimatedWinRate)) * 100) / 100;
}

function getConfidence(matches: number): "high" | "medium" | "low" | "none" {
  if (matches >= 20) return "high";
  if (matches >= 5) return "medium";
  if (matches > 0) return "low";
  return "none";
}

/**
 * Load game data champion lookup map.
 * Indexes by both NFT tokenId and championTokenId.
 */
export async function loadGameDataLookup(): Promise<
  Map<number, { name: string; championClass: string; championTokenId?: number }>
> {
  const fs = await import("fs");
  const path = await import("path");
  const gameDataPath = path.resolve(
    import.meta.dirname ?? process.cwd(),
    "../client/public/game-data.json"
  );

  const lookup = new Map<
    number,
    { name: string; championClass: string; championTokenId?: number }
  >();

  try {
    const raw = fs.readFileSync(gameDataPath, "utf-8");
    const gameData = JSON.parse(raw);

    for (const champ of gameData.champions ?? []) {
      const tokenId = Number(champ.tokenId);
      const champTokenId = Number(
        champ.championTokenId ??
          champ.attributes?.["Champion Token ID"]?.[0]
      );
      if (!isNaN(tokenId)) {
        const entry = {
          name: champ.name ?? `#${tokenId}`,
          championClass: champ.class ?? "Unknown",
          championTokenId: !isNaN(champTokenId) ? champTokenId : undefined,
        };
        lookup.set(tokenId, entry);
        if (!isNaN(champTokenId)) {
          lookup.set(champTokenId, entry);
        }
      }
    }
  } catch (err) {
    console.error("[SwapAdvisor] Failed to load game data:", err);
  }

  return lookup;
}

/**
 * Get all available bench champions for a user (MOKIs they own but aren't in the current lineup).
 */
export async function getUserBenchChampions(
  userId: number,
  currentLineupTokenIds: number[]
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];

  const cards = await db
    .select({ championTokenId: userCards.championTokenId })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardType, "MOKI")));

  const currentSet = new Set(currentLineupTokenIds.map(String));
  return cards
    .map((c) => Number(c.championTokenId))
    .filter((id) => !isNaN(id) && !currentSet.has(String(id)));
}
