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

export type ContestType = "topPercent" | "winnerTakeAll" | "standard";

export interface ContestRules {
  rarityRestriction: string; // OPEN, COMMON_ONLY, RARE_ONLY, etc.
  isOneOfEach: boolean;
  isStarCap: boolean;
  maxEntriesPerUser: number;
  format: string;
  contestType?: ContestType; // Determines variance strategy: topPercent favors consistency
  isShortMatch?: boolean; // Half Day contests = 10 matches per MOKI (less RNG samples)
}

export interface LineupSlot {
  champion: ChampionCard;
  score: number; // Predicted contribution score
}

export interface BuyRecommendation {
  championName: string;
  championTokenId: string;
  reason: string; // e.g. "Buy this Gold Fur MOKI to complete your Golden Shower lineup"
  suggestedRarity: string; // Highest rarity recommended
}

export interface OptimizedLineup {
  champions: LineupSlot[];
  scheme: SchemeCardData | null;
  schemeTokenId: string | null;
  predictedScore: number;
  entryNumber: number;
  usesOwnedCards: boolean;
  missingCards: ChampionCard[]; // Cards needed but not owned (for purchase recs)
  buyRecommendation?: BuyRecommendation; // Suggested 4th champion to buy for trait schemes
  isPartialTraitLineup?: boolean; // True if only 3 qualifiers available
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

/**
 * Detect whether a contest name indicates a short-match format (Half-Day, One-Round, etc.).
 * Short-match contests have fewer matches per MOKI, so performance schemes suffer from RNG variance.
 * Handles: "Half Day", "Half-Day", "Halfday", "One-Round", "One Round", etc.
 */
export function isShortMatchContest(contestName: string): boolean {
  const lower = contestName.toLowerCase();
  return /half[\s-]*day/i.test(lower) || /one[- ]?round/i.test(lower);
}

export function categorizeScheme(description: string, hasTraitFilter?: boolean): SchemeCategory {
  const d = description.toLowerCase();

  // Trait schemes: identified by hasTraitFilter flag OR description keywords.
  // The hasTraitFilter flag from game data is the most reliable indicator.
  // Description patterns: "+25 points for EACH [trait] in lineup"
  if (hasTraitFilter) return "trait";
  if (
    d.includes("trait") || d.includes("fur") || d.includes("1 of 1") ||
    (d.includes("+25 points for each") && d.includes("in lineup"))
  ) return "trait";

  // Performance schemes: categorized by dominant action
  if (d.includes("elimination") && !d.includes("ball") && !d.includes("wart")) return "kills";
  if (d.includes("gacha ball") && !d.includes("elimination") && !d.includes("wart")) return "balls";
  if (d.includes("wart") && !d.includes("elimination") && !d.includes("ball")) return "wart";
  if (d.includes("win") && !d.includes("elimination") && !d.includes("ball")) return "win";
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
  guaranteed: 1.5,    // Strong bonus — trait schemes dominate leaderboards across all contest types
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
 * Get the risk-adjusted multiplier for a scheme, optionally overriding with empirical data.
 * 
 * Contest type affects variance strategy:
 * - topPercent (Top 20%, Top 10%): You need to beat X% of players — consistency wins.
 *   Trait schemes (guaranteed points) get a significant bonus. High-variance schemes get penalized.
 * - winnerTakeAll: You need the highest score — high ceiling is rewarded.
 *   Performance schemes get full value. Trait schemes get no extra bonus.
 * - standard: No adjustment.
 */
export function getSchemeRiskMultiplier(
  riskLevel: SchemeRiskLevel,
  empiricalOverride?: { winRate: number; appearances: number; confidence: number } | null,
  contestType?: ContestType,
  schemeCategory?: SchemeCategory,
  isShortMatch?: boolean,
  rarityRestriction?: string
): number {
  const baseMultiplier = RISK_MULTIPLIER[riskLevel];

  // If we have strong empirical data showing this scheme works, override the penalty
  if (empiricalOverride && empiricalOverride.confidence >= 0.5 && empiricalOverride.appearances >= 5) {
    if (empiricalOverride.winRate > 0.5) {
      const empiricalBoost = Math.min(1.5, baseMultiplier + (empiricalOverride.winRate - 0.5) * 1.5);
      return Math.max(baseMultiplier, empiricalBoost);
    }
    if (empiricalOverride.winRate < 0.3) {
      return Math.min(baseMultiplier, baseMultiplier * 0.8);
    }
  }

  // ─── Trait Scheme Dominance ────────────────────────────────────────────
  // Empirical observation: trait schemes (Divine Intervention, Midnight Strike,
  // Golden Shower, Rainbow Riot) dominate top-10 leaderboards across ALL contest types.
  // This is because:
  // 1. Guaranteed points with zero variance
  // 2. Short-match contests (Half Day = 10 matches) don't give enough RNG chances
  //    for performance schemes to average out
  // 3. Trait bonus stacks linearly with qualifying MOKIs (4 × 25 × matches)
  //
  // Trait schemes get a universal boost across all contest types.
  if (schemeCategory === "trait") {
    if (contestType === "topPercent") {
      // Top-percent: consistency is king, trait schemes are dominant
      return Math.max(baseMultiplier, 2.2);
    }
    // All other contest types: trait schemes still dominate leaderboards
    return Math.max(baseMultiplier, 1.8);
  }

  // ─── Rarity Scheme Penalty in Single-Rarity Contests ───────────────
  // Collect 'Em All and similar rarity-diversity schemes score +35 per UNIQUE rarity.
  // In single-rarity contests (Epic Only, Legendary Only), all 4 MOKIs are the same
  // rarity → only 1 unique rarity → only +35 total instead of +140.
  // These schemes are nearly worthless in single-rarity contests.
  if (schemeCategory === "rarity" && rarityRestriction) {
    const singleRarityContests = [
      "EPIC_ONLY", "LEGENDARY_ONLY", "RARE_ONLY", "COMMON_ONLY", "BASIC_ONLY",
      "EPIC", "LEGENDARY", "RARE", "COMMON", "BASIC"
    ];
    const isSingleRarity = singleRarityContests.some(
      (r) => rarityRestriction.toUpperCase().includes(r.replace("_ONLY", ""))
        && !rarityRestriction.toUpperCase().includes("OPEN")
        && !rarityRestriction.toUpperCase().includes("ONE_OF_EACH")
    );
    if (isSingleRarity) {
      // Near-zero multiplier — rarity scheme is almost worthless here
      return 0.15;
    }
  }

  // ─── Short-Match Penalty for Performance Schemes ───────────────────
  // Half Day contests only have 10 matches per MOKI instead of the usual 20+.
  // Performance-based schemes (kills, balls, wart) suffer because there aren't
  // enough matches for RNG to average out. Apply aggressive penalty so trait
  // schemes (guaranteed points) always win in short-match contests.
  if (isShortMatch) {
    if (riskLevel === "reliable") {
      // 55% penalty — kills/balls/wart can't overcome guaranteed trait bonus
      return baseMultiplier * 0.45;
    }
    if (riskLevel === "moderate") {
      return baseMultiplier * 0.35;
    }
    if (riskLevel === "risky" || riskLevel === "high_risk") {
      return baseMultiplier * 0.25;
    }
  }

  // ─── Contest-Type Variance Adjustments ─────────────────────────────────────
  if (contestType === "topPercent") {
    if (riskLevel === "high_risk") {
      return baseMultiplier * 0.5;
    }
    if (riskLevel === "risky") {
      return baseMultiplier * 0.8;
    }
    if (riskLevel === "reliable") {
      return baseMultiplier * 0.9;
    }
  }

  // Winner-take-all: high ceiling rewarded
  if (contestType === "winnerTakeAll") {
    if (riskLevel === "high_risk") {
      return Math.min(baseMultiplier * 1.5, 0.4);
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

  // Base performance score (V4 formula) — always calculated
  const baseScore =
    (avgKills * 85 + avgBalls * 40 + avgWart * 0.5 + winRate * 200) * multiplier;

  // No scheme: return base performance only
  if (!scheme) {
    return Math.round(baseScore);
  }

  // Check trait qualification
  const qualifies = !scheme.hasTraitFilter ||
    scheme.qualifyingChampionIds.includes(champion.championTokenId ?? "");

  const cat = scheme.category;

  // ─── Trait Schemes ───────────────────────────────────────────────
  // Trait schemes give +25 per qualifying MOKI per match, applied at the LINEUP level.
  // The actual trait bonus is calculated in the co-optimization loop (lineup-level).
  // HARD EXCLUSION: Non-qualifying MOKIs return -Infinity so they are NEVER picked.
  // A Golden Shower lineup must only contain Gold Fur champions, etc.
  if (cat === "trait") {
    if (!qualifies) {
      // HARD EXCLUSION — non-qualifying MOKIs must never appear in trait scheme lineups
      return -Infinity;
    }
    // Qualifying MOKIs: base performance only — trait bonus added at lineup level
    return Math.round(baseScore);
  }

  // ─── Performance Schemes ─────────────────────────────────────────
  // Performance schemes replace base scoring with scheme-specific weighting.
  // The scheme changes WHAT actions matter, so we re-weight the stats.

  // Non-qualifying MOKIs for trait-filtered performance schemes (rare but possible)
  // HARD EXCLUSION for any scheme with hasTraitFilter
  if (!qualifies) {
    return -Infinity;
  }

  let schemeScore = 0;

  switch (cat) {
    case "kills":
      // Kill schemes: kills are the dominant scoring factor
      schemeScore = (avgKills * 200 + avgBalls * 10 + avgWart * 0.1 + winRate * 100) * multiplier;
      break;
    case "balls":
      // Ball schemes: ball deliveries are the dominant scoring factor
      schemeScore = (avgBalls * 150 + avgKills * 15 + avgWart * 0.1 + winRate * 100) * multiplier;
      break;
    case "wart":
      // Wart schemes: wart distance is the dominant scoring factor
      schemeScore = (avgWart * 2.0 + avgKills * 15 + avgBalls * 10 + winRate * 100) * multiplier;
      break;
    case "win":
      // Win schemes: win rate is the dominant scoring factor
      schemeScore = (winRate * 500 + avgKills * 30 + avgBalls * 15 + avgWart * 0.2) * multiplier;
      break;
    case "combo":
      // Combo schemes (e.g., Cage Match: +35/kill, +10/ball)
      // Kills weighted 3.5x more than balls per scheme's point values
      schemeScore = (avgKills * 250 + avgBalls * 25 + avgWart * 0.1 + winRate * 80) * multiplier;
      break;
    case "rarity":
      // Rarity schemes: bonus for diverse rarities (handled at lineup level).
      // Collect 'Em All gives +35 per UNIQUE rarity in the lineup, NOT per champion.
      // Do NOT add a per-champion bonus here — the lineup-level bonus is calculated
      // in the co-optimization loop (see "Lineup-level rarity bonus" below).
      schemeScore = baseScore;
      break;
    case "conditional":
      // Conditional schemes: moderate bonus, depends on game events
      schemeScore = (avgKills * 80 + avgBalls * 30 + avgWart * 0.3 + winRate * 150) * multiplier;
      break;
    default:
      schemeScore = (avgKills * 80 + avgBalls * 30 + avgWart * 0.3 + winRate * 150) * multiplier;
      break;
  }

  return Math.round(schemeScore);
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

  // Pre-filter: for trait schemes with hasTraitFilter, only allow qualifying champions
  let pool = available;
  if (scheme && scheme.hasTraitFilter && scheme.qualifyingChampionIds.length > 0) {
    pool = available.filter((c) =>
      scheme.qualifyingChampionIds.includes(c.championTokenId ?? "")
    );
  }
  for (const c of pool) {
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
interface BuildResult {
  slots: LineupSlot[];
  buyRecommendation?: BuyRecommendation;
  isPartialTraitLineup?: boolean;
}

function buildStandardLineup(
  available: ChampionCard[],
  scheme: SchemeCardData | null,
  usedTokenIds: Set<string>,
  allChampions?: ChampionCard[] // Full 180-champion pool for buy recommendations
): BuildResult | null {
  // Pre-filter: for trait schemes with hasTraitFilter, only allow qualifying champions
  let pool = available.filter((c) => !usedTokenIds.has(c.tokenId));
  let qualifyingPool: ChampionCard[] | null = null;
  if (scheme && scheme.hasTraitFilter && scheme.qualifyingChampionIds.length > 0) {
    qualifyingPool = pool.filter((c) =>
      scheme.qualifyingChampionIds.includes(c.championTokenId ?? "")
    );
    pool = qualifyingPool;
  }
  const candidates = pool
    .map((c) => ({ champion: c, score: scoreChampion(c, scheme) }))
    .filter((c) => c.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  // Greedy pick: take top-scored cards but enforce champion name uniqueness
  const lineup: LineupSlot[] = [];
  const usedNames = new Set<string>();

  for (const candidate of candidates) {
    const champName = candidate.champion.name.toLowerCase();
    if (usedNames.has(champName)) continue;
    usedNames.add(champName);
    lineup.push(candidate);
    if (lineup.length === 4) break;
  }

  if (lineup.length === 4) {
    return { slots: lineup };
  }

  // ─── 3-Qualifier Trait Lineup with Buy Recommendation ─────────────
  // If this is a trait scheme and we have exactly 3 qualifying champions,
  // recommend the best 4th champion to buy from the full pool.
  if (scheme && scheme.hasTraitFilter && lineup.length === 3 && allChampions) {
    // Find qualifying champion names from the full 180-champion pool that we don't own
    const ownedNames = new Set(available.map((c) => c.name.toLowerCase()));
    const missingQualifiers = allChampions
      .filter((c) =>
        scheme.qualifyingChampionIds.includes(c.championTokenId ?? "") &&
        !ownedNames.has(c.name.toLowerCase()) &&
        !usedNames.has(c.name.toLowerCase())
      )
      .map((c) => ({ champion: c, score: scoreChampion(c, scheme) }))
      .sort((a, b) => b.score - a.score);

    if (missingQualifiers.length > 0) {
      const best = missingQualifiers[0];
      const traitName = scheme.name; // e.g. "Golden Shower"
      return {
        slots: lineup,
        isPartialTraitLineup: true,
        buyRecommendation: {
          championName: best.champion.name,
          championTokenId: best.champion.championTokenId ?? "",
          reason: `Buy ${best.champion.name} to complete your ${traitName} lineup (4th qualifying MOKI)`,
          suggestedRarity: "Legendary", // Always suggest highest rarity
        },
      };
    }
  }

  // Not enough champions and no buy recommendation possible
  if (lineup.length < 4) return null;

  return { slots: lineup };
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
  ownedMokis: ChampionCard[];  // Cards Larry physically owns (used for lockup tracking only)
  allMokis: ChampionCard[];    // Full 180-champion pool to pick from (best lineup, not just owned)
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
    allMokis,
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

   // Apply performance stats to ALL champions (the full 180-champion pool)
  const enrichedMokis: ChampionCard[] = allMokis.map((m) => {
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
    let bestBuyRec: BuyRecommendation | undefined;
    let bestIsPartial = false;

    // Co-optimization: try every Scheme, build the best lineup for each,
    // pick the combo with the highest risk-adjusted total score
    for (const scheme of schemesToTry) {
      // Build the best 4-MOKI lineup specifically for this Scheme
      let slots: LineupSlot[] | null = null;
      let buildBuyRec: BuyRecommendation | undefined;
      let buildIsPartial = false;

      if (contestRules.isOneOfEach) {
        slots = buildOneOfEachLineup(eligible, scheme, usedTokenIds);
      } else {
        const result = buildStandardLineup(eligible, scheme, usedTokenIds, enrichedMokis);
        if (result) {
          slots = result.slots;
          buildBuyRec = result.buyRecommendation;
          buildIsPartial = result.isPartialTraitLineup ?? false;
        }
      }

      // For partial trait lineups (3 qualifiers), still evaluate them
      // but with a reduced score to prefer full 4-qualifier lineups
      if (!slots || (slots.length < 3)) continue;
      if (slots.length < 4 && !buildIsPartial) continue;

      // Calculate total score for this Scheme+MOKI combo
      let rawTotal = slots.reduce((sum, s) => sum + s.score, 0);

      // ─── Lineup-level trait bonus ───────────────────────────────
      // Trait schemes give +25 per qualifying MOKI per match, applied to the WHOLE lineup.
      // With 4 qualifying MOKIs: 4 × 25 × 5 matches = 500 bonus points.
      // This is a team synergy bonus that makes full-trait lineups very powerful.
      // We add this at the lineup level because it depends on how many qualifiers are selected.
      if (scheme && scheme.category === "trait" && scheme.hasTraitFilter) {
        const qualifyingCount = slots.filter((s) =>
          scheme.qualifyingChampionIds.includes(s.champion.championTokenId ?? "")
        ).length;
        // +25 per qualifying MOKI per match × 5 matches
        // This is guaranteed (no variance) so it's extremely valuable
        const traitTeamBonus = qualifyingCount * 25 * 5;
        rawTotal += traitTeamBonus;
      }
      // ─── Lineup-level rarity bonus ────────────────────────────────
      // Collect 'Em All: +35 per EACH unique card rarity in the lineup.
      // e.g. 4 Epics = 1 unique rarity = +35 total (not +140).
      //      1 Basic + 1 Rare + 1 Epic + 1 Legendary = 4 unique rarities = +140 total.
      // Applied at lineup level because it depends on the full set of 4 champions.
      if (scheme && scheme.category === "rarity") {
        const uniqueRarities = new Set(
          slots.map((s) => {
            const r = s.champion.rarity;
            return r === "Common" ? "Basic" : r; // normalize Common → Basic
          })
        ).size;
        // +35 per unique rarity per match × 5 matches = up to 700 bonus points
        const rarityTeamBonus = uniqueRarities * 35 * 5;
        rawTotal += rarityTeamBonus;
      }

      // Apply risk-adjusted multiplier for the Scheme
      let adjustedTotal = rawTotal;
      if (scheme) {
        const empiricalData = schemeEmpirical?.get(scheme.name.toLowerCase());
        const riskMultiplier = getSchemeRiskMultiplier(
          scheme.riskLevel,
          empiricalData ?? null,
          contestRules.contestType,
          scheme.category,
          contestRules.isShortMatch,
          contestRules.rarityRestriction
        );
        adjustedTotal = rawTotal * riskMultiplier;
      }

      // Partial trait lineups (3 qualifiers) get a 20% score reduction
      // to prefer full 4-qualifier lineups, but still rank above most non-trait options
      if (buildIsPartial) {
        adjustedTotal *= 0.8;
      }

      if (adjustedTotal > bestComboScore) {
        bestComboScore = adjustedTotal;
        bestComboSlots = slots;
        bestComboScheme = scheme;
        bestBuyRec = buildBuyRec;
        bestIsPartial = buildIsPartial;
      }
    }

    if (!bestComboSlots || (bestComboSlots.length < 3)) {
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
      buyRecommendation: bestBuyRec,
      isPartialTraitLineup: bestIsPartial,
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
