/**
 * Swap Advisor — Post-entry lineup optimization engine.
 *
 * After a user enters a contest and sees their actual matchups (which of their
 * MOKIs face which opponent MOKIs), this engine recommends lineup swaps based
 * on the H2H database.
 *
 * Flow:
 * 1. User provides their current 4 MOKIs and the opponent's 4 MOKIs
 * 2. Engine looks up all H2H records between every pair
 * 3. Engine evaluates the current assignment's total expected win rate
 * 4. Engine tries all possible swaps from the user's bench and recommends
 *    the ones that improve the expected outcome the most
 */

import { getBulkHeadToHead, getBulkMatchPerformance } from "./matchupAnalytics";
import { getDb } from "./db";
import { userCards, championStats } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────

export interface MatchupSlot {
  position: number; // 1-4 (match slot)
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

export interface SwapRecommendation {
  position: number; // Which match slot to swap
  currentChampionTokenId: number;
  currentChampionName: string;
  currentWinRate: number;
  currentH2hMatches: number;
  suggestedChampionTokenId: number;
  suggestedChampionName: string;
  suggestedChampionClass: string;
  suggestedWinRate: number;
  suggestedH2hMatches: number;
  winRateImprovement: number; // positive = better
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface SwapAnalysisResult {
  currentMatchups: MatchupSlot[];
  currentOverallWinRate: number; // Average win rate across all 4 matchups
  recommendations: SwapRecommendation[];
  bestPossibleWinRate: number;
  improvementPotential: number; // bestPossibleWinRate - currentOverallWinRate
  dataQuality: {
    matchupsWithData: number;
    matchupsWithoutData: number;
    totalH2hMatchesUsed: number;
  };
}

// ─── Core Engine ───────────────────────────────────────────────────

/**
 * Analyze current matchups and recommend swaps.
 *
 * @param yourChampionIds - Array of 4 champion token IDs in your lineup (ordered by match slot)
 * @param opponentChampionIds - Array of 4 opponent champion token IDs (ordered by match slot)
 * @param benchChampionIds - Array of available bench champion IDs to swap in
 * @param gameData - Game data for champion name/class lookups
 */
export async function analyzeMatchupsAndRecommendSwaps(
  yourChampionIds: number[],
  opponentChampionIds: number[],
  benchChampionIds: number[],
  gameData: Map<number, { name: string; championClass: string }>
): Promise<SwapAnalysisResult> {
  // Step 1: Get H2H data for all your champions vs all opponents
  const allYourIds = Array.from(new Set([...yourChampionIds, ...benchChampionIds]));
  const allOppIds = Array.from(new Set(opponentChampionIds));

  const h2hMatrix = await getBulkHeadToHead(allYourIds, allOppIds);

  // Also get general performance stats for fallback
  const allIds = Array.from(new Set([...allYourIds, ...allOppIds]));
  const perfData = await getBulkMatchPerformance(allIds);

  // Step 2: Evaluate current matchups
  const currentMatchups: MatchupSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const yourId = yourChampionIds[i];
    const oppId = opponentChampionIds[i];
    if (!yourId || !oppId) continue;

    const yourInfo = gameData.get(yourId) ?? { name: `#${yourId}`, championClass: "Unknown" };
    const oppInfo = gameData.get(oppId) ?? { name: `#${oppId}`, championClass: "Unknown" };

    const h2h = h2hMatrix.get(yourId)?.get(oppId);
    const winRate = h2h ? h2h.winRate : estimateWinRate(yourId, oppId, perfData);
    const matches = h2h?.totalMatches ?? 0;

    currentMatchups.push({
      position: i + 1,
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

  const currentOverallWinRate =
    currentMatchups.length > 0
      ? Math.round(
          (currentMatchups.reduce((sum, m) => sum + m.h2hWinRate, 0) /
            currentMatchups.length) *
            100
        ) / 100
      : 50;

  // Step 3: Find best swaps for each position
  const recommendations: SwapRecommendation[] = [];

  for (let pos = 0; pos < currentMatchups.length; pos++) {
    const slot = currentMatchups[pos];
    const oppId = slot.opponentChampionTokenId;
    const currentWinRate = slot.h2hWinRate;

    // Try each bench champion in this position
    let bestSwap: {
      champId: number;
      winRate: number;
      matches: number;
    } | null = null;

    for (const benchId of benchChampionIds) {
      // Skip if this champion is already in the lineup at another position
      if (yourChampionIds.includes(benchId)) continue;

      const h2h = h2hMatrix.get(benchId)?.get(oppId);
      const swapWinRate = h2h ? h2h.winRate : estimateWinRate(benchId, oppId, perfData);
      const swapMatches = h2h?.totalMatches ?? 0;

      // Only recommend if it's meaningfully better (>3% improvement)
      if (swapWinRate > currentWinRate + 3) {
        if (!bestSwap || swapWinRate > bestSwap.winRate) {
          bestSwap = { champId: benchId, winRate: swapWinRate, matches: swapMatches };
        }
      }
    }

    if (bestSwap) {
      const swapInfo = gameData.get(bestSwap.champId) ?? {
        name: `#${bestSwap.champId}`,
        championClass: "Unknown",
      };

      const improvement = Math.round((bestSwap.winRate - currentWinRate) * 100) / 100;

      // Build reason string
      let reason = "";
      if (bestSwap.matches >= 10) {
        reason = `${swapInfo.name} has a ${bestSwap.winRate}% win rate vs ${slot.opponentChampionName} across ${bestSwap.matches} matches`;
      } else if (bestSwap.matches > 0) {
        reason = `${swapInfo.name} has a ${bestSwap.winRate}% win rate vs ${slot.opponentChampionName} (${bestSwap.matches} matches — limited data)`;
      } else {
        reason = `${swapInfo.name} is estimated to perform better based on overall stats`;
      }

      recommendations.push({
        position: pos + 1,
        currentChampionTokenId: slot.yourChampionTokenId,
        currentChampionName: slot.yourChampionName,
        currentWinRate,
        currentH2hMatches: slot.h2hMatches,
        suggestedChampionTokenId: bestSwap.champId,
        suggestedChampionName: swapInfo.name,
        suggestedChampionClass: swapInfo.championClass,
        suggestedWinRate: bestSwap.winRate,
        suggestedH2hMatches: bestSwap.matches,
        winRateImprovement: improvement,
        reason,
        confidence: getConfidence(bestSwap.matches) as "high" | "medium" | "low",
      });
    }
  }

  // Sort recommendations by improvement (biggest first)
  recommendations.sort((a, b) => b.winRateImprovement - a.winRateImprovement);

  // Calculate best possible win rate if all swaps are applied
  const bestMatchupRates = currentMatchups.map((m) => {
    const rec = recommendations.find((r) => r.position === m.position);
    return rec ? rec.suggestedWinRate : m.h2hWinRate;
  });
  const bestPossibleWinRate =
    bestMatchupRates.length > 0
      ? Math.round(
          (bestMatchupRates.reduce((sum, r) => sum + r, 0) / bestMatchupRates.length) * 100
        ) / 100
      : 50;

  const matchupsWithData = currentMatchups.filter((m) => m.h2hMatches > 0).length;

  return {
    currentMatchups,
    currentOverallWinRate,
    recommendations,
    bestPossibleWinRate,
    improvementPotential: Math.round((bestPossibleWinRate - currentOverallWinRate) * 100) / 100,
    dataQuality: {
      matchupsWithData,
      matchupsWithoutData: currentMatchups.length - matchupsWithData,
      totalH2hMatchesUsed: currentMatchups.reduce((sum, m) => sum + m.h2hMatches, 0),
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
  perfData: Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>
): number {
  const champPerf = perfData.get(String(champId));
  const oppPerf = perfData.get(String(oppId));

  if (!champPerf && !oppPerf) return 50; // No data at all
  if (!champPerf) return 40; // We have no data on our champ but opponent has data
  if (!oppPerf) return 60; // We have data, opponent doesn't

  // Simple estimation: compare win rates and score potential
  const champScore = champPerf.avgKills * 85 + champPerf.avgBalls * 40 + champPerf.avgWartDistance;
  const oppScore = oppPerf.avgKills * 85 + oppPerf.avgBalls * 40 + oppPerf.avgWartDistance;

  // Blend win rate comparison with score comparison
  const winRateDiff = champPerf.winRate - oppPerf.winRate; // -1 to 1
  const scoreDiff = champScore > 0 || oppScore > 0
    ? (champScore - oppScore) / Math.max(champScore, oppScore, 1) // -1 to 1
    : 0;

  // Convert to win probability (logistic-like)
  const rawAdvantage = winRateDiff * 0.6 + scoreDiff * 0.4;
  const estimatedWinRate = 50 + rawAdvantage * 30; // Scale to 20-80 range

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
 */
export async function loadGameDataLookup(): Promise<Map<number, { name: string; championClass: string; championTokenId?: number }>> {
  const fs = await import("fs");
  const path = await import("path");
  const gameDataPath = path.resolve(
    import.meta.dirname ?? process.cwd(),
    "../client/public/game-data.json"
  );

  const lookup = new Map<number, { name: string; championClass: string; championTokenId?: number }>();

  try {
    const raw = fs.readFileSync(gameDataPath, "utf-8");
    const gameData = JSON.parse(raw);

    for (const champ of gameData.champions ?? []) {
      const tokenId = Number(champ.tokenId);
      const champTokenId = Number(champ.championTokenId ?? champ.attributes?.["Champion Token ID"]?.[0]);
      if (!isNaN(tokenId)) {
        const entry = {
          name: champ.name ?? `#${tokenId}`,
          championClass: champ.class ?? "Unknown",
          championTokenId: !isNaN(champTokenId) ? champTokenId : undefined,
        };
        // Index by NFT tokenId
        lookup.set(tokenId, entry);
        // Also index by championTokenId for H2H lookups
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
    .where(
      and(
        eq(userCards.userId, userId),
        eq(userCards.cardType, "MOKI")
      )
    );

  const currentSet = new Set(currentLineupTokenIds.map(String));
  return cards
    .map((c) => Number(c.championTokenId))
    .filter((id) => !isNaN(id) && !currentSet.has(String(id)));
}
