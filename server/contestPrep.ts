/**
 * Contest Prep Engine — Proactive opponent scouting and lineup building.
 *
 * Strategy (reversed from traditional approach):
 * 1. Enter a dummy lineup to see opponents
 * 2. Extract all 20 matchups (4 slots × 5 opponents each)
 * 3. For each slot, rank ALL user's MOKIs by H2H advantage against that slot's 5 opponents
 * 4. Select optimal 4 MOKIs (no duplicates) that maximize total matchup advantage
 * 5. Find the best Scheme card whose trait requirements match the selected MOKIs
 */

import { getBulkHeadToHead, getBulkMatchPerformance } from "./matchupAnalytics";
import { getDb } from "./db";
import { userCards } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { loadGameDataLookup } from "./gameDataUtils";

// ─── Types ─────────────────────────────────────────────────────────

export interface SlotOpponents {
  slotIndex: number; // 0-3
  opponentIds: number[]; // 5 opponent championTokenIds
  opponentNames: string[]; // For display
}

export interface MokiCandidate {
  championTokenId: number;
  name: string;
  championClass: string;
  rarity: string;
  nftTokenId: string;
  imageUrl?: string | null;
  /** Average H2H win rate across this slot's 5 opponents */
  avgWinRate: number;
  /** Expected wins out of 5 */
  expectedWins: number;
  /** Per-opponent breakdown */
  opponentBreakdown: Array<{
    opponentId: number;
    opponentName: string;
    winRate: number;
    h2hMatches: number;
    confidence: "high" | "medium" | "low" | "none";
  }>;
  /** Overall data quality */
  totalH2hMatches: number;
  confidence: "high" | "medium" | "low" | "none";
}

export interface SlotRecommendation {
  slotIndex: number;
  opponents: Array<{ id: number; name: string; championClass: string }>;
  /** All user MOKIs ranked by matchup advantage for this slot */
  rankedCandidates: MokiCandidate[];
  /** The selected MOKI for this slot (from the optimal lineup) */
  selectedMoki: MokiCandidate | null;
}

export interface SchemeRecommendation {
  tokenId: string;
  name: string;
  description: string;
  imageUrl?: string;
  hasTraitFilter: boolean;
  /** How many of the 4 selected MOKIs qualify for this scheme */
  qualifyingCount: number;
  /** Which MOKIs qualify */
  qualifyingMokis: string[];
  /** Which MOKIs don't qualify (only for trait-filter schemes) */
  nonQualifyingMokis: string[];
  /** Estimated scheme bonus score */
  estimatedBonus: number;
  /** Rank among all schemes */
  rank: number;
}

export interface ContestPrepResult {
  /** Per-slot analysis with ranked MOKI candidates */
  slots: SlotRecommendation[];
  /** The optimal 4-MOKI lineup */
  selectedLineup: {
    mokis: MokiCandidate[];
    overallAvgWinRate: number;
    overallExpectedWins: number; // out of 20
  };
  /** Top scheme card recommendations for the selected lineup */
  schemeRecommendations: SchemeRecommendation[];
  /** Data quality summary */
  dataQuality: {
    totalMatchupsAnalyzed: number;
    matchupsWithH2hData: number;
    matchupsEstimated: number;
    totalH2hMatchesUsed: number;
    userMokisEvaluated: number;
  };
}

// ─── Core Engine ───────────────────────────────────────────────────

/**
 * Main Contest Prep analysis: given 4 slots of opponents, find the optimal
 * lineup from the user's collection and the best Scheme card.
 */
