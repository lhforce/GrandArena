/**
 * Lineup Optimizer Engine — Builds optimal lineups for Grand Arena contests.
 * 
 * Strategy:
 * 1. Filter available cards by contest rarity restrictions
 * 2. Score each champion based on scheme bonuses and performance stats
 * 3. Build up to N lineups using a greedy algorithm that respects card lockups
 * 4. Auto-select the best scheme card per lineup
 * 5. Track card usage across entries to prevent reuse
 * 
 * Key rules:
 * - Each lineup = 4 champions + 1 scheme card
 * - Cards are locked for contest duration (can't reuse across entries unless duplicates)
 * - Prioritize legendary champions when no rarity restrictions
 * - One-Of-Each = one card from each rarity (Basic, Rare, Epic, Legendary)
 * - Star Cap = maximum total star rating across lineup
 */

import type { UserCard } from "../drizzle/schema";

// ─── Types ─────────────────────────────────────────────────────────

export interface ChampionCard {
  tokenId: string;
  championTokenId: string | null;
  name: string;
  rarity: string;
  // Performance stats (optional, from champion_stats)
  avgKills?: number;
  avgBalls?: number;
  avgWartDistance?: number;
  winRate?: number;
  totalScore?: number;
}

export interface SchemeCardData {
  tokenId: string;
  name: string;
  description: string;
  hasTraitFilter: boolean;
  qualifyingChampionIds: string[]; // championTokenIds that qualify
  category: SchemeCategory;
}

export type SchemeCategory =
  | "kills"
  | "balls"
  | "wart"
  | "win"
  | "combo"
  | "trait"
  | "conditional"
  | "rarity"
  | "other";

export interface ContestRules {
  rarityRestriction: string; // OPEN, COMMON_ONLY, RARE_ONLY, etc.
  isOneOfEach: boolean;
  isStarCap: boolean;
  maxEntriesPerUser: number;
  format: string;
}

export interface LineupSlot {
  champion: ChampionCard;
  score: number; // Predicted contribution score
}

export interface OptimizedLineup {
  champions: LineupSlot[];
  scheme: SchemeCardData | null;
  schemeTokenId: string | null;
  predictedScore: number;
  entryNumber: number;
  usesOwnedCards: boolean;
  missingCards: ChampionCard[]; // Cards needed but not owned (for purchase recs)
}

export interface OptimizerResult {
  lineups: OptimizedLineup[];
  totalEntries: number;
  gemCost: number;
  warnings: string[];
}

// ─── Rarity Scoring Multipliers (V4) ──────────────────────────────
const RARITY_MULTIPLIER: Record<string, number> = {
  Basic: 1.0,
  Common: 1.0,
  Rare: 1.25,
  Epic: 1.5,
  Legendary: 1.75,
};

const RARITY_RANK: Record<string, number> = {
  Basic: 0,
  Common: 0,
  Rare: 1,
  Epic: 2,
  Legendary: 3,
};

// ─── Scheme Categorization ─────────────────────────────────────────
export function categorizeScheme(description: string): SchemeCategory {
  const d = description.toLowerCase();
  if (d.includes("elimination") && !d.includes("ball") && !d.includes("wart")) return "kills";
  if (d.includes("gacha ball") && !d.includes("elimination") && !d.includes("wart")) return "balls";
  if (d.includes("wart") && !d.includes("elimination") && !d.includes("ball")) return "wart";
  if (d.includes("win") && !d.includes("elimination") && !d.includes("ball")) return "win";
  if (d.includes("trait") || d.includes("fur") || d.includes("1 of 1")) return "trait";
  if ((d.includes("elimination") && d.includes("ball")) || (d.includes("elimination") && d.includes("wart"))) return "combo";
  if (d.includes("rarity")) return "rarity";
  if (d.includes("when") || d.includes("if")) return "conditional";
  return "other";
}

// ─── Champion Scoring ──────────────────────────────────────────────

/**
 * Score a champion for a given scheme, considering rarity multiplier and performance stats.
 */
