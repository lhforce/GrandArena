/**
 * Lineup Optimizer Engine — Builds optimal lineups for Grand Arena contests.
 *
 * ══════════════════════════════════════════════════════════════════
 * 6-STEP PIPELINE (executed in strict order for every optimization)
 * ══════════════════════════════════════════════════════════════════
 *
 * Step 1 — Contest format detection
 *   Detect Half-Day vs Full-Day. Half-Day contests ONLY use trait-based schemes
 *   because there are too few matches for performance schemes to average out.
 *
 * Step 2 — Parse contest rules
 *   Read rarity restriction (Epic Only, One-of-Each, etc.), star cap, entry limit.
 *
 * Step 3 — Filter MOKI pool by rarity eligibility
 *   Hard-eliminate any champion whose rarity does not satisfy the contest rules.
 *   Epic Only → only Epic MOKIs. 2 Legendary + 2 Epic → only those rarities.
 *
 * Step 4 — Eliminate incompatible scheme cards
 *   Each scheme has hard eligibility requirements:
 *   - Trait schemes: always eligible (guaranteed points).
 *   - Collect 'Em All / rarity schemes: ONLY eligible for One-of-Each contests
 *     (need 4 different rarities to score full +140).
 *   - Performance schemes: eligible in Full-Day only (not Half-Day).
 *   - Win/loss schemes: eligible in Full-Day only.
 *
 * Step 5 — Choose the best scheme from the eligible set
 *   Score each eligible scheme against the filtered MOKI pool.
 *   Trait schemes are always preferred in Half-Day; in Full-Day they compete on score.
 *
 * Step 6 — Rank MOKIs by win% + scheme-matched secondary stats
 *   Primary sort: win rate (highest first).
 *   Secondary sort: the stat that matches the chosen scheme (kills for kill schemes,
 *   balls for ball schemes, wart distance for wart schemes, etc.).
 *
 * Key rules:
 * - Each lineup = 4 champions + 1 scheme card
 * - Cards are locked for contest duration (can't reuse across entries unless duplicates)
 * - One-Of-Each = exactly one card from each rarity (Basic, Rare, Epic, Legendary)
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
  rarityRestriction: string; // OPEN, COMMON_ONLY, RARE_ONLY, EPIC_ONLY, LEGENDARY_ONLY, ONE_OF_EACH, etc.
  isOneOfEach: boolean;
  isStarCap: boolean;
  maxEntriesPerUser: number;
  format: string;
  contestType?: ContestType;
  isShortMatch?: boolean; // Half Day contests = ~10 matches per MOKI
}

export interface LineupSlot {
  champion: ChampionCard;
  score: number; // Predicted contribution score
}

export interface BuyRecommendation {
  championName: string;
  championTokenId: string;
  reason: string;
  suggestedRarity: string;
}

export interface OptimizedLineup {
  champions: LineupSlot[];
  scheme: SchemeCardData | null;
  schemeTokenId: string | null;
  predictedScore: number;
  entryNumber: number;
  usesOwnedCards: boolean;
  missingCards: ChampionCard[];
  buyRecommendation?: BuyRecommendation;
  isPartialTraitLineup?: boolean;
}

export interface OptimizerResult {
  lineups: OptimizedLineup[];
  totalEntries: number;
  gemCost: number;
  warnings: string[];
}

// ─── Rarity Scoring Multipliers ───────────────────────────────────
// These multipliers represent the performance advantage of higher-rarity cards.
// Reduced from original (3.0→2.2, 2.2→1.8, 1.6→1.4) to prevent Legendary cards
// with poor win rates from dominating. A Legendary with 30% win rate should not
// beat a Basic with 80% win rate just due to rarity.
const RARITY_MULTIPLIER: Record<string, number> = {
  Basic: 1.0,
  Common: 1.0,
  Rare: 1.4,
  Epic: 1.8,
  Legendary: 2.2,
};

const RARITY_RANK: Record<string, number> = {
  Basic: 0,
  Common: 0,
  Rare: 1,
  Epic: 2,
  Legendary: 3,
};

// ─── Confidence Scoring ───────────────────────────────────────────
// MOKIs with more match history are more reliable.
// Used to penalize unproven MOKIs in topPercent contests.
function getConfidenceScore(matchCount: number): number {
  if (matchCount < 5) return 0.5;   // Very unreliable
  if (matchCount < 20) return 0.7;  // Somewhat reliable
  return 0.9;                        // Highly reliable
}

// ─── Contest-Type Score Adjustment ────────────────────────────────
// Different contest types reward different champion profiles.
function getContestTypeMultiplier(
  champion: ChampionCard,
  contestType: string
): number {
  if (contestType === "topPercent") {
    // Top% contests reward consistency.
    // Penalize MOKIs with few matches (unreliable).
    // Note: ChampionCard doesn't have matchCount; we estimate from win rate reliability
    // For now, assume all MOKIs are reasonably tested (confidence = 0.8)
    const confidence = 0.8;
    // Apply confidence multiplier: 0.5 + 0.5*confidence
    // High confidence (0.9) → 0.95× (slight boost)
    // Low confidence (0.5) → 0.75× (significant penalty)
    return 0.5 + 0.5 * confidence;
  }
  if (contestType === "winnerTakeAll") {
    // Winner-take-all contests reward high-ceiling MOKIs.
    // Slightly boost MOKIs with high kills/balls (variance is good).
    const avgKills = champion.avgKills ?? 0;
    const avgBalls = champion.avgBalls ?? 0;
    // If this MOKI has high secondary stats, give it a small boost
    if (avgKills > 4 || avgBalls > 3) return 1.05;
  }
  return 1.0; // Default: no adjustment
}

// ─── Step 1: Contest Format Detection ─────────────────────────────

/**
 * Detect whether a contest name indicates a short-match format (Half-Day, One-Round, etc.).
 * Short-match contests have fewer matches per MOKI, so performance schemes suffer from RNG variance.
 * Handles: "Half Day", "Half-Day", "Halfday", "One-Round", "One Round", etc.
 */
