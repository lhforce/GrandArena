/**
 * Matchup Router — tRPC procedures for match history scraping,
 * head-to-head matchup lookups, and champion performance from real match data.
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  runFullMatchScrape,
  stopMatchScrape,
  getMatchScrapeProgress,
  scrapeSingleChampion,
} from "./matchScraper";
import {
  getHeadToHead,
  getChampionMatchups,
  getChampionPerformance,
  getAllChampionPerformance,
  getClassMatchups,
  searchChampionsByName,
  getBestWorstMatchups,
  getMatchDataSummary,
} from "./matchupAnalytics";

export const matchupRouter = router({
  /**
   * Start the full match history scrape (all 179 champions).
   * This is a long-running background process.
   */
  startScrape: publicProcedure.mutation(async () => {
    // Run in background (don't await)
    runFullMatchScrape().catch((err) =>
      console.error("[MatchupRouter] Scrape failed:", err)
    );
    return { started: true, message: "Match history scrape started in background" };
  }),

  /**
   * Stop the running scrape gracefully.
   */
  stopScrape: publicProcedure.mutation(async () => {
    stopMatchScrape();
    return { stopped: true };
  }),

  /**
   * Get current scrape progress.
   */
  scrapeProgress: publicProcedure.query(async () => {
    return getMatchScrapeProgress();
  }),

  /**
   * Scrape matches for a single champion (targeted refresh).
   */
  scrapeSingle: publicProcedure
    .input(
      z.object({
        championTokenId: z.number(),
        championName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await scrapeSingleChampion(
        input.championTokenId,
        input.championName
      );
      return result;
    }),

  /**
   * Get head-to-head record between two champions.
   */
  headToHead: publicProcedure
    .input(
      z.object({
        championTokenId: z.number(),
        opponentTokenId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return getHeadToHead(input.championTokenId, input.opponentTokenId);
    }),

  /**
   * Get all matchup records for a champion.
   */
  championMatchups: publicProcedure
    .input(
      z.object({
        championTokenId: z.number(),
        limit: z.number().min(1).max(200).default(50),
        minMatches: z.number().min(1).default(1),
      })
    )
    .query(async ({ input }) => {
      return getChampionMatchups(
        input.championTokenId,
        input.limit,
        input.minMatches
      );
    }),

  /**
   * Get a champion's overall performance from match data.
   */
  championPerformance: publicProcedure
    .input(z.object({ championTokenId: z.number() }))
    .query(async ({ input }) => {
      return getChampionPerformance(input.championTokenId);
    }),

  /**
   * Get performance rankings for all champions.
   */
  performanceRankings: publicProcedure
    .input(
      z.object({
        sortBy: z
          .enum(["winRate", "avgKills", "avgBalls", "avgWart", "totalMatches"])
          .default("winRate"),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        minMatches: z.number().min(1).default(5),
      })
    )
    .query(async ({ input }) => {
      return getAllChampionPerformance(
        input.sortBy,
        input.limit,
        input.offset,
        input.minMatches
      );
    }),

  /**
   * Get class vs class matchup summary.
   */
  classMatchups: publicProcedure.query(async () => {
    return getClassMatchups();
  }),

  /**
   * Search champions by name (for autocomplete).
   */
  searchChampions: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      return searchChampionsByName(input.query, input.limit);
    }),

  /**
   * Get best and worst matchups for a champion.
   */
  bestWorstMatchups: publicProcedure
    .input(
      z.object({
        championTokenId: z.number(),
        minMatches: z.number().min(1).default(3),
      })
    )
    .query(async ({ input }) => {
      return getBestWorstMatchups(input.championTokenId, input.minMatches);
    }),

  /**
   * Get data summary for the matchup intelligence page.
   */
  dataSummary: publicProcedure.query(async () => {
    return getMatchDataSummary();
  }),
});
