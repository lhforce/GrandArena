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
  runSeason1Scrape,
  clearPreSeasonData,
  stopMatchScrape,
  getMatchScrapeProgress,
  scrapeSingleChampion,
  runIncrementalMatchScrape,
  getIncrementalStatus,
  startMatchScrapeCron,
  stopMatchScrapeCron,
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
  loadGameDataLookup,
  getUserBenchChampions,
} from "./gameDataUtils";
import {
  analyzeContestPrep,
  getUserMokisForPrep,
  loadSchemeData,
} from "./contestPrep";
import { getLegendaryAdvisory, getChampionAdvisoryByName } from "./legendaryAdvisor";
import { buildCounterLineup, getOwnedChampionIds } from "./opponentCrusher";
import { getMetaReport } from "./metaReport";

// In-memory store for bookmarklet sessions
const bookmarkletSessions = new Map<string, { data: any; createdAt: number }>();

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
   * Start a clean Season 1 scrape: clear pre-season data, then scrape fresh.
   * Only fetches matches from Feb 19, 2026 onwards.
   */
  startSeason1Scrape: publicProcedure.mutation(async () => {
    // Run in background (don't await)
    runSeason1Scrape().catch((err) =>
      console.error("[MatchupRouter] Season 1 scrape failed:", err)
    );
    return { started: true, message: "Season 1 scrape started — clearing old data and re-scraping from Feb 19" };
  }),

  /**
   * Clear all pre-season match data (before Feb 19, 2026).
   */
  clearPreSeasonData: publicProcedure.mutation(async () => {
    const result = await clearPreSeasonData();
    return result;
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

  // ─── Contest Entries & Opponents ──────────────────────────────────

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

  // ─── Contest Prep (Proactive Opponent Scouting) ────────────────────

  /**
   * Contest Prep: Given opponent matchups (4 slots × 5 opponents each),
   * find the optimal MOKIs from the user's collection and best Scheme card.
   */
  contestPrep: protectedProcedure
    .input(
      z.object({
        slots: z.array(
          z.object({
            slotIndex: z.number(),
            opponentIds: z.array(z.number()),
            opponentNames: z.array(z.string()),
          })
        ).min(1).max(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const gameData = await loadGameDataLookup();
      const schemeData = await loadSchemeData();
      const userMokis = await getUserMokisForPrep(ctx.user.id);

      if (userMokis.length === 0) {
        throw new Error(
          "No MOKIs found in your collection. Please sync your cards first in My Cards."
        );
      }

      const result = await analyzeContestPrep(
        input.slots,
        userMokis,
        gameData,
        schemeData
      );

      return result;
    }),

  /**
   * Receive matchup data from the bookmarklet.
   * Stores it temporarily and returns a session token for the UI to fetch.
   */
  bookmarkletIngest: publicProcedure
    .input(
      z.object({
        contestId: z.string().optional(),
        entryId: z.string().optional(),
        contestName: z.string().optional(),
        slots: z.array(
          z.object({
            slotIndex: z.number(),
            yourMoki: z.object({
              name: z.string(),
              tokenId: z.string().optional(),
            }),
            opponents: z.array(
              z.object({
                name: z.string(),
                tokenId: z.string().optional(),
              })
            ),
          })
        ),
        timestamp: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      // Store in memory with a session key
      const sessionKey = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      bookmarkletSessions.set(sessionKey, {
        data: input,
        createdAt: Date.now(),
      });

      // Clean up old sessions (>30 min)
      const cutoff = Date.now() - 30 * 60 * 1000;
      Array.from(bookmarkletSessions.entries()).forEach(([key, val]) => {
        if (val.createdAt < cutoff) bookmarkletSessions.delete(key);
      });

      return { sessionKey, received: true };
    }),

  /**
   * Fetch bookmarklet data by session key (polled by the UI).
   */
  bookmarkletFetch: publicProcedure
    .input(z.object({ sessionKey: z.string() }))
    .query(async ({ input }) => {
      const session = bookmarkletSessions.get(input.sessionKey);
      if (!session) return { found: false, data: null };
      return { found: true, data: session.data };
    }),

  /**
   * Get the latest bookmarklet session (for auto-detection).
   */
  bookmarkletLatest: publicProcedure
    .query(async () => {
      // Find the most recent session
      let latestEntry: { key: string; data: any; createdAt: number } | null = null;
      const entries = Array.from(bookmarkletSessions.entries());
      for (let i = 0; i < entries.length; i++) {
        const [key, val] = entries[i];
        if (!latestEntry || val.createdAt > latestEntry.createdAt) {
          latestEntry = { key, data: val.data, createdAt: val.createdAt };
        }
      }
      if (!latestEntry) return { found: false as const, data: null, sessionKey: null };
      // Only return if less than 5 minutes old
      if (Date.now() - latestEntry.createdAt > 5 * 60 * 1000) {
        return { found: false as const, data: null, sessionKey: null };
      }
      return { found: true as const, data: latestEntry.data, sessionKey: latestEntry.key };
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

  // ─── Legendary Advisor ─────────────────────────────────────────────
  getLegendaryAdvisory: protectedProcedure
    .input(z.object({
      schemeName: z.string(),
      topN: z.number().min(1).max(20).default(10),
      targetRarity: z.enum(["Rare", "Epic", "Legendary"]).default("Legendary"),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      return getLegendaryAdvisory(input.schemeName, userId, input.topN, input.targetRarity);
    }),

  /**
   * Get crafting advisory for a single champion by name (for "Select Card" entry point).
   */
  getChampionAdvisory: protectedProcedure
    .input(z.object({
      championName: z.string(),
      targetRarity: z.enum(["Rare", "Epic", "Legendary"]).default("Legendary"),
    }))
    .query(async ({ input, ctx }) => {
      return getChampionAdvisoryByName(input.championName, ctx.user.id, input.targetRarity);
    }),

  // ─── Opponent Crusher ──────────────────────────────────────────────
  buildCounterLineup: protectedProcedure
    .input(z.object({
      opponentChampionIds: z.array(z.number()).min(1).max(4),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const ownedIds = await getOwnedChampionIds(userId);
      const gameData = await loadGameDataLookup();
      const lookup = new Map<number, { name: string; championClass: string; imageUrl?: string | null }>();
      Array.from(gameData.entries()).forEach(([id, info]) => lookup.set(Number(id), info as { name: string; championClass: string; imageUrl?: string | null }));
      return buildCounterLineup(input.opponentChampionIds, ownedIds, lookup);
    }),

  buildCounterLineupPublic: publicProcedure
    .input(z.object({
      opponentChampionIds: z.array(z.number()).min(1).max(4),
      ownedChampionIds: z.array(z.number()).min(4),
    }))
    .mutation(async ({ input }) => {
      const gameData = await loadGameDataLookup();
      const lookup = new Map<number, { name: string; championClass: string; imageUrl?: string | null }>();
      Array.from(gameData.entries()).forEach(([id, info]) => lookup.set(Number(id), info as { name: string; championClass: string; imageUrl?: string | null }));
      return buildCounterLineup(input.opponentChampionIds, input.ownedChampionIds, lookup);
    }),

  // ─── Meta Report ───────────────────────────────────────────────────
  getMetaReport: publicProcedure
    .input(z.object({
      sortBy: z.enum(["winRate", "avgScore", "avgKills", "avgBalls", "totalMatches"]).default("winRate"),
      limit: z.number().min(5).max(50).default(25),
      minMatches: z.number().min(1).default(10),
      includePrices: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      return getMetaReport(input.sortBy, input.limit, input.minMatches, input.includePrices);
    }),

  // ─── Champion Deep Dive ─────────────────────────────────────────────
  getChampionDeepDive: publicProcedure
    .input(z.object({
      championTokenId: z.number(),
    }))
    .query(async ({ input }) => {
      const [performance, matchups, gameData] = await Promise.all([
        getChampionPerformance(input.championTokenId),
        getBestWorstMatchups(input.championTokenId, 3),
        loadGameDataLookup(),
      ]);
      if (!performance) return null;
      const info = gameData.get(input.championTokenId);
      return {
        performance,
        matchups,
        imageUrl: (info as any)?.imageUrl ?? null,
      };
    }),

  getChampionPrices: publicProcedure
    .input(z.object({ championName: z.string() }))
    .query(async ({ input }) => {
      const GA_CARDS_CONTRACT = '0x8c811e3c958e190f5ec15fb376533a3398620500';
      const GQL_ENDPOINT = 'https://marketplace-graphql.skymavis.com/graphql';
      const rarities = ['Basic', 'Rare', 'Epic', 'Legendary'] as const;
      const prices: Record<string, number | null> = {};
      await Promise.all(rarities.map(async (rarity) => {
        const query = `{
          erc721Tokens(
            tokenAddress: "${GA_CARDS_CONTRACT}",
            from: 0, size: 1, sort: PriceAsc, auctionType: Sale,
            criteria: [
              {name: "Card Type", values: ["MOKI"]},
              {name: "Rarity", values: ["${rarity}"]}
            ],
            name: "${input.championName.replace(/"/g, '\\"')}"
          ) { results { order { currentPrice } } }
        }`;
        try {
          const resp = await fetch(GQL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });
          const data = await resp.json() as any;
          const r = data?.data?.erc721Tokens?.results;
          if (r?.length > 0 && r[0]?.order?.currentPrice) {
            prices[rarity] = Math.round(Number(BigInt(r[0].order.currentPrice)) / 1e18 * 100) / 100;
          } else {
            prices[rarity] = null;
          }
        } catch {
          prices[rarity] = null;
        }
      }));
      return prices;
    }),
});