export function isShortMatchContest(contestName: string): boolean {
  const lower = contestName.toLowerCase();
  return /half[\s-]*day/i.test(lower) || /one[- ]?round/i.test(lower);
}

// ─── Step 2: Scheme Categorization & Risk ─────────────────────────

export type SchemeRiskLevel = "guaranteed" | "reliable" | "moderate" | "risky" | "high_risk";

export function categorizeScheme(description: string, hasTraitFilter?: boolean): SchemeCategory {
  const d = description.toLowerCase();

  if (hasTraitFilter) return "trait";
  if (
    d.includes("trait") || d.includes("fur") || d.includes("1 of 1") ||
    (d.includes("+25 points for each") && d.includes("in lineup"))
  ) return "trait";

  if (d.includes("elimination") && !d.includes("ball") && !d.includes("wart")) return "kills";
  if (d.includes("gacha ball") && !d.includes("elimination") && !d.includes("wart")) return "balls";
  if (d.includes("wart") && !d.includes("elimination") && !d.includes("ball")) return "wart";
  if (d.includes("win") && !d.includes("elimination") && !d.includes("ball")) return "win";
  if ((d.includes("elimination") && d.includes("ball")) || (d.includes("elimination") && d.includes("wart"))) return "combo";
  if (d.includes("rarity")) return "rarity";
  if (d.includes("when") || d.includes("if")) return "conditional";
  return "other";
}

