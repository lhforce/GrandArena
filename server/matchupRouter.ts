/**
 * Matchup Router — tRPC procedures for match history scraping,
 * head-to-head matchup lookups, and champion performance from real match data.
 */

import { z } from "zod";
import { eq, desc, and, inArray, isNotNull } from "drizzle-orm";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { savedLineups, contests, leaderboardEntries, userCards } from "../drizzle/schema";
import {
  runFullMatchScrape,
  stopMatchScrape,
  getMatchScrapeProgress,
  scrapeSingleChampion,
  runIncrementalMatchScrape,
  getIncrementalStatus,
  startMatchScrapeCron,
  stopMatchScrapeCron,
  runSeason1Scrape,
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
import {
  analyzeMatchupsAndRecommendSwaps,
  loadGameDataLookup,
  getUserBenchChampions,
} from "./swapAdvisor";

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
   * Run Season 1 scrape: clears all existing match data and re-scrapes
   * all 179 champions with the official scoring formula.
   */
  runSeason1Scrape: publicProcedure.mutation(async () => {
    return runSeason1Scrape();
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

  // ─── Swap Advisor ──────────────────────────────────────────────────

  /**
   * Analyze current matchups and recommend swaps.
   * Input: your 4 champion IDs, opponent 4 champion IDs, optional bench IDs.
   * If no bench IDs provided and user is logged in, uses their full inventory.
   */
  analyzeSwaps: publicProcedure
    .input(
      z.object({
        yourChampionIds: z.array(z.number()).length(4),
        opponentChampionIds: z.array(z.number()).length(4),
        benchChampionIds: z.array(z.number()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const gameData = await loadGameDataLookup();

      // If no bench provided and user is logged in, get their full inventory
      let benchIds = input.benchChampionIds ?? [];
      if (benchIds.length === 0 && ctx.user) {
        benchIds = await getUserBenchChampions(ctx.user.id, input.yourChampionIds);
      }

      const result = await analyzeMatchupsAndRecommendSwaps(
        input.yourChampionIds,
        input.opponentChampionIds,
        benchIds,
        gameData
      );

      return result;
    }),

  /**
   * Quick H2H lookup for a single matchup pair (used by swap advisor UI).
   */
  quickH2h: publicProcedure
    .input(
      z.object({
        championId: z.number(),
        opponentId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return getHeadToHead(input.championId, input.opponentId);
    }),

  // ─── Contest-Based Swap Advisor (Auto-Populate) ─────────────────────

  /**
   * Get contests where the user has saved lineups (for contest picker).
   * Returns contests with the user's lineup data attached.
   */
  myContestEntries: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Get all saved lineups for this user, joined with contest info
      const entries = await db
        .select({
          lineupId: savedLineups.id,
          contestId: savedLineups.contestId,
          entryNumber: savedLineups.entryNumber,
          champion1TokenId: savedLineups.champion1TokenId,
          champion2TokenId: savedLineups.champion2TokenId,
          champion3TokenId: savedLineups.champion3TokenId,
          champion4TokenId: savedLineups.champion4TokenId,
          schemeTokenId: savedLineups.schemeTokenId,
          status: savedLineups.status,
          predictedScore: savedLineups.predictedScore,
          createdAt: savedLineups.createdAt,
          contestName: contests.name,
          contestStatus: contests.contestStatus,
          contestFormat: contests.format,
          rarityRestriction: contests.rarityRestriction,
          entries: contests.entries,
          maxEntries: contests.maxEntries,
        })
        .from(savedLineups)
        .innerJoin(contests, eq(savedLineups.contestId, contests.id))
        .where(eq(savedLineups.userId, ctx.user.id))
        .orderBy(desc(savedLineups.createdAt))
        .limit(input.limit);

      // Resolve NFT tokenIds to champion names and championTokenIds
      // The savedLineups store NFT tokenIds (e.g. 483242658553), not championTokenIds (e.g. 5256)
      const allNftTokenIds = new Set<string>();
      for (const e of entries) {
        [e.champion1TokenId, e.champion2TokenId, e.champion3TokenId, e.champion4TokenId]
          .filter(Boolean)
          .forEach((id) => allNftTokenIds.add(id!));
      }

      // Lookup from user_cards table
      let nftToChampion: Map<string, { name: string; championTokenId: string; rarity: string }> = new Map();
      if (allNftTokenIds.size > 0) {
        const nftIds = Array.from(allNftTokenIds);
        const cards = await db
          .select({
            tokenId: userCards.tokenId,
            championTokenId: userCards.championTokenId,
            name: userCards.name,
            rarity: userCards.rarity,
          })
          .from(userCards)
          .where(inArray(userCards.tokenId, nftIds));

        for (const card of cards) {
          nftToChampion.set(card.tokenId, {
            name: card.name ?? `#${card.tokenId}`,
            championTokenId: card.championTokenId ?? "",
            rarity: card.rarity ?? "Basic",
          });
        }
      }

      // Also try game data fallback for any unresolved IDs
      const gameData = await loadGameDataLookup();

      const resolveChampion = (nftTokenId: string | null) => {
        if (!nftTokenId) return { name: "?", championTokenId: "", rarity: "" };
        // First try user_cards lookup
        const fromCards = nftToChampion.get(nftTokenId);
        if (fromCards) return fromCards;
        // Try game data by tokenId
        const fromGame = gameData.get(Number(nftTokenId));
        if (fromGame) return { name: fromGame.name, championTokenId: String(fromGame.championTokenId), rarity: "" };
        return { name: `#${nftTokenId}`, championTokenId: "", rarity: "" };
      };

      return entries.map((e) => {
        const c1 = resolveChampion(e.champion1TokenId);
        const c2 = resolveChampion(e.champion2TokenId);
        const c3 = resolveChampion(e.champion3TokenId);
        const c4 = resolveChampion(e.champion4TokenId);
        return {
          ...e,
          champions: [
            { nftTokenId: e.champion1TokenId, ...c1 },
            { nftTokenId: e.champion2TokenId, ...c2 },
            { nftTokenId: e.champion3TokenId, ...c3 },
            { nftTokenId: e.champion4TokenId, ...c4 },
          ],
        };
      });
    }),

  /**
   * Get all opponent entries in a contest (other players' lineups from leaderboard).
   * Returns entries with AI-identified champions.
   */
  contestOpponents: publicProcedure
    .input(
      z.object({
        contestId: z.number(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { opponents: [], total: 0 };

      // Get leaderboard entries with identified champions
      const entries = await db
        .select({
          id: leaderboardEntries.id,
          username: leaderboardEntries.username,
          rank: leaderboardEntries.rank,
          score: leaderboardEntries.score,
          identifiedChampions: leaderboardEntries.identifiedChampions,
          identifiedScheme: leaderboardEntries.identifiedScheme,
          aiConfidence: leaderboardEntries.aiConfidence,
          cardImages: leaderboardEntries.cardImages,
          matchesCompleted: leaderboardEntries.matchesCompleted,
          totalMatches: leaderboardEntries.totalMatches,
        })
        .from(leaderboardEntries)
        .where(
          and(
            eq(leaderboardEntries.contestId, input.contestId),
            isNotNull(leaderboardEntries.identifiedChampions)
          )
        )
        .orderBy(leaderboardEntries.rank)
        .limit(input.limit);

      // Parse identifiedChampions JSON for each entry
      const opponents = entries.map((e) => {
        let champions: Array<{ name: string; championTokenId: string; rarity: string }> = [];
        try {
          champions =
            typeof e.identifiedChampions === "string"
              ? JSON.parse(e.identifiedChampions)
              : (e.identifiedChampions as typeof champions) ?? [];
        } catch {
          champions = [];
        }
        return {
          id: e.id,
          username: e.username ?? "Unknown",
          rank: e.rank,
          score: e.score,
          champions,
          scheme: e.identifiedScheme,
          aiConfidence: e.aiConfidence ? Number(e.aiConfidence) : null,
          cardImages: e.cardImages,
          matchesCompleted: e.matchesCompleted,
          totalMatches: e.totalMatches,
        };
      });

      return { opponents, total: opponents.length };
    }),

  /**
   * One-click swap analysis: given a saved lineup ID and an opponent entry,
   * auto-populate everything and return swap recommendations.
   */
  analyzeContestSwaps: protectedProcedure
    .input(
      z.object({
        lineupId: z.number(),
        opponentChampionIds: z.array(z.number()).length(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Get the user's saved lineup
      const [lineup] = await db
        .select()
        .from(savedLineups)
        .where(
          and(
            eq(savedLineups.id, input.lineupId),
            eq(savedLineups.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!lineup) throw new Error("Lineup not found");

      // Resolve NFT tokenIds to championTokenIds via user_cards
      const nftIds = [
        lineup.champion1TokenId,
        lineup.champion2TokenId,
        lineup.champion3TokenId,
        lineup.champion4TokenId,
      ].filter(Boolean) as string[];

      const cards = await db
        .select({ tokenId: userCards.tokenId, championTokenId: userCards.championTokenId })
        .from(userCards)
        .where(inArray(userCards.tokenId, nftIds));

      const nftToChampId = new Map<string, number>();
      for (const card of cards) {
        if (card.championTokenId) {
          nftToChampId.set(card.tokenId, Number(card.championTokenId));
        }
      }

      const gameData = await loadGameDataLookup();

      // Resolve each lineup slot: try user_cards first, then game data
      const yourChampionIds: number[] = [];
      for (const nftId of nftIds) {
        const champId = nftToChampId.get(nftId);
        if (champId && !isNaN(champId)) {
          yourChampionIds.push(champId);
        } else {
          // Fallback: check if the nftId itself is a championTokenId
          const asNum = Number(nftId);
          if (!isNaN(asNum) && gameData.has(asNum)) {
            yourChampionIds.push(asNum);
          }
        }
      }

      if (yourChampionIds.length !== 4) {
        throw new Error(
          `Could not resolve all 4 champions. Found ${yourChampionIds.length} of 4. ` +
          `Make sure your cards are synced in My Cards.`
        );
      }

      // Get user's full bench (all owned MOKIs minus the ones in this lineup)
      const benchIds = await getUserBenchChampions(ctx.user.id, yourChampionIds);

      const result = await analyzeMatchupsAndRecommendSwaps(
        yourChampionIds,
        input.opponentChampionIds,
        benchIds,
        gameData
      );

      // Get contest info for context
      let contestName = "";
      if (lineup.contestId) {
        const [contest] = await db
          .select({ name: contests.name })
          .from(contests)
          .where(eq(contests.id, lineup.contestId))
          .limit(1);
        contestName = contest?.name ?? "";
      }

      return {
        ...result,
        lineupId: lineup.id,
        contestId: lineup.contestId,
        contestName,
        entryNumber: lineup.entryNumber,
      };
    }),

  // ─── Cron Job Management ──────────────────────────────────────────

  /**
   * Get the status of the hourly incremental match scrape cron job.
   */
  cronStatus: publicProcedure.query(async () => {
    return getIncrementalStatus();
  }),

  /**
   * Manually trigger an incremental scrape (same as what the cron runs).
   */
  triggerIncrementalScrape: protectedProcedure.mutation(async () => {
    // Fire and forget — don't block the response
    runIncrementalMatchScrape().catch((err) =>
      console.error("[MatchScraper] Manual incremental scrape failed:", err)
    );
    return { triggered: true, message: "Incremental scrape started" };
  }),

  /**
   * Start the hourly cron job (if not already running).
   */
  startCron: protectedProcedure.mutation(async () => {
    startMatchScrapeCron();
    return { started: true };
  }),

  /**
   * Stop the hourly cron job.
   */
  stopCron: protectedProcedure.mutation(async () => {
    stopMatchScrapeCron();
    return { stopped: true };
  }),
});
