/**
 * Champion Stats Service — Performance modeling and scheme-relevance ranking.
 * 
 * Since the GATracker API requires auth tokens, we build our own performance model:
 * 1. Class-level performance averages (scraped from GATracker performance charts)
 * 2. Fur rarity bonuses (higher rarity furs correlate with better performance)
 * 3. Scheme-relevance scoring (which champions are best for each scheme category)
 * 4. V4 scoring model (85 pts/kill, 40 pts/ball, wart distance, +200 win bonus)
 * 
 * Data sources:
 * - game-data.json: 180 champions with attributes (fur, rarity, traits)
 * - GATracker class averages: kills, balls, wart per class (from META charts)
 * - GATracker global leaderboard: top 15 champions with scores
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { championStats } from "../drizzle/schema";
import type { InsertChampionStat } from "../drizzle/schema";

// ─── Class Performance Averages (from GATracker META Performance Charts) ──────
// These are average per-match stats for the top 100 champions in each class.

export const CLASS_PERFORMANCE: Record<string, {
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  winRate: number;
  primaryStat: string;
}> = {
  Bruiser:  { avgKills: 2.2, avgBalls: 0.6, avgWartDistance: 30,  winRate: 0.55, primaryStat: "STR" },
  Center:   { avgKills: 1.5, avgBalls: 1.2, avgWartDistance: 45,  winRate: 0.52, primaryStat: "balanced" },
  Anchor:   { avgKills: 1.2, avgBalls: 0.8, avgWartDistance: 55,  winRate: 0.50, primaryStat: "DEF" },
  Flanker:  { avgKills: 1.15, avgBalls: 1.4, avgWartDistance: 40, winRate: 0.51, primaryStat: "SPD" },
  Forward:  { avgKills: 1.1, avgBalls: 1.5, avgWartDistance: 35,  winRate: 0.50, primaryStat: "FOR" },
  Defender: { avgKills: 1.05, avgBalls: 0.7, avgWartDistance: 60, winRate: 0.53, primaryStat: "DEF" },
  Grinder:  { avgKills: 1.0, avgBalls: 1.3, avgWartDistance: 50,  winRate: 0.51, primaryStat: "FOR" },
  Support:  { avgKills: 0.8, avgBalls: 1.6, avgWartDistance: 45,  winRate: 0.49, primaryStat: "FOR" },
  Sprinter: { avgKills: 0.75, avgBalls: 1.8, avgWartDistance: 65, winRate: 0.52, primaryStat: "SPD" },
  Striker:  { avgKills: 0.3, avgBalls: 0.5, avgWartDistance: 80,  winRate: 0.48, primaryStat: "DEX" },
};

// ─── Fur Rarity Performance Multipliers ──────────────────────────────────────
// Higher rarity furs correlate with better performance (from GATracker leaderboard analysis).
// Top 15 global: 5 Spirit, 3 Shadow, 2 Common, 1 Rainbow, 1 Gold, 1 1of1, 2 unknown

export const FUR_MULTIPLIER: Record<string, number> = {
  "Spirit": 1.15,
  "Shadow": 1.12,
  "Rainbow": 1.10,
  "Gold": 1.08,
  "Heavy Brown": 1.0,
  "Heavy Dark": 1.0,
  "Heavy Grey": 1.0,
  "Heavy Moca": 1.0,
  "Heavy Yellow": 1.0,
  "Light Brown": 1.0,
  "Light Dark": 1.0,
  "Light Grey": 1.0,
  "Light Moca": 1.0,
  "Light Yellow": 1.0,
};

// ─── V4 Scoring Constants ────────────────────────────────────────────────────
const V4_KILL_POINTS = 85;
const V4_BALL_POINTS = 40;
const V4_WART_MULTIPLIER = 0.5; // Approximate per-distance-unit
const V4_WIN_BONUS = 200;

// ─── Card Rarity Multipliers (V4) ───────────────────────────────────────────
const RARITY_MULTIPLIER: Record<string, number> = {
  Basic: 1.0,
  Common: 1.0,
  Rare: 1.25,
  Epic: 1.5,
  Legendary: 1.75,
};

// ─── Scheme Category Scoring Weights ────────────────────────────────────────
// How much each stat matters for each scheme category

export const SCHEME_CATEGORY_WEIGHTS: Record<string, {
  killWeight: number;
  ballWeight: number;
  wartWeight: number;
  winWeight: number;
}> = {
  kills:       { killWeight: 3.0, ballWeight: 0.0, wartWeight: 0.0, winWeight: 0.5 },
  balls:       { killWeight: 0.0, ballWeight: 3.0, wartWeight: 0.0, winWeight: 0.5 },
  wart:        { killWeight: 0.0, ballWeight: 0.0, wartWeight: 3.0, winWeight: 0.5 },
  win:         { killWeight: 0.5, ballWeight: 0.5, wartWeight: 0.5, winWeight: 3.0 },
  combo:       { killWeight: 1.5, ballWeight: 1.5, wartWeight: 0.5, winWeight: 0.5 },
  trait:       { killWeight: 1.0, ballWeight: 1.0, wartWeight: 1.0, winWeight: 1.0 },
  rarity:      { killWeight: 1.0, ballWeight: 1.0, wartWeight: 1.0, winWeight: 1.0 },
  conditional: { killWeight: 1.0, ballWeight: 1.0, wartWeight: 1.0, winWeight: 1.0 },
  loss:        { killWeight: 0.5, ballWeight: 0.5, wartWeight: 0.5, winWeight: 0.0 },
  score:       { killWeight: 1.0, ballWeight: 1.0, wartWeight: 1.0, winWeight: 1.0 },
  other:       { killWeight: 1.0, ballWeight: 1.0, wartWeight: 1.0, winWeight: 1.0 },
};

// ─── Champion Data Interface ────────────────────────────────────────────────

export interface ChampionData {
  name: string;
  championTokenId: string;
  tokenId: string;
  image: string;
  rarity: string;
  fur: string;
  is1of1: boolean;
  traits: Record<string, string[]>;
}

export interface ChampionPerformance {
  championTokenId: string;
  name: string;
  rarity: string;
  fur: string;
  championClass: string; // Inferred from performance model
  // Estimated per-match stats
  estKills: number;
  estBalls: number;
  estWartDistance: number;
  estWinRate: number;
  // V4 scoring predictions
  v4BaseScore: number; // Without rarity multiplier
  v4RarityScore: number; // With rarity multiplier
  // Scheme-specific scores
  schemeScores: Record<string, number>;
  // Overall ranking
  overallRank: number;
  // Fur multiplier applied
  furMultiplier: number;
}

// ─── Class Inference ────────────────────────────────────────────────────────
// GATracker shows class for each champion. Since we don't have class in game-data.json,
// we'll infer it from the global leaderboard data we scraped.

const KNOWN_CHAMPION_CLASSES: Record<string, string> = {
  // From GATracker global leaderboard top 50
  "Shadrel Kagekin": "Striker",
  "I WILL FARM U": "Center",
  "69": "Sprinter",
  "Bio Phantom": "Defender",
  "Peeltergeist": "Defender",
  "Zaris": "Defender",
  "Artist Moki": "Defender",
  "67": "Sprinter",
  "SuperMagus": "Defender",
  "Cammyyy": "Defender",
  "Tea Bone": "Defender",
  "Milo Thatch": "Defender",
  "THANK U 4 PLAYIN": "Sprinter",
  "Fuoco Fatuo": "Defender",
  "Dheu": "Bruiser",
  "Animo": "Striker",
  "BadAss": "Defender",
  // Stat leaders
  "Vagabond": "Center",
  "Arashi": "Grinder",
  "Soda": "Striker",
  "Fishoo": "Bruiser",
};

/**
 * Infer champion class from known data or default to a balanced estimate.
 * In the future, this can be enhanced by scraping GATracker for all 8000+ champions.
 */