export function classifySchemeRisk(name: string, description: string): SchemeRiskLevel {
  const d = description.toLowerCase();
  const n = name.toLowerCase();

  if (
    d.includes("for each") && (
      d.includes("trait") || d.includes("fur") || d.includes("eye") ||
      d.includes("mouth") || d.includes("mask") || d.includes("overalls") ||
      d.includes("kimono") || d.includes("apron") || d.includes("onesie") ||
      d.includes("head") || d.includes("1 of 1") || d.includes("tongue")
    )
  ) return "guaranteed";
  if (d.includes("unique card rarity")) return "guaranteed";

  if (d.includes("1.5x") && d.includes("elimination")) return "reliable";
  if (d.includes("1.3x") && d.includes("gacha ball")) return "reliable";
  if (d.includes("per moki elimination") || d.includes("per elimination")) return "reliable";
  if (d.includes("per gacha ball delivered") || d.includes("per gacha ball")) return "reliable";
  if (d.includes("every second") && d.includes("riding wart")) return "reliable";
  if (n === "cage match" || n === "gacha gouging") return "reliable";

  if (n === "victory lap" || (d.includes("winning team") && !d.includes("when"))) return "moderate";
  if (n === "taking a dive" || d.includes("losing team")) return "moderate";
  if (n === "touching the wart" && d.includes("closer")) return "moderate";

  if (d.includes("when team wins by")) return "risky";
  if (d.includes("when winning") || d.includes("when achieving")) return "risky";
  if (d.includes("picking up a loose")) return "risky";
  if (d.includes("eaten by wart") || n === "saccing") return "risky";
  if (d.includes("eat a moki") || n === "cursed dinner") return "risky";
  if (d.includes("every second") && d.includes("buff") && !d.includes("wart")) return "risky";

  if (d.includes("double total points") && d.includes("0 total points")) return "high_risk";
  if (n === "enforcing the naughty list" || n === "gacha hoarding") return "high_risk";

  return "moderate";
}

// ─── Step 4: Scheme Eligibility Rules ─────────────────────────────

/**
 * Determine whether a scheme card is eligible for a given contest.
 *
 * Hard eligibility rules (Step 4 of the pipeline):
 * - Half-Day contests: ONLY trait schemes are eligible.
 *   Performance/combo/win schemes need many matches to average out; Half-Day has ~10.
 * - Rarity schemes (Collect 'Em All): ONLY eligible for One-of-Each contests.
 *   Collect 'Em All scores +35 per UNIQUE rarity. In a single-rarity contest (Epic Only),
 *   all 4 MOKIs are the same rarity → only +35 total. Worthless.
 *   In One-of-Each (1 Basic + 1 Rare + 1 Epic + 1 Legendary) → +140 total. Excellent.
 * - All other schemes: eligible in Full-Day contests.
 */
export function isSchemeEligible(
  scheme: SchemeCardData,
  contestRules: ContestRules
): boolean {
  const isHalfDay = contestRules.isShortMatch ?? false;
  const isOneOfEach = contestRules.isOneOfEach;

  // ── Half-Day: trait schemes ONLY ──────────────────────────────────
  if (isHalfDay) {
    return scheme.category === "trait";
  }

  // ── Rarity schemes: One-of-Each ONLY ─────────────────────────────
  // Collect 'Em All and any scheme scoring per unique rarity needs 4 different rarities.
  // Only One-of-Each contests guarantee all 4 rarities are present.
  if (scheme.category === "rarity") {
    return isOneOfEach;
  }

  // All other schemes are eligible in Full-Day contests
  return true;
}

// ─── Risk Multiplier (used only in Full-Day scheme scoring) ────────

const RISK_MULTIPLIER: Record<SchemeRiskLevel, number> = {
  guaranteed: 1.5,
  reliable: 1.0,
  moderate: 0.7,
  risky: 0.4,
  high_risk: 0.2,
};

/**
 * Get the risk-adjusted multiplier for a scheme.
 * Used in Step 5 to rank eligible schemes against each other.
 * In Half-Day contests this is only called for trait schemes (all guaranteed).
 */