export async function analyzeContestPrep(
  opponentSlots: SlotOpponents[],
  userMokiIds: Array<{ championTokenId: number; nftTokenId: string; name: string; rarity: string; imageUrl?: string | null }>,
  gameData: Map<number, { name: string; championClass: string; championTokenId?: number }>,
  schemeData: Array<{
    tokenId: string;
    name: string;
    description: string;
    imageUrl?: string;
    hasTraitFilter: boolean;
    qualifyingChampionIds: string[];
  }>
): Promise<ContestPrepResult> {
  // Collect all unique IDs
  const allUserChampIds = userMokiIds.map((m) => m.championTokenId);
  const allOpponentIds = Array.from(
    new Set(opponentSlots.flatMap((s) => s.opponentIds))
  );

  // Step 1: Fetch H2H data for all user MOKIs vs all opponents
  const h2hMatrix = await getBulkHeadToHead(allUserChampIds, allOpponentIds);

  // Also get general performance stats for fallback estimation
  const allIds = Array.from(new Set([...allUserChampIds, ...allOpponentIds]));
  const perfData = await getBulkMatchPerformance(allIds);

  // Step 2: For each slot, evaluate every user MOKI against that slot's 5 opponents
  const slotCandidates: SlotRecommendation[] = [];
  let totalMatchupsAnalyzed = 0;
  let matchupsWithH2hData = 0;
  let totalH2hMatchesUsed = 0;

  for (const slot of opponentSlots) {
    const opponents = slot.opponentIds.map((oppId, i) => {
      const info = gameData.get(oppId);
      return {
        id: oppId,
        name: slot.opponentNames[i] || info?.name || `#${oppId}`,
        championClass: info?.championClass || "Unknown",
      };
    });

    const candidates: MokiCandidate[] = [];

    for (const userMoki of userMokiIds) {
      const champId = userMoki.championTokenId;
      const champInfo = gameData.get(champId);

      const opponentBreakdown: MokiCandidate["opponentBreakdown"] = [];
      let totalWinRate = 0;
      let totalMatches = 0;

      for (const opp of opponents) {
        const h2h = h2hMatrix.get(champId)?.get(opp.id);
        const winRate = h2h
          ? h2h.winRate
          : estimateWinRate(champId, opp.id, perfData);
        const matches = h2h?.totalMatches ?? 0;

        totalWinRate += winRate;
        totalMatches += matches;
        totalMatchupsAnalyzed++;
        if (matches > 0) matchupsWithH2hData++;
        totalH2hMatchesUsed += matches;

        opponentBreakdown.push({
          opponentId: opp.id,
          opponentName: opp.name,
          winRate: Math.round(winRate * 100) / 100,
          h2hMatches: matches,
          confidence: getConfidence(matches),
        });
      }

      const numOpponents = opponents.length || 1;
      const avgWinRate = Math.round((totalWinRate / numOpponents) * 100) / 100;
      const expectedWins = Math.round((totalWinRate / 100) * 100) / 100;

      candidates.push({
        championTokenId: champId,
        name: userMoki.name || champInfo?.name || `#${champId}`,
        championClass: champInfo?.championClass || "Unknown",
        rarity: userMoki.rarity,
        nftTokenId: userMoki.nftTokenId,
        imageUrl: userMoki.imageUrl,
        avgWinRate,
        expectedWins,
        opponentBreakdown,
        totalH2hMatches: totalMatches,
        confidence: getConfidence(totalMatches),
      });
    }

    // Sort by average win rate descending
    candidates.sort((a, b) => b.avgWinRate - a.avgWinRate);

    slotCandidates.push({
      slotIndex: slot.slotIndex,
      opponents,
      rankedCandidates: candidates,
      selectedMoki: null, // Will be filled in Step 3
    });
  }

  // Step 3: Select optimal 4-MOKI lineup (no duplicate champions)
  const selectedMokis = selectOptimalLineup(slotCandidates);

  // Assign selected MOKIs to slots
  for (let i = 0; i < slotCandidates.length; i++) {
    if (selectedMokis[i]) {
      slotCandidates[i].selectedMoki = selectedMokis[i];
    }
  }

  // Calculate overall stats
  const overallAvgWinRate =
    selectedMokis.length > 0
      ? Math.round(
          (selectedMokis.reduce((sum, m) => sum + (m?.avgWinRate ?? 50), 0) /
            selectedMokis.length) *
            100
        ) / 100
      : 50;
  const overallExpectedWins =
    Math.round(
      selectedMokis.reduce((sum, m) => sum + (m?.expectedWins ?? 2.5), 0) * 100
    ) / 100;

  // Step 4: Find best Scheme cards for the selected lineup
  const schemeRecs = rankSchemeCards(
    selectedMokis.filter(Boolean) as MokiCandidate[],
    schemeData,
    gameData
  );

  return {
    slots: slotCandidates,
    selectedLineup: {
      mokis: selectedMokis.filter(Boolean) as MokiCandidate[],
      overallAvgWinRate,
      overallExpectedWins,
    },
    schemeRecommendations: schemeRecs,
    dataQuality: {
      totalMatchupsAnalyzed,
      matchupsWithH2hData,
      matchupsEstimated: totalMatchupsAnalyzed - matchupsWithH2hData,
      totalH2hMatchesUsed,
      userMokisEvaluated: userMokiIds.length,
    },
  };
}

// ─── Optimal Lineup Selection ─────────────────────────────────────

/**
 * Select the best 4 MOKIs across 4 slots, ensuring no champion appears twice.
 * Uses a greedy algorithm with backtracking for conflict resolution.
 *
 * Strategy:
 * 1. For each slot, take the top-ranked MOKI
 * 2. If a MOKI appears in multiple slots, assign it to the slot where it has
 *    the biggest advantage over the next-best alternative
 * 3. Backtrack and reassign until no conflicts remain
 */