function inferClass(name: string): string {
  return KNOWN_CHAMPION_CLASSES[name] ?? "Unknown";
}

// ─── Performance Estimation ─────────────────────────────────────────────────

/**
 * Estimate a champion's per-match performance based on class and fur.
 */
export function estimatePerformance(
  champion: ChampionData,
  championClass?: string
): {
  estKills: number;
  estBalls: number;
  estWartDistance: number;
  estWinRate: number;
  furMultiplier: number;
} {
  const cls = championClass ?? inferClass(champion.name);
  const classPerf = CLASS_PERFORMANCE[cls] ?? CLASS_PERFORMANCE["Defender"]; // Default to Defender (most common in top 15)
  const furMult = FUR_MULTIPLIER[champion.fur] ?? 1.0;

  // 1-of-1 champions get a bonus (they're typically stronger)
  const oneOfOneMult = champion.is1of1 ? 1.05 : 1.0;

  return {
    estKills: Math.round(classPerf.avgKills * furMult * oneOfOneMult * 100) / 100,
    estBalls: Math.round(classPerf.avgBalls * furMult * oneOfOneMult * 100) / 100,
    estWartDistance: Math.round(classPerf.avgWartDistance * furMult * oneOfOneMult * 100) / 100,
    estWinRate: Math.round(classPerf.winRate * furMult * oneOfOneMult * 1000) / 1000,
    furMultiplier: furMult,
  };
}