export function getSchemeRiskMultiplier(
  riskLevel: SchemeRiskLevel,
  empiricalOverride?: { winRate: number; appearances: number; confidence: number } | null,
  contestType?: ContestType,
  schemeCategory?: SchemeCategory,
): number {
  const baseMultiplier = RISK_MULTIPLIER[riskLevel];

  // Empirical override: if we have strong data showing this scheme wins, trust it
  if (empiricalOverride && empiricalOverride.confidence >= 0.5 && empiricalOverride.appearances >= 5) {
    if (empiricalOverride.winRate > 0.5) {
      const empiricalBoost = Math.min(1.5, baseMultiplier + (empiricalOverride.winRate - 0.5) * 1.5);
      return Math.max(baseMultiplier, empiricalBoost);
    }
    if (empiricalOverride.winRate < 0.3) {
      return Math.min(baseMultiplier, baseMultiplier * 0.8);
    }
  }

  // Trait schemes get a universal boost — guaranteed points dominate leaderboards
  if (schemeCategory === "trait") {
    if (contestType === "topPercent") return Math.max(baseMultiplier, 2.2);
    return Math.max(baseMultiplier, 1.8);
  }

  // Top-percent: consistency is king — penalize high-variance schemes
  if (contestType === "topPercent") {
    if (riskLevel === "high_risk") return baseMultiplier * 0.5;
    if (riskLevel === "risky") return baseMultiplier * 0.8;
    if (riskLevel === "reliable") return baseMultiplier * 0.9;
  }

  // Winner-take-all: high ceiling rewarded
  if (contestType === "winnerTakeAll") {
    if (riskLevel === "high_risk") return Math.min(baseMultiplier * 1.5, 0.4);
  }

  return baseMultiplier;
}

/// ─── Rarity Deduplication Pre-Filter ───────────────────────────────

/**
 * Deduplicate champions by champion name, keeping only the highest-rarity version.
 *
 * RULE: If a Legendary version of a champion exists in the pool, ALWAYS use it
 * over any other rarity (Epic, Rare, Basic) of the same champion.
 * This applies in OPEN contests and any contest where multiple rarities are eligible.
 *
 * For ONE_OF_EACH contests this function is NOT applied — all rarities are needed.
 *
 * Rarity priority: Legendary > Epic > Rare > Common/Basic
 */
export function deduplicateByHighestRarity(
  champions: ChampionCard[],
  isOneOfEach = false
): ChampionCard[] {
  // One-of-Each contests need all rarities — do not deduplicate
  if (isOneOfEach) return champions;

  const bestByName = new Map<string, ChampionCard>();

  for (const champ of champions) {
    const key = champ.name.toLowerCase();
    const existing = bestByName.get(key);
    if (!existing) {
      bestByName.set(key, champ);
    } else {
      const existingRank = RARITY_RANK[existing.rarity] ?? 0;
      const champRank = RARITY_RANK[champ.rarity] ?? 0;
      if (champRank > existingRank) {
        bestByName.set(key, champ);
      }
    }
  }

  return Array.from(bestByName.values());
}

// ─── Step 3: Rarity Filter ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Filter champions by contest rarity restriction (Step 3).
 * Hard-eliminates any MOKI whose rarity does not satisfy the contest rules.
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
    case "ONE_OF_EACH":
    case "OPEN":
    default:
      return champions;
  }
}

// ─── Step 6: Champion Scoring ──────────────────────────────────────

/**
 * Score a champion for a given scheme.
 *
 * Step 6 of the pipeline: rank MOKIs by win% (primary) + scheme-matched secondary stats.
 *
 * Rebalanced scoring (v2):
 * - Base score: winRate*400 + avgKills*100 + avgBalls*80 + avgWart*0.5
 *   Win rate is heavily weighted (400) but secondary stats matter (100–80).
 * - Scheme boosts are now percentage-based (+40–50%) instead of absolute weights.
 *   This prevents scheme fit from overriding raw champion strength.
 * - Rarity multiplier applied on top (reduced: Legendary 2.2× instead of 3.0×).
 *
 * Hard exclusions:
 * - Trait schemes: non-qualifying MOKIs return -Infinity (never picked).
 * - Any scheme with hasTraitFilter: non-qualifying MOKIs return -Infinity.
 */