export function scoreChampion(
  champion: ChampionCard,
  scheme: SchemeCardData | null,
  allChampionsInLineup?: ChampionCard[]
): number {
  const multiplier = RARITY_MULTIPLIER[champion.rarity] ?? 1.0;
  
  // Base score from performance stats (weighted by V4 scoring)
  const killScore = (champion.avgKills ?? 2) * 85 * multiplier;
  const ballScore = (champion.avgBalls ?? 1) * 40 * multiplier;
  const wartScore = (champion.avgWartDistance ?? 50) * 0.5 * multiplier; // Approximate
  const winBonus = (champion.winRate ?? 0.3) * 200 * multiplier;
  
  let baseScore = killScore + ballScore + wartScore + winBonus;

  // Scheme bonus
  if (scheme) {
    const qualifies = !scheme.hasTraitFilter || 
      scheme.qualifyingChampionIds.includes(champion.championTokenId ?? "");
    
    if (qualifies) {
      const cat = scheme.category;
      switch (cat) {
        case "kills":
          // Kills-focused schemes boost kill-heavy champions
          baseScore += (champion.avgKills ?? 2) * 85 * 0.5 * multiplier;
          break;
        case "balls":
          baseScore += (champion.avgBalls ?? 1) * 40 * 0.5 * multiplier;
          break;
        case "wart":
          baseScore += (champion.avgWartDistance ?? 50) * 0.3 * multiplier;
          break;
        case "win":
          baseScore += (champion.winRate ?? 0.3) * 200 * 0.5 * multiplier;
          break;
        case "trait":
          // Trait schemes give flat bonus per qualifying champion
          baseScore += 25 * multiplier;
          break;
        case "combo":
          baseScore += ((champion.avgKills ?? 2) * 35 + (champion.avgBalls ?? 1) * 10) * multiplier;
          break;
        default:
          baseScore += 15 * multiplier;
      }
    }
  }

  return Math.round(baseScore);
}

// ─── Rarity Filter ─────────────────────────────────────────────────

/**
 * Filter champions by contest rarity restriction.
 */
export function filterByRarity(
  champions: ChampionCard[],
  restriction: string
): ChampionCard[] {
  switch (restriction) {
    case "COMMON_ONLY":
      return champions.filter((c) => c.rarity === "Basic" || c.rarity === "Common");
    case "RARE_ONLY":
      return champions.filter((c) => c.rarity === "Rare");
    case "EPIC_ONLY":
      return champions.filter((c) => c.rarity === "Epic");
    case "LEGENDARY_ONLY":
      return champions.filter((c) => c.rarity === "Legendary");
    case "NO_LEGENDARY":
      return champions.filter((c) => c.rarity !== "Legendary");
    case "BASIC_OR_RARE":
      return champions.filter(
        (c) => c.rarity === "Basic" || c.rarity === "Common" || c.rarity === "Rare"
      );
    case "OPEN":
    default:
      return champions;
  }
}

// ─── One-Of-Each Builder ───────────────────────────────────────────

/**
 * Build a One-Of-Each lineup: exactly one champion from each rarity tier.
 */
function buildOneOfEachLineup(
  available: ChampionCard[],
  scheme: SchemeCardData | null,
  usedTokenIds: Set<string>
): LineupSlot[] | null {
  const byRarity: Record<string, ChampionCard[]> = {
    Basic: [],
    Rare: [],
    Epic: [],
    Legendary: [],
  };

  for (const c of available) {
    if (usedTokenIds.has(c.tokenId)) continue;
    const r = c.rarity === "Common" ? "Basic" : c.rarity;
    if (byRarity[r]) byRarity[r].push(c);
  }

  // Need at least one from each rarity
  const rarities = ["Basic", "Rare", "Epic", "Legendary"];
  for (const r of rarities) {
    if (byRarity[r].length === 0) return null;
  }

  // Score and pick the best from each rarity
  const lineup: LineupSlot[] = [];
  for (const r of rarities) {
    const scored = byRarity[r]
      .map((c) => ({ champion: c, score: scoreChampion(c, scheme) }))
      .sort((a, b) => b.score - a.score);
    lineup.push(scored[0]);
  }

  return lineup;
}

// ─── Standard Lineup Builder ───────────────────────────────────────

/**
 * Build a standard 4-champion lineup from available cards.
 */
function buildStandardLineup(
  available: ChampionCard[],
  scheme: SchemeCardData | null,
  usedTokenIds: Set<string>
): LineupSlot[] | null {
  const candidates = available
    .filter((c) => !usedTokenIds.has(c.tokenId))
    .map((c) => ({ champion: c, score: scoreChampion(c, scheme) }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length < 4) return null;

  return candidates.slice(0, 4);
}

// ─── Scheme Selection ──────────────────────────────────────────────

/**
 * Auto-select the best scheme card for a given lineup.
 */
export function selectBestScheme(
  champions: ChampionCard[],
  availableSchemes: SchemeCardData[]
): SchemeCardData | null {
  if (availableSchemes.length === 0) return null;

  let bestScheme: SchemeCardData | null = null;
  let bestScore = -Infinity;

  for (const scheme of availableSchemes) {
    let totalScore = 0;
    for (const champ of champions) {
      totalScore += scoreChampion(champ, scheme, champions);
    }
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestScheme = scheme;
    }
  }

  return bestScheme;
}

