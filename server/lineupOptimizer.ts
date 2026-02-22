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
  imageUrl?: string | null;
  // Performance stats (optional, from champion_stats)
  avgKills?: number;
  avgBalls?: number;
  avgWartDistance?: number;
  winRate?: number;
  totalScore?: number;
  // Real average score from match history (primary ranking signal)
  avgScore?: number;
  totalMatches?: number;
}

export interface SchemeCardData {
  tokenId: string;
  name: string;
  description: string;
  hasTraitFilter: boolean;
  qualifyingChampionIds: string[]; // championTokenIds that qualify
  category: SchemeCategory;
  riskLevel: SchemeRiskLevel;
  imageUrl?: string | null;
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
// NOTE: Rarity is NOT used in champion ranking.
// Rankings are based purely on real match performance: avg score → win rate → other stats.
// Rarity is only checked for ownership purposes (Legendary Advisor feature).
const RARITY_MULTIPLIER: Record<string, number> = {
  Basic: 1.0,
  Common: 1.0,
  Rare: 1.0,
  Epic: 1.0,
  Legendary: 1.0,
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

// ─── Scheme Risk Classification ───────────────────────────────────
// Controllability hierarchy:
// - GUARANTEED: Points come from lineup composition alone (traits, rarity). No RNG.
// - RELIABLE: Points from common match actions (kills, balls, wart). Happen every match.
// - MODERATE: Depends on win/loss outcome (~50/50) or common combos.
// - RISKY: Depends on specific win conditions or uncommon in-game events.
// - HIGH_RISK: All-or-nothing gambles that can result in 0 total points.

export type SchemeRiskLevel = "guaranteed" | "reliable" | "moderate" | "risky" | "high_risk";

// Controllability multiplier: how much to trust the scheme's theoretical value
// 1.0 = full value, 0.3 = only 30% of theoretical value counted
const RISK_MULTIPLIER: Record<SchemeRiskLevel, number> = {
  guaranteed: 1.15,   // Slight bonus — you KNOW these points will land
  reliable: 1.0,      // Full value — these actions happen every match
  moderate: 0.7,      // Discounted — depends on win/loss
  risky: 0.4,         // Heavy discount — specific events may not trigger
  high_risk: 0.2,     // Severe discount — could score 0 total points
};

/**
 * Classify a scheme card's risk level based on its description.
 * The scheme card is the one strategic lever — we want to maximize controllable outcomes.
 */
export function classifySchemeRisk(name: string, description: string): SchemeRiskLevel {
  const d = description.toLowerCase();
  const n = name.toLowerCase();

  // GUARANTEED — Trait-based and rarity-based (points from lineup composition)
  // These give points just for having the right cards. Zero RNG.
  if (
    d.includes("for each") && (
      d.includes("trait") || d.includes("fur") || d.includes("eye") ||
      d.includes("mouth") || d.includes("mask") || d.includes("overalls") ||
      d.includes("kimono") || d.includes("apron") || d.includes("onesie") ||
      d.includes("head") || d.includes("1 of 1") || d.includes("tongue")
    )
  ) return "guaranteed";
  if (d.includes("unique card rarity")) return "guaranteed";

  // RELIABLE — Common match actions (kills, balls, wart riding)
  // These happen every match, just the volume varies.
  if (d.includes("1.5x") && d.includes("elimination")) return "reliable"; // Aggressive Specialization
  if (d.includes("1.3x") && d.includes("gacha ball")) return "reliable"; // Collective Specialization
  if (d.includes("per moki elimination") || d.includes("per elimination")) return "reliable";
  if (d.includes("per gacha ball delivered") || d.includes("per gacha ball")) return "reliable";
  if (d.includes("every second") && d.includes("riding wart")) return "reliable"; // Wart Rodeo
  // Combo action schemes (kills + balls together)
  if (n === "cage match" || n === "gacha gouging") return "reliable";

  // MODERATE — Win/loss dependent (~50/50 chance)
  if (n === "victory lap" || (d.includes("winning team") && !d.includes("when"))) return "moderate";
  if (n === "taking a dive" || d.includes("losing team")) return "moderate";
  if (n === "touching the wart" && d.includes("closer")) return "moderate";

  // RISKY — Specific win conditions or uncommon events
  if (d.includes("when team wins by")) return "risky"; // Baiting the Trap, Grabbing Balls, Moki Smash
  if (d.includes("when winning") || d.includes("when achieving")) return "risky"; // Beat the Buzzer, Final Blow
  if (d.includes("picking up a loose")) return "risky"; // Litter Collection, Running Interference
  if (d.includes("eaten by wart") || n === "saccing") return "risky";
  if (d.includes("eat a moki") || n === "cursed dinner") return "risky";
  if (d.includes("every second") && d.includes("buff") && !d.includes("wart")) return "risky"; // Flexing

  // HIGH_RISK — All-or-nothing gambles
  if (d.includes("double total points") && d.includes("0 total points")) return "high_risk";
  if (n === "enforcing the naughty list" || n === "gacha hoarding") return "high_risk";

  // Default: moderate risk for unrecognized schemes
  return "moderate";
}

/**
 * Get the risk-adjusted multiplier for a scheme, optionally overridden by empirical data.
 * If empirical data shows a "risky" scheme consistently winning, reduce the penalty.
 */
export function getSchemeRiskMultiplier(
  riskLevel: SchemeRiskLevel,
  empiricalOverride?: { winRate: number; appearances: number; confidence: number } | null
): number {
  const baseMultiplier = RISK_MULTIPLIER[riskLevel];

  // If we have strong empirical data showing this scheme works, override the penalty
  if (empiricalOverride && empiricalOverride.confidence >= 0.5 && empiricalOverride.appearances >= 5) {
    // If the scheme's empirical win rate is above average (>50%), boost it
    // Scale: 50% win rate = no change, 70% = significant boost, 90% = near full value
    if (empiricalOverride.winRate > 0.5) {
      const empiricalBoost = Math.min(1.15, baseMultiplier + (empiricalOverride.winRate - 0.5) * 1.5);
      return Math.max(baseMultiplier, empiricalBoost);
    }
    // If empirical data confirms the scheme underperforms, keep or increase penalty
    if (empiricalOverride.winRate < 0.3) {
      return Math.min(baseMultiplier, baseMultiplier * 0.8);
    }
  }

  return baseMultiplier;
}

// ─── Champion Scoring ──────────────────────────────────────────────

/**
 * Score a champion for a given scheme.
 * 
 * Priority order (per Larry's specification):
 * 1. Avg score (real match data — primary signal)
 * 2. Win rate (tiebreaker)
 * 3. Other stats (kills, balls, wart — secondary tiebreakers)
 * 
 * Rarity is NOT a ranking factor. It is only used for ownership checks
 * in the Legendary Advisor feature.
 */
export function scoreChampion(
  champion: ChampionCard,
  scheme: SchemeCardData | null,
  allChampionsInLineup?: ChampionCard[]
): number {
  // Primary signal: real average score from match history
  // Fall back to formula estimate if no real data available
  let baseScore: number;
  
  if (champion.avgScore && champion.avgScore > 0) {
    // Use real average score as primary signal
    baseScore = champion.avgScore;
  } else {
    // Fallback: estimate from raw stats using official Season 1 formula
    // Official Season 1 scoring: kills*80 + balls*50 + wart*0.5625 + win*300
    const killScore = (champion.avgKills ?? 2) * 80;
    const ballScore = (champion.avgBalls ?? 1) * 50;
    const wartScore = (champion.avgWartDistance ?? 50) * 0.5625;
    const winBonus = (champion.winRate ?? 0.3) * 300;
    baseScore = killScore + ballScore + wartScore + winBonus;
  }

  // Tiebreaker 1: win rate adds a small fractional boost (won't override score differences)
  // Scale: 1% win rate difference = 0.5 point difference in score
  const winRateBoost = (champion.winRate ?? 0.3) * 0.5;
  baseScore += winRateBoost;

  // Tiebreaker 2: kills/balls/wart add micro-boosts (won't override win rate differences)
  const killBoost = (champion.avgKills ?? 0) * 0.01;
  const ballBoost = (champion.avgBalls ?? 0) * 0.005;
  baseScore += killBoost + ballBoost;

  // Scheme bonus: adds points for champions that align with the scheme's scoring category
  if (scheme) {
    const qualifies = !scheme.hasTraitFilter || 
      scheme.qualifyingChampionIds.includes(champion.championTokenId ?? "");
    
    if (qualifies) {
      const cat = scheme.category;
      switch (cat) {
        case "kills":
          // Kills-focused schemes: boost kill-heavy champions
          baseScore += (champion.avgKills ?? 2) * 80 * 0.5;
          break;
        case "balls":
          baseScore += (champion.avgBalls ?? 1) * 50 * 0.5;
          break;
        case "wart":
          baseScore += (champion.avgWartDistance ?? 50) * 0.5625 * 0.5;
          break;
        case "win":
          baseScore += (champion.winRate ?? 0.3) * 300 * 0.5;
          break;
        case "trait":
          // Trait schemes give flat bonus per qualifying champion
          baseScore += 25;
          break;
        case "combo":
          baseScore += (champion.avgKills ?? 2) * 35 + (champion.avgBalls ?? 1) * 10;
          break;
        default:
          baseScore += 15;
      }
    }
  }

  return Math.round(baseScore * 100) / 100;
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

  // Process from highest rarity first so the best champions get name priority
  const pickOrder = ["Legendary", "Epic", "Rare", "Basic"];
  const lineup: LineupSlot[] = [];
  const usedNames = new Set<string>();

  for (const r of pickOrder) {
    const scored = byRarity[r]
      .map((c) => ({ champion: c, score: scoreChampion(c, scheme) }))
      .sort((a, b) => b.score - a.score);
    
    // Find the best champion from this rarity that isn't a duplicate name
    let picked = false;
    for (const slot of scored) {
      const champName = slot.champion.name.toLowerCase();
      if (!usedNames.has(champName)) {
        usedNames.add(champName);
        lineup.push(slot);
        picked = true;
        break;
      }
    }
    if (!picked) return null; // Can't fill this rarity without duplicating a name
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

  // Greedy pick: take top-scored cards but enforce champion name uniqueness
  // (no two cards with the same champion name, even at different rarities)
  const lineup: LineupSlot[] = [];
  const usedNames = new Set<string>();

  for (const candidate of candidates) {
    const champName = candidate.champion.name.toLowerCase();
    if (usedNames.has(champName)) continue; // Skip duplicate champion
    usedNames.add(champName);
    lineup.push(candidate);
    if (lineup.length === 4) break;
  }

  if (lineup.length < 4) return null;

  return lineup;
}

// ─── Scheme Selection ──────────────────────────────────────────────

/**
 * Auto-select the best scheme card for a given lineup.
 * Applies risk-adjusted scoring: reliable/guaranteed schemes get full or boosted value,
 * risky schemes get penalized unless empirical data shows they consistently win.
 */
export function selectBestScheme(
  champions: ChampionCard[],
  availableSchemes: SchemeCardData[],
  schemeEmpirical?: Map<string, { winRate: number; appearances: number; confidence: number }>
): SchemeCardData | null {
  if (availableSchemes.length === 0) return null;

  let bestScheme: SchemeCardData | null = null;
  let bestScore = -Infinity;

  for (const scheme of availableSchemes) {
    // Calculate raw scheme score from champion contributions
    let rawScore = 0;
    for (const champ of champions) {
      rawScore += scoreChampion(champ, scheme, champions);
    }

    // Apply risk-adjusted multiplier
    const empiricalData = schemeEmpirical?.get(scheme.name.toLowerCase());
    const riskMultiplier = getSchemeRiskMultiplier(
      scheme.riskLevel,
      empiricalData ?? null
    );
    const adjustedScore = rawScore * riskMultiplier;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
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
  performanceStats?: Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; avgScore?: number; totalMatches?: number }>;
  schemeEmpirical?: Map<string, { winRate: number; appearances: number; confidence: number }>;
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
    schemeEmpirical,
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
      // Real avg score from match history — primary ranking signal (no rarity multiplier)
      avgScore: stats?.avgScore ?? m.avgScore,
      totalMatches: stats?.totalMatches ?? m.totalMatches,
    };
  });

  // Filter by rarity restriction
  const eligible = filterByRarity(enrichedMokis, contestRules.rarityRestriction);

  if (eligible.length < 4) {
    warnings.push(
      `Only ${eligible.length} eligible champions found (need 4). Consider purchasing more cards.`
    );
  }

  // Calculate max entries (only limited by contest rules, not gem budget)
  const actualEntries = Math.min(
    numEntries,
    contestRules.maxEntriesPerUser
  );

  if (actualEntries < numEntries) {
    if (contestRules.maxEntriesPerUser < numEntries) {
      warnings.push(
        `Contest allows max ${contestRules.maxEntriesPerUser} entries per user.`
      );
    }
  }

  // Informational warning about gem cost (does not limit lineup generation)
  const totalCost = actualEntries * entryFee;
  if (entryFee > 0 && totalCost > dailyBudget) {
    warnings.push(
      `Total cost ${totalCost.toLocaleString()} gems exceeds remaining budget of ${dailyBudget.toLocaleString()} gems. Lineups built anyway.`
    );
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
      availableSchemeData.length > 0 ? availableSchemeData : allSchemes,
      schemeEmpirical
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
      imageUrl: c.imageUrl ?? null,
    }));
}