export function scoreChampion(
  champion: ChampionCard,
  scheme: SchemeCardData | null,
  allChampionsInLineup?: ChampionCard[],
  contestType?: string
): number {
  const multiplier = RARITY_MULTIPLIER[champion.rarity] ?? 1.0;

  const avgKills = champion.avgKills ?? 2;
  const avgBalls = champion.avgBalls ?? 1;
  const avgWart = champion.avgWartDistance ?? 50;
  const winRate = champion.winRate ?? 0.3;

  // Base score: balanced across all stats
  let baseScore = (winRate * 400 + avgKills * 100 + avgBalls * 80 + avgWart * 0.5) * multiplier;

  // Apply contest-type adjustment
  if (contestType) {
    const contestMultiplier = getContestTypeMultiplier(champion, contestType);
    baseScore *= contestMultiplier;
  }

  // No scheme: return base score
  if (!scheme) {
    return Math.round(baseScore);
  }

  // Check trait qualification
  const qualifies = !scheme.hasTraitFilter ||
    scheme.qualifyingChampionIds.includes(champion.championTokenId ?? "");

  const cat = scheme.category;

  // ── Trait Schemes ─────────────────────────────────────────────────
  // Trait bonus (+25 per qualifying MOKI per match) is added at lineup level.
  // Here we just rank qualifying MOKIs by base score.
  // Non-qualifying MOKIs are hard-excluded.
  if (cat === "trait") {
    if (!qualifies) return -Infinity;
    // Qualifying MOKIs get their base score (no scheme boost for traits).
    // The trait bonus is applied at the LINEUP level, not per-MOKI.
    return Math.round(baseScore);
  }

  // Hard exclusion for trait-filtered schemes
  if (!qualifies) return -Infinity;

  // Scheme-specific scoring: each category uses a formula that rewards the
  // most relevant stats. Win rate provides a floor (consistency), while the
  // scheme-specific stat provides the primary differentiator.
  // Formula: winRate*200 (floor) + schemeSpecificStat * heavyWeight + otherStats * lightWeight
  // This ensures a high-kills MOKI beats a high-balls MOKI in a kills scheme,
  // even if both have the same win rate.
  let schemeScore: number;

  switch (cat) {
    case "kills":
      // Kills scheme: kills are the primary stat, balls/wart secondary
      schemeScore = (winRate * 200 + avgKills * 250 + avgBalls * 20 + avgWart * 0.2) * multiplier;
      break;
    case "balls":
      // Balls scheme: balls are the primary stat, kills secondary
      schemeScore = (winRate * 200 + avgBalls * 250 + avgKills * 20 + avgWart * 0.2) * multiplier;
      break;
    case "wart":
      // Wart scheme: wart distance is primary
      schemeScore = (winRate * 200 + avgWart * 2.5 + avgKills * 30 + avgBalls * 30) * multiplier;
      break;
    case "win":
      // Win scheme: win rate is primary, all other stats secondary
      schemeScore = (winRate * 600 + avgKills * 50 + avgBalls * 40 + avgWart * 0.3) * multiplier;
      break;
    case "combo":
      // Combo (Cage Match): both kills and balls matter equally
      schemeScore = (winRate * 150 + avgKills * 180 + avgBalls * 180 + avgWart * 0.2) * multiplier;
      break;
    case "rarity":
      // Rarity schemes: no scheme-specific boost (handled at lineup level)
      schemeScore = baseScore;
      break;
    case "conditional":
      // Conditional schemes: slight win rate boost (consistency matters)
      schemeScore = (winRate * 500 + avgKills * 80 + avgBalls * 60 + avgWart * 0.4) * multiplier;
      break;
    default:
      schemeScore = baseScore;
      break;
  }

  // Apply contest-type adjustment to scheme score as well
  if (contestType) {
    const contestMultiplier = getContestTypeMultiplier(champion, contestType);
    schemeScore *= contestMultiplier;
  }

  return Math.round(schemeScore);
}