function selectOptimalLineup(
  slots: SlotRecommendation[]
): (MokiCandidate | null)[] {
  const numSlots = slots.length;
  if (numSlots === 0) return [];

  // Try all reasonable combinations using a priority-based approach
  // For each slot, maintain an index into its ranked candidates
  const indices = new Array(numSlots).fill(0);
  const usedChampIds = new Set<number>();
  const selected: (MokiCandidate | null)[] = new Array(numSlots).fill(null);

  // Sort slots by how few good candidates they have (most constrained first)
  const slotOrder = slots
    .map((s, i) => ({ idx: i, candidates: s.rankedCandidates.length }))
    .sort((a, b) => a.candidates - b.candidates)
    .map((s) => s.idx);

  // Greedy assignment with constraint propagation
  for (const slotIdx of slotOrder) {
    const candidates = slots[slotIdx].rankedCandidates;
    let assigned = false;

    for (const candidate of candidates) {
      if (!usedChampIds.has(candidate.championTokenId)) {
        selected[slotIdx] = candidate;
        usedChampIds.add(candidate.championTokenId);
        assigned = true;
        break;
      }
    }

    if (!assigned && candidates.length > 0) {
      // All top candidates are taken — try to find any available one
      selected[slotIdx] = null;
    }
  }

  // Second pass: try to improve by swapping assignments
  // Check if any reassignment improves total win rate
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 20) {
    improved = false;
    iterations++;

    for (let i = 0; i < numSlots; i++) {
      for (let j = i + 1; j < numSlots; j++) {
        const mokiI = selected[i];
        const mokiJ = selected[j];
        if (!mokiI || !mokiJ) continue;

        // What if we swapped the assignments?
        const candidatesI = slots[i].rankedCandidates;
        const candidatesJ = slots[j].rankedCandidates;

        // Find mokiJ's score in slot i, and mokiI's score in slot j
        const mokiJInSlotI = candidatesI.find(
          (c) => c.championTokenId === mokiJ.championTokenId
        );
        const mokiIInSlotJ = candidatesJ.find(
          (c) => c.championTokenId === mokiI.championTokenId
        );

        if (!mokiJInSlotI || !mokiIInSlotJ) continue;

        const currentScore = mokiI.avgWinRate + mokiJ.avgWinRate;
        const swappedScore = mokiJInSlotI.avgWinRate + mokiIInSlotJ.avgWinRate;

        if (swappedScore > currentScore + 0.5) {
          // Swap is beneficial
          selected[i] = mokiJInSlotI;
          selected[j] = mokiIInSlotJ;
          improved = true;
        }
      }
    }
  }

  return selected;
}

// ─── Scheme Card Ranking ──────────────────────────────────────────

/**
 * Rank all Scheme cards by how well they fit the selected 4-MOKI lineup.
 * Trait-filter schemes score based on how many MOKIs qualify.
 * Universal schemes score based on the lineup's performance profile.
 */
function rankSchemeCards(
  selectedMokis: MokiCandidate[],
  schemeData: Array<{
    tokenId: string;
    name: string;
    description: string;
    imageUrl?: string;
    hasTraitFilter: boolean;
    qualifyingChampionIds: string[];
  }>,
  gameData: Map<number, { name: string; championClass: string; championTokenId?: number }>
): SchemeRecommendation[] {
  const selectedChampIds = new Set(
    selectedMokis.map((m) => String(m.championTokenId))
  );
  const selectedNames = selectedMokis.map((m) => m.name);

  const recommendations: SchemeRecommendation[] = [];

  for (const scheme of schemeData) {
    let qualifyingCount = 0;
    const qualifyingMokis: string[] = [];
    const nonQualifyingMokis: string[] = [];

    if (scheme.hasTraitFilter) {
      // Check each selected MOKI against the scheme's qualifying list
      const qualifyingSet = new Set(scheme.qualifyingChampionIds);

      for (const moki of selectedMokis) {
        const champIdStr = String(moki.championTokenId);
        if (qualifyingSet.has(champIdStr)) {
          qualifyingCount++;
          qualifyingMokis.push(moki.name);
        } else {
          nonQualifyingMokis.push(moki.name);
        }
      }
    } else {
      // Universal scheme — all MOKIs qualify
      qualifyingCount = selectedMokis.length;
      for (const moki of selectedMokis) {
        qualifyingMokis.push(moki.name);
      }
    }

    // Estimate bonus score
    let estimatedBonus = 0;
    if (scheme.hasTraitFilter) {
      // Trait schemes: +25 points per qualifying MOKI per match
      // With 5 matches per MOKI, that's 25 * qualifyingCount * 5
      estimatedBonus = 25 * qualifyingCount * 5;
    } else {
      // Universal schemes: estimate based on description keywords
      estimatedBonus = estimateUniversalSchemeBonus(scheme.description, selectedMokis);
    }

    recommendations.push({
      tokenId: scheme.tokenId,
      name: scheme.name,
      description: scheme.description,
      imageUrl: scheme.imageUrl,
      hasTraitFilter: scheme.hasTraitFilter,
      qualifyingCount,
      qualifyingMokis,
      nonQualifyingMokis,
      estimatedBonus,
      rank: 0, // Will be set after sorting
    });
  }

  // Sort: trait schemes with all 4 qualifying first, then by estimated bonus
  recommendations.sort((a, b) => {
    // Trait schemes with full qualification get priority
    if (a.hasTraitFilter && b.hasTraitFilter) {
      if (a.qualifyingCount !== b.qualifyingCount) {
        return b.qualifyingCount - a.qualifyingCount;
      }
    }
    // Then by estimated bonus
    return b.estimatedBonus - a.estimatedBonus;
  });

  // Assign ranks
  recommendations.forEach((r, i) => {
    r.rank = i + 1;
  });

  return recommendations;
}