/**
 * Calculate V4 score prediction for a champion.
 */
export function calculateV4Score(
  estKills: number,
  estBalls: number,
  estWartDistance: number,
  estWinRate: number,
  rarity: string
): { baseScore: number; rarityScore: number } {
  const baseScore =
    estKills * V4_KILL_POINTS +
    estBalls * V4_BALL_POINTS +
    estWartDistance * V4_WART_MULTIPLIER +
    estWinRate * V4_WIN_BONUS;

  const rarityMult = RARITY_MULTIPLIER[rarity] ?? 1.0;
  const rarityScore = baseScore * rarityMult;

  return {
    baseScore: Math.round(baseScore * 100) / 100,
    rarityScore: Math.round(rarityScore * 100) / 100,
  };
}

/**
 * Calculate scheme-specific score for a champion.
 */
export function calculateSchemeScore(
  estKills: number,
  estBalls: number,
  estWartDistance: number,
  estWinRate: number,
  rarity: string,
  schemeCategory: string
): number {
  const weights = SCHEME_CATEGORY_WEIGHTS[schemeCategory] ?? SCHEME_CATEGORY_WEIGHTS["other"];
  const rarityMult = RARITY_MULTIPLIER[rarity] ?? 1.0;

  const score =
    estKills * V4_KILL_POINTS * weights.killWeight +
    estBalls * V4_BALL_POINTS * weights.ballWeight +
    estWartDistance * V4_WART_MULTIPLIER * weights.wartWeight +
    estWinRate * V4_WIN_BONUS * weights.winWeight;

  return Math.round(score * rarityMult * 100) / 100;
}

// ─── Full Champion Ranking ──────────────────────────────────────────────────

/**
 * Build a full performance ranking for all champions.
 */
export function rankAllChampions(
  champions: ChampionData[]
): ChampionPerformance[] {
  const schemeCategories = Object.keys(SCHEME_CATEGORY_WEIGHTS);

  const performances: ChampionPerformance[] = champions.map((champ) => {
    const cls = inferClass(champ.name);
    const perf = estimatePerformance(champ, cls);
    const v4 = calculateV4Score(
      perf.estKills,
      perf.estBalls,
      perf.estWartDistance,
      perf.estWinRate,
      champ.rarity
    );

    const schemeScores: Record<string, number> = {};
    for (const cat of schemeCategories) {
      schemeScores[cat] = calculateSchemeScore(
        perf.estKills,
        perf.estBalls,
        perf.estWartDistance,
        perf.estWinRate,
        champ.rarity,
        cat
      );
    }

    return {
      championTokenId: champ.championTokenId,
      name: champ.name,
      rarity: champ.rarity,
      fur: champ.fur,
      championClass: cls,
      estKills: perf.estKills,
      estBalls: perf.estBalls,
      estWartDistance: perf.estWartDistance,
      estWinRate: perf.estWinRate,
      v4BaseScore: v4.baseScore,
      v4RarityScore: v4.rarityScore,
      schemeScores,
      overallRank: 0, // Will be set after sorting
      furMultiplier: perf.furMultiplier,
    };
  });

  // Sort by V4 rarity score (descending) and assign ranks
  performances.sort((a, b) => b.v4RarityScore - a.v4RarityScore);
  performances.forEach((p, i) => {
    p.overallRank = i + 1;
  });

  return performances;
}