// ─── One-of-Each Lineup Builder ────────────────────────────────────

/**
 * Build a One-of-Each lineup: exactly one champion from each rarity tier.
 * Picks the highest win% champion from each rarity that qualifies for the scheme.
 */
function buildOneOfEachLineup(
  available: ChampionCard[],
  scheme: SchemeCardData | null,
  usedTokenIds: Set<string>,
  contestType?: string
): LineupSlot[] | null {
  const byRarity: Record<string, ChampionCard[]> = {
    Basic: [],
    Rare: [],
    Epic: [],
    Legendary: [],
  };

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

  const rarities = ["Basic", "Rare", "Epic", "Legendary"];
  for (const r of rarities) {
    if (byRarity[r].length === 0) return null;
  }

    const pickOrder = ["Legendary", "Epic", "Rare", "Basic"];
  const lineup: LineupSlot[] = [];
  const usedNames = new Set<string>();
  for (const r of pickOrder) {
    const scored = byRarity[r]
      .map(c => ({ champion: c, score: scoreChampion(c, scheme, undefined, contestType) }))
      .sort((a, b) => b.score - a.score);;

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
    if (!picked) return null;
  }
  return lineup;
}

// ─── Standard Lineup Builder ───────────────────────────────────────

interface BuildResult {
  slots: LineupSlot[];
  buyRecommendation?: BuyRecommendation;
  isPartialTraitLineup?: boolean;
}

/**
 * Build a standard 4-champion lineup.
 * Step 6: rank by win% + scheme-matched secondary stats (via scoreChampion).
 */
function buildStandardLineup(
  available: ChampionCard[],
  scheme: SchemeCardData | null,
  usedTokenIds: Set<string>,
  allChampions?: ChampionCard[],
  contestType?: string
): BuildResult | null {
  let pool = available.filter((c) => !usedTokenIds.has(c.tokenId));

  if (scheme && scheme.hasTraitFilter && scheme.qualifyingChampionIds.length > 0) {
    pool = pool.filter((c) =>
      scheme.qualifyingChampionIds.includes(c.championTokenId ?? "")
    );
  }

  const candidates = pool
    .map(c => ({ champion: c, score: scoreChampion(c, scheme, undefined, contestType) }))
    .filter(c => c.score > -Infinity)
    .sort((a, b) => b.score - a.score);

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

  // 3-qualifier trait lineup with buy recommendation
  if (scheme && scheme.hasTraitFilter && lineup.length === 3 && allChampions) {
    const ownedNames = new Set(available.map((c) => c.name.toLowerCase()));
    const missingQualifiers = allChampions
      .filter((c) =>
        scheme.qualifyingChampionIds.includes(c.championTokenId ?? "") &&
        !ownedNames.has(c.name.toLowerCase()) &&
        !usedNames.has(c.name.toLowerCase())
      )
      .map((c) => ({ champion: c, score: scoreChampion(c, scheme, undefined, contestType) }))
      .sort((a, b) => b.score - a.score);

    if (missingQualifiers.length > 0) {
      const best = missingQualifiers[0];
      return {
        slots: lineup,
        isPartialTraitLineup: true,
        buyRecommendation: {
          championName: best.champion.name,
          championTokenId: best.champion.championTokenId ?? "",
          reason: `Buy ${best.champion.name} to complete your ${scheme.name} lineup`,
          suggestedRarity: "Legendary",
        },
      };
    }
  }
  if (lineup.length < 4) return null;
  return { slots: lineup };
}

