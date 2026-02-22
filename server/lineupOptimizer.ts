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
 * Score a champion for a given scheme, considering rarity multiplier and performance stats.
 * 
 * When a Scheme is provided, scoring is SCHEME-DOMINANT: the Scheme's preferred actions
 * are weighted heavily so that MOKIs who excel at those actions rank highest.
 * A small base score (win rate + general versatility) acts as a tiebreaker.
 * 
 * When no Scheme is provided, scoring uses balanced V4 weights across all actions.
 */
export function scoreChampion(
  champion: ChampionCard,
  scheme: SchemeCardData | null,
  allChampionsInLineup?: ChampionCard[]
): number {
  const multiplier = RARITY_MULTIPLIER[champion.rarity] ?? 1.0;

  const avgKills = champion.avgKills ?? 2;
  const avgBalls = champion.avgBalls ?? 1;
  const avgWart = champion.avgWartDistance ?? 50;
  const winRate = champion.winRate ?? 0.3;

  // No scheme: balanced V4 scoring (original behavior)
  if (!scheme) {
    const killScore = avgKills * 85 * multiplier;
    const ballScore = avgBalls * 40 * multiplier;
    const wartScore = avgWart * 0.5 * multiplier;
    const winBonus = winRate * 200 * multiplier;
    return Math.round(killScore + ballScore + wartScore + winBonus);
  }

  // With scheme: SCHEME-DOMINANT scoring
  // Small tiebreaker from win rate and general versatility
  const tiebreaker = (winRate * 100 + avgKills * 5 + avgBalls * 3 + avgWart * 0.05) * multiplier;

  const qualifies = !scheme.hasTraitFilter ||
    scheme.qualifyingChampionIds.includes(champion.championTokenId ?? "");

  // Non-qualifying champions for trait schemes get only the tiebreaker
  if (!qualifies) {
    return Math.round(tiebreaker);
  }

  const cat = scheme.category;
  let schemeScore = 0;

  switch (cat) {
    case "kills":
      // Kill schemes: kills are the dominant scoring factor
      // V4: each kill = 85 base pts, scheme multiplies this
      schemeScore = avgKills * 200 * multiplier;
      break;
    case "balls":
      // Ball schemes: ball deliveries are the dominant scoring factor
      // V4: each ball = 40 base pts, scheme multiplies this
      schemeScore = avgBalls * 150 * multiplier;
      break;
    case "wart":
      // Wart schemes: wart distance is the dominant scoring factor
      schemeScore = avgWart * 2.0 * multiplier;
      break;
    case "win":
      // Win schemes: win rate is the dominant scoring factor
      schemeScore = winRate * 500 * multiplier;
      break;
    case "trait":
      // Trait schemes: flat bonus per qualifying champion (guaranteed points)
      // Big bonus to ensure qualifying MOKIs are strongly preferred
      schemeScore = 250 * multiplier;
      break;
    case "combo":
      // Combo schemes (e.g., Cage Match: +35/kill, +10/ball)
      // Kills are weighted 3.5x more than balls per the scheme's own point values
      // Use aggressive kill weighting so killers clearly outrank pure ball carriers
      schemeScore = (avgKills * 250 + avgBalls * 25) * multiplier;
      break;
    case "rarity":
      // Rarity schemes: bonus for diverse rarities (handled at lineup level)
      schemeScore = 50 * multiplier;
      break;
    case "conditional":
      // Conditional schemes: moderate bonus, depends on game events
      schemeScore = (avgKills * 80 + avgBalls * 30 + avgWart * 0.3) * multiplier;
      break;
    default:
      schemeScore = (avgKills * 80 + avgBalls * 30 + avgWart * 0.3) * multiplier;
      break;
  }

  return Math.round(schemeScore + tiebreaker);
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
  performanceStats?: Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number }>;
  schemeEmpirical?: Map<string, { winRate: number; appearances: number; confidence: number }>;
}

/**
 * Build optimal lineups for a contest.
 * 
 * Co-optimization strategy:
 * For each entry, try EVERY available Scheme card, build the best 4-MOKI lineup
 * specifically optimized for that Scheme's scoring, then pick the Scheme+MOKI combo
 * with the highest risk-adjusted total score.
 * 
 * This ensures kill-focused Schemes get kill-heavy MOKIs, ball-focused Schemes get
 * ball carriers, etc. — rather than picking MOKIs first and then finding a Scheme.
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
    // Determine which schemes to evaluate
    const availableOwnedSchemes = ownedSchemes.filter(
      (s) => !usedSchemeTokenIds.has(s.tokenId)
    );
    const schemeCandidates = availableOwnedSchemes.length > 0
      ? availableOwnedSchemes
      : allSchemes;

    // Also include a "no scheme" baseline (null) so we can compare
    const schemesToTry: (SchemeCardData | null)[] = [
      null,
      ...schemeCandidates,
    ];

    let bestComboScore = -Infinity;
    let bestComboSlots: LineupSlot[] | null = null;
    let bestComboScheme: SchemeCardData | null = null;

    // Co-optimization: try every Scheme, build the best lineup for each,
    // pick the combo with the highest risk-adjusted total score
    for (const scheme of schemesToTry) {
      // Build the best 4-MOKI lineup specifically for this Scheme
      let slots: LineupSlot[] | null = null;

      if (contestRules.isOneOfEach) {
        slots = buildOneOfEachLineup(eligible, scheme, usedTokenIds);
      } else {
        slots = buildStandardLineup(eligible, scheme, usedTokenIds);
      }

      if (!slots || slots.length < 4) continue;

      // Calculate total score for this Scheme+MOKI combo
      const rawTotal = slots.reduce((sum, s) => sum + s.score, 0);

      // Apply risk-adjusted multiplier for the Scheme
      let adjustedTotal = rawTotal;
      if (scheme) {
        const empiricalData = schemeEmpirical?.get(scheme.name.toLowerCase());
        const riskMultiplier = getSchemeRiskMultiplier(
          scheme.riskLevel,
          empiricalData ?? null
        );
        adjustedTotal = rawTotal * riskMultiplier;
      }

      if (adjustedTotal > bestComboScore) {
        bestComboScore = adjustedTotal;
        bestComboSlots = slots;
        bestComboScheme = scheme;
      }
    }

    if (!bestComboSlots || bestComboSlots.length < 4) {
      warnings.push(`Not enough unique cards for entry #${entry}.`);
      break;
    }

    // Mark cards as used
    for (const slot of bestComboSlots) {
      usedTokenIds.add(slot.champion.tokenId);
    }

    // Mark scheme as used if it's an owned scheme
    if (bestComboScheme && availableOwnedSchemes.find((s) => s.tokenId === bestComboScheme!.tokenId)) {
      usedSchemeTokenIds.add(bestComboScheme.tokenId);
    }

    // Final scores are already computed with the correct Scheme
    const predictedScore = bestComboSlots.reduce((sum, s) => sum + s.score, 0);

    lineups.push({
      champions: bestComboSlots,
      scheme: bestComboScheme,
      schemeTokenId: bestComboScheme?.tokenId ?? null,
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
