/**
 * Stats Router — tRPC procedures for champion performance rankings,
 * scheme-relevance scoring, and stats management.
 */

import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { championStats } from "../drizzle/schema";
import {
  rankAllChampions,
  parseGameDataChampions,
  saveChampionStats,
  getBestChampionsForScheme,
  filterByRarity,
  filterByClass,
  CLASS_PERFORMANCE,
  SCHEME_CATEGORY_WEIGHTS,
  type ChampionPerformance,
} from "./championStats";
import * as fs from "fs";
import * as path from "path";

// Cache the ranked champions in memory (refreshed on demand)
let cachedRankings: ChampionPerformance[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Load game data and compute rankings (with caching).
 */
async function getRankings(forceRefresh = false): Promise<ChampionPerformance[]> {
  const now = Date.now();
  if (!forceRefresh && cachedRankings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRankings;
  }

  // Load game-data.json
  const gameDataPath = path.resolve(
    import.meta.dirname ?? process.cwd(),
    "../client/public/game-data.json"
  );

  let gameData: any;
  try {
    const raw = fs.readFileSync(gameDataPath, "utf-8");
    gameData = JSON.parse(raw);
  } catch (err) {
    console.error("[StatsRouter] Failed to load game-data.json:", err);
    return cachedRankings ?? [];
  }

  const champions = parseGameDataChampions(gameData);
  const rankings = rankAllChampions(champions);

  cachedRankings = rankings;
  cacheTimestamp = now;

  return rankings;
}

export const statsRouter = router({
  /**
   * Get champion performance rankings with filtering and sorting.
   */
  rankings: publicProcedure
    .input(
      z.object({
        sortBy: z.enum(["overall", "kills", "balls", "wart", "winRate", "v4Score"]).default("overall"),
        rarity: z.string().default("ALL"),
        championClass: z.string().default("ALL"),
        schemeCategory: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      let rankings = await getRankings();

      // Filter by rarity
      if (input.rarity !== "ALL") {
        rankings = filterByRarity(rankings, input.rarity);
      }

      // Filter by class
      if (input.championClass !== "ALL") {
        rankings = filterByClass(rankings, input.championClass);
      }

      // Search by name
      if (input.search && input.search.trim().length > 0) {
        const searchLower = input.search.toLowerCase();
        rankings = rankings.filter((r) =>
          r.name.toLowerCase().includes(searchLower)
        );
      }

      // Sort
      switch (input.sortBy) {
        case "kills":
          rankings = [...rankings].sort((a, b) => b.estKills - a.estKills);
          break;
        case "balls":
          rankings = [...rankings].sort((a, b) => b.estBalls - a.estBalls);
          break;
        case "wart":
          rankings = [...rankings].sort((a, b) => b.estWartDistance - a.estWartDistance);
          break;
        case "winRate":
          rankings = [...rankings].sort((a, b) => b.estWinRate - a.estWinRate);
          break;
        case "v4Score":
          rankings = [...rankings].sort((a, b) => b.v4RarityScore - a.v4RarityScore);
          break;
        case "overall":
        default:
          // Already sorted by overall rank
          break;
      }

      // If scheme category is specified, sort by scheme score
      if (input.schemeCategory) {
        rankings = getBestChampionsForScheme(rankings, input.schemeCategory, rankings.length);
      }

      const total = rankings.length;
      const page = rankings.slice(input.offset, input.offset + input.limit);

      return {
        champions: page,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  /**
   * Get a single champion's detailed performance stats.
   */
  championDetail: publicProcedure
    .input(z.object({ championTokenId: z.string() }))
    .query(async ({ input }) => {
      const rankings = await getRankings();
      const champion = rankings.find(
        (r) => r.championTokenId === input.championTokenId
      );
      return champion ?? null;
    }),

  /**
   * Get class-level performance averages.
   */
  classAverages: publicProcedure.query(async () => {
    return Object.entries(CLASS_PERFORMANCE).map(([className, stats]) => ({
      className,
      ...stats,
    }));
  }),

  /**
   * Get scheme category scoring weights.
   */
  schemeCategoryWeights: publicProcedure.query(async () => {
    return Object.entries(SCHEME_CATEGORY_WEIGHTS).map(([category, weights]) => ({
      category,
      ...weights,
    }));
  }),

  /**
   * Get top champions for each scheme category (summary view).
   */
  topByScheme: publicProcedure
    .input(
      z.object({
        schemeCategory: z.string(),
        rarity: z.string().default("ALL"),
        limit: z.number().min(1).max(20).default(10),
      })
    )
    .query(async ({ input }) => {
      let rankings = await getRankings();

      if (input.rarity !== "ALL") {
        rankings = filterByRarity(rankings, input.rarity);
      }

      return getBestChampionsForScheme(rankings, input.schemeCategory, input.limit);
    }),

  /**
   * Refresh champion stats — recompute from game data and save to DB.
   */
  refresh: publicProcedure.mutation(async () => {
    const rankings = await getRankings(true);
    const saved = await saveChampionStats(rankings, "season");
    return {
      totalChampions: rankings.length,
      savedToDb: saved,
      refreshedAt: new Date().toISOString(),
    };
  }),

  /**
   * Get stats summary — counts by rarity, class, fur.
   */
  summary: publicProcedure.query(async () => {
    const rankings = await getRankings();

    const byRarity: Record<string, number> = {};
    const byClass: Record<string, number> = {};
    const byFur: Record<string, number> = {};

    for (const r of rankings) {
      byRarity[r.rarity] = (byRarity[r.rarity] ?? 0) + 1;
      byClass[r.championClass] = (byClass[r.championClass] ?? 0) + 1;
      byFur[r.fur] = (byFur[r.fur] ?? 0) + 1;
    }

    // Top 5 overall
    const top5 = rankings.slice(0, 5).map((r) => ({
      name: r.name,
      rarity: r.rarity,
      fur: r.fur,
      championClass: r.championClass,
      v4RarityScore: r.v4RarityScore,
      rank: r.overallRank,
    }));

    return {
      totalChampions: rankings.length,
      byRarity,
      byClass,
      byFur,
      top5,
      avgV4Score: Math.round(
        rankings.reduce((sum, r) => sum + r.v4RarityScore, 0) / rankings.length * 100
      ) / 100,
    };
  }),
});