/**
 * Estimate bonus for universal (non-trait-filter) schemes based on description.
 */
function estimateUniversalSchemeBonus(
  description: string,
  mokis: MokiCandidate[]
): number {
  const desc = description.toLowerCase();

  // Parse bonus amounts from description
  const pointsMatch = desc.match(/\+(\d+)\s*points?/);
  const basePoints = pointsMatch ? parseInt(pointsMatch[1]) : 50;

  // Multiplier schemes
  if (desc.includes("1.5x") || desc.includes("1.3x") || desc.includes("double")) {
    return basePoints * 5; // Per match estimate
  }

  // Per-action schemes (kills, balls, etc.)
  if (desc.includes("per") && (desc.includes("elimination") || desc.includes("moki elimination"))) {
    // Estimate based on average kills across selected MOKIs
    return basePoints * 5; // ~5 actions per match estimate
  }

  if (desc.includes("per") && desc.includes("gacha ball")) {
    return basePoints * 3; // ~3 balls per match estimate
  }

  // Win condition schemes
  if (desc.includes("when") && (desc.includes("winning") || desc.includes("wins"))) {
    return basePoints * 3; // ~60% win rate * 5 matches
  }

  // Flat bonus schemes
  return basePoints * 2;
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
 * Get all user's MOKI cards with champion details.
 */
export async function getUserMokisForPrep(
  userId: number
): Promise<
  Array<{
    championTokenId: number;
    nftTokenId: string;
    name: string;
    rarity: string;
    imageUrl?: string | null;
  }>
> {
  const db = await getDb();
  if (!db) return [];

  const cards = await db
    .select({
      tokenId: userCards.tokenId,
      championTokenId: userCards.championTokenId,
      name: userCards.name,
      rarity: userCards.rarity,
      imageUrl: userCards.imageUrl,
    })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardType, "MOKI")));

  return cards
    .filter((c) => c.championTokenId)
    .map((c) => ({
      championTokenId: Number(c.championTokenId),
      nftTokenId: c.tokenId,
      name: c.name ?? `#${c.tokenId}`,
      rarity: c.rarity ?? "Basic",
      imageUrl: c.imageUrl,
    }));
}

/**
 * Load scheme data from game-data.json for Scheme matching.
 */
export async function loadSchemeData(): Promise<
  Array<{
    tokenId: string;
    name: string;
    description: string;
    imageUrl?: string;
    hasTraitFilter: boolean;
    qualifyingChampionIds: string[];
  }>
> {
  const fs = await import("fs");
  const path = await import("path");
  const gameDataPath = path.resolve(
    import.meta.dirname ?? process.cwd(),
    "../client/public/game-data.json"
  );

  try {
    const raw = fs.readFileSync(gameDataPath, "utf-8");
    const gameData = JSON.parse(raw);

    return (gameData.schemes ?? []).map(
      (s: {
        tokenId?: string;
        name?: string;
        description?: string;
        image?: string;
        hasTraitFilter?: boolean;
        qualifyingChampions?: Array<{ championTokenId?: string }>;
      }) => ({
        tokenId: s.tokenId ?? "",
        name: s.name ?? "Unknown",
        description: s.description ?? "",
        imageUrl: s.image,
        hasTraitFilter: s.hasTraitFilter ?? false,
        qualifyingChampionIds: (s.qualifyingChampions ?? [])
          .map((c) => c.championTokenId ?? "")
          .filter(Boolean),
      })
    );
  } catch (err) {
    console.error("[ContestPrep] Failed to load scheme data:", err);
    return [];
  }
}