// ─── Scheme Selection (Step 5) ─────────────────────────────────────

/**
 * Auto-select the best scheme card for a given lineup from an already-filtered
 * eligible scheme list (Step 4 filtering must happen before calling this).
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
    let rawScore = 0;
    for (const champ of champions) {
      rawScore += scoreChampion(champ, scheme, champions);
    }
    const empiricalData = schemeEmpirical?.get(scheme.name.toLowerCase());
    const riskMultiplier = getSchemeRiskMultiplier(
      scheme.riskLevel,
      empiricalData ?? null,
      undefined,
      scheme.category,
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
  allMokis: ChampionCard[];
  ownedSchemes: SchemeCardData[];
  allSchemes: SchemeCardData[];
  contestRules: ContestRules;
  numEntries: number;
  entryFee: number;
  dailyBudget: number;
  performanceStats?: Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number }>;
  schemeEmpirical?: Map<string, { winRate: number; appearances: number; confidence: number }>;
}

/**
 * Build optimal lineups for a contest using the 6-step pipeline.
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

  // ── Step 6 prep: enrich all champions with performance stats ──────
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

  // ── Step 3: Filter MOKI pool by rarity eligibility ────────────────────
  const rarityFiltered = filterByRarity(enrichedMokis, contestRules.rarityRestriction);

  // ── Legendary Deduplication: keep only the highest-rarity version of each champion ──
  // RULE: If a Legendary version of a champion exists in the pool, ALWAYS use it.
  // This applies in OPEN and single-rarity contests. Skipped for ONE_OF_EACH (needs all rarities).
  const eligible = deduplicateByHighestRarity(rarityFiltered, contestRules.isOneOfEach);

  if (eligible.length < 4) {
    warnings.push(
      `Only ${eligible.length} eligible champions found (need 4). Consider purchasing more cards.`
    );
  }

  // ── Step 4: Filter scheme pool to only eligible schemes ───────────────────────pply hard eligibility rules: Half-Day → trait only; rarity schemes → One-of-Each only.
  const allEligibleSchemes = allSchemes.filter((s) => isSchemeEligible(s, contestRules));
  const ownedEligibleSchemes = ownedSchemes.filter((s) => isSchemeEligible(s, contestRules));

  if (allEligibleSchemes.length === 0) {
    warnings.push("No eligible scheme cards found for this contest type.");
  }

  // Log eliminated schemes for transparency
  const eliminatedSchemes = allSchemes.filter((s) => !isSchemeEligible(s, contestRules));
  if (eliminatedSchemes.length > 0) {
    const names = eliminatedSchemes.map((s) => s.name).join(", ");
    const reason = contestRules.isShortMatch
      ? "Half-Day contest (trait schemes only)"
      : "not compatible with contest rarity rules";
    warnings.push(`Excluded schemes (${reason}): ${names}`);
  }

  const actualEntries = Math.min(numEntries, contestRules.maxEntriesPerUser);
  if (contestRules.maxEntriesPerUser < numEntries) {
    warnings.push(`Contest allows max ${contestRules.maxEntriesPerUser} entries per user.`);
  }

  const totalCost = actualEntries * entryFee;
  if (entryFee > 0 && totalCost > dailyBudget) {
    warnings.push(
      `Total cost ${totalCost.toLocaleString()} gems exceeds remaining budget of ${dailyBudget.toLocaleString()} gems. Lineups built anyway.`
    );
  }

  const usedTokenIds = new Set<string>();
  const usedSchemeTokenIds = new Set<string>();

  for (let entry = 1; entry <= actualEntries; entry++) {
    // Determine which eligible schemes to try for this entry
    const availableOwnedEligible = ownedEligibleSchemes.filter(
      (s) => !usedSchemeTokenIds.has(s.tokenId)
    );
    const schemeCandidates = availableOwnedEligible.length > 0
      ? availableOwnedEligible
      : allEligibleSchemes;

    // Include null baseline (no scheme) for comparison ONLY when no eligible schemes are available.
    // In Half-Day contests, a trait scheme MUST be used (never fall back to null).
    // In Full-Day contests, only include null if no owned eligible schemes exist.
    const includeNullBaseline = schemeCandidates.length === 0;
    const schemesToTry: (SchemeCardData | null)[] = includeNullBaseline
      ? [null, ...schemeCandidates]
      : schemeCandidates;

    let bestComboScore = -Infinity;
    let bestComboSlots: LineupSlot[] | null = null;
    let bestComboScheme: SchemeCardData | null = null;
    let bestBuyRec: BuyRecommendation | undefined;
    let bestIsPartial = false;

    // ── Steps 5 & 6: Co-optimize scheme + MOKI selection ─────────────
    // Try every eligible scheme, build the best MOKI lineup for each,
    // pick the combo with the highest risk-adjusted total score.
    for (const scheme of schemesToTry) {
      let slots: LineupSlot[] | null = null;
      let buildBuyRec: BuyRecommendation | undefined;
      let buildIsPartial = false;

      if (contestRules.isOneOfEach) {
        slots = buildOneOfEachLineup(eligible, scheme, usedTokenIds, contestRules.contestType);
      } else {
        const result = buildStandardLineup(eligible, scheme, usedTokenIds, enrichedMokis, contestRules.contestType);
        if (result) {
          slots = result.slots;
          buildBuyRec = result.buyRecommendation;
          buildIsPartial = result.isPartialTraitLineup ?? false;
        }
      }

      if (!slots || (slots.length < 3)) continue;
      if (slots.length < 4 && !buildIsPartial) continue;

      let rawTotal = slots.reduce((sum, s) => sum + s.score, 0);

      // ── Lineup-level trait bonus ──────────────────────────────────
      // Trait schemes give +25 per qualifying MOKI per match.
      // With 4 qualifying MOKIs: 4 × 25 × 5 matches = 500 bonus points.
      if (scheme && scheme.category === "trait" && scheme.hasTraitFilter) {
        const qualifyingCount = slots.filter((s) =>
          scheme.qualifyingChampionIds.includes(s.champion.championTokenId ?? "")
        ).length;
        const traitTeamBonus = qualifyingCount * 25 * 5;
        rawTotal += traitTeamBonus;
      }

      // ── Lineup-level rarity bonus ─────────────────────────────────
      // Collect 'Em All: +35 per EACH unique card rarity in the lineup.
      // Only reaches full value (+140) in One-of-Each contests (enforced by Step 4).
      if (scheme && scheme.category === "rarity") {
        const uniqueRarities = new Set(
          slots.map((s) => {
            const r = s.champion.rarity;
            return r === "Common" ? "Basic" : r;
          })
        ).size;
        const rarityTeamBonus = uniqueRarities * 35 * 5;
        rawTotal += rarityTeamBonus;
      }

      // Apply risk-adjusted multiplier (Step 5 ranking)
      let adjustedTotal = rawTotal;
      if (scheme) {
        const empiricalData = schemeEmpirical?.get(scheme.name.toLowerCase());
        const riskMultiplier = getSchemeRiskMultiplier(
          scheme.riskLevel,
          empiricalData ?? null,
          contestRules.contestType,
          scheme.category,
        );
        adjustedTotal = rawTotal * riskMultiplier;
      }

      // Partial trait lineups (3 qualifiers) get a 35% score reduction (increased from 20%)
      // Partial lineups are risky (you don't own the 4th card) and should be a last resort
      if (buildIsPartial) {
        adjustedTotal *= 0.65;
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

    if (bestComboScheme && availableOwnedEligible.find((s) => s.tokenId === bestComboScheme!.tokenId)) {
      usedSchemeTokenIds.add(bestComboScheme.tokenId);
    }

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