// ─── Main Optimizer ────────────────────────────────────────────────

export interface OptimizerInput {
  ownedMokis: ChampionCard[];
  ownedSchemes: SchemeCardData[];
  allSchemes: SchemeCardData[]; // Full scheme catalog for recommendations
  contestRules: ContestRules;
  numEntries: number; // How many entries to build (1-5)
  entryFee: number; // Gems per entry
  dailyBudget: number; // Remaining daily gem budget
  performanceStats?: Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number }>;
}

/**
 * Build optimal lineups for a contest.
 */
export function optimizeLineups(input: OptimizerInput): OptimizerResult {
  const {
    ownedMokis,
    ownedSchemes,
    allSchemes,
    contestRules,
    numEntries,
    entryFee,
    dailyBudget,
    performanceStats,
  } = input;

  const warnings: string[] = [];
  const lineups: OptimizedLineup[] = [];

  // Apply performance stats to owned mokis
  const enrichedMokis: ChampionCard[] = ownedMokis.map((m) => {
    const stats = performanceStats?.get(m.championTokenId ?? "");
    return {
      ...m,
      avgKills: stats?.avgKills ?? m.avgKills,
      avgBalls: stats?.avgBalls ?? m.avgBalls,
      avgWartDistance: stats?.avgWartDistance ?? m.avgWartDistance,
      winRate: stats?.winRate ?? m.winRate,
    };
  });

  // Filter by rarity restriction
  const eligible = filterByRarity(enrichedMokis, contestRules.rarityRestriction);

  if (eligible.length < 4) {
    warnings.push(
      `Only ${eligible.length} eligible champions found (need 4). Consider purchasing more cards.`
    );
  }

  // Calculate max entries based on budget
  const maxAffordable = entryFee > 0 ? Math.floor(dailyBudget / entryFee) : numEntries;
  const actualEntries = Math.min(
    numEntries,
    contestRules.maxEntriesPerUser,
    maxAffordable
  );

  if (actualEntries < numEntries) {
    if (maxAffordable < numEntries) {
      warnings.push(
        `Budget allows only ${maxAffordable} entries (${entryFee} gems each, ${dailyBudget} budget).`
      );
    }
    if (contestRules.maxEntriesPerUser < numEntries) {
      warnings.push(
        `Contest allows max ${contestRules.maxEntriesPerUser} entries per user.`
      );
    }
  }

  const usedTokenIds = new Set<string>();
  const usedSchemeTokenIds = new Set<string>();

  for (let entry = 1; entry <= actualEntries; entry++) {
    // Build lineup based on contest type
    let slots: LineupSlot[] | null = null;

    if (contestRules.isOneOfEach) {
      slots = buildOneOfEachLineup(eligible, null, usedTokenIds);
    } else {
      slots = buildStandardLineup(eligible, null, usedTokenIds);
    }

    if (!slots || slots.length < 4) {
      warnings.push(`Not enough unique cards for entry #${entry}.`);
      break;
    }

    // Mark cards as used
    for (const slot of slots) {
      usedTokenIds.add(slot.champion.tokenId);
    }

    // Select best scheme
    const availableSchemeData = ownedSchemes.filter(
      (s) => !usedSchemeTokenIds.has(s.tokenId)
    );
    const bestScheme = selectBestScheme(
      slots.map((s) => s.champion),
      availableSchemeData.length > 0 ? availableSchemeData : allSchemes
    );

    if (bestScheme && availableSchemeData.find((s) => s.tokenId === bestScheme.tokenId)) {
      usedSchemeTokenIds.add(bestScheme.tokenId);
    }

    // Re-score with the selected scheme
    const rescoredSlots = slots.map((slot) => ({
      ...slot,
      score: scoreChampion(slot.champion, bestScheme),
    }));

    const predictedScore = rescoredSlots.reduce((sum, s) => sum + s.score, 0);

    lineups.push({
      champions: rescoredSlots,
      scheme: bestScheme,
      schemeTokenId: bestScheme?.tokenId ?? null,
      predictedScore,
      entryNumber: entry,
      usesOwnedCards: true,
      missingCards: [],
    });
  }

  return {
    lineups,
    totalEntries: lineups.length,
    gemCost: lineups.length * entryFee,
    warnings,
  };
}

/**
 * Convert UserCard records to ChampionCard format for the optimizer.
 */
export function userCardsToChampionCards(cards: UserCard[]): ChampionCard[] {
  return cards
    .filter((c) => c.cardType === "MOKI")
    .map((c) => ({
      tokenId: c.tokenId,
      championTokenId: c.championTokenId,
      name: c.name ?? "Unknown",
      rarity: c.rarity ?? "Basic",
    }));
}