// ─── Parse Game Data ────────────────────────────────────────────────────────

/**
 * Parse champions from game-data.json format into ChampionData.
 */
export function parseGameDataChampions(
  gameData: {
    champions: Array<{
      name: string;
      image: string;
      tokenId: string;
      championTokenId: string;
      attributes: Record<string, string[]>;
      mokiAttributes: Record<string, string[]>;
    }>;
  }
): ChampionData[] {
  return gameData.champions.map((ch) => ({
    name: ch.name,
    championTokenId: ch.championTokenId,
    tokenId: ch.tokenId,
    image: ch.image,
    rarity: ch.attributes?.["Rarity"]?.[0] ?? "Basic",
    fur: ch.mokiAttributes?.["Fur"]?.[0] ?? "Unknown",
    is1of1: (ch.mokiAttributes?.["1 of 1"]?.[0] ?? "").toLowerCase() === "true" ||
            ch.mokiAttributes?.["1 of 1"]?.length > 0,
    traits: ch.mokiAttributes,
  }));
}

// ─── Database Persistence ───────────────────────────────────────────────────

/**
 * Save champion performance stats to the database.
 */
export async function saveChampionStats(
  performances: ChampionPerformance[],
  period: string = "season"
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let saved = 0;
  for (const perf of performances) {
    const values: InsertChampionStat = {
      championTokenId: perf.championTokenId,
      name: perf.name,
      championClass: perf.championClass,
      fur: perf.fur,
      winRate: String(perf.estWinRate),
      avgKills: String(perf.estKills),
      avgBalls: String(perf.estBalls),
      avgWartDistance: String(perf.estWartDistance),
      totalScore: Math.round(perf.v4RarityScore),
      globalRank: perf.overallRank,
      statPeriod: period,
      lastUpdatedAt: new Date(),
    };

    await db
      .insert(championStats)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          name: perf.name,
          championClass: perf.championClass,
          fur: perf.fur,
          winRate: String(perf.estWinRate),
          avgKills: String(perf.estKills),
          avgBalls: String(perf.estBalls),
          avgWartDistance: String(perf.estWartDistance),
          totalScore: Math.round(perf.v4RarityScore),
          globalRank: perf.overallRank,
          lastUpdatedAt: new Date(),
        },
      });
    saved++;
  }

  return saved;
}

/**
 * Get the best champions for a specific scheme category.
 */
export function getBestChampionsForScheme(
  performances: ChampionPerformance[],
  schemeCategory: string,
  limit: number = 20
): ChampionPerformance[] {
  return [...performances]
    .sort((a, b) => (b.schemeScores[schemeCategory] ?? 0) - (a.schemeScores[schemeCategory] ?? 0))
    .slice(0, limit);
}

/**
 * Get champions filtered by rarity.
 */
export function filterByRarity(
  performances: ChampionPerformance[],
  rarity: string
): ChampionPerformance[] {
  if (rarity === "ALL") return performances;
  return performances.filter((p) => p.rarity === rarity);
}

/**
 * Get champions filtered by class.
 */
export function filterByClass(
  performances: ChampionPerformance[],
  championClass: string
): ChampionPerformance[] {
  if (championClass === "ALL") return performances;
  return performances.filter((p) => p.championClass === championClass);
}
