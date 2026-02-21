/**
 * Contest Router — tRPC procedures for contest data, scraping, and lineup analysis.
 */

import { z } from "zod";
import { eq, desc, asc, and, sql, inArray, isNotNull, like } from "drizzle-orm";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { contests, leaderboardEntries, scrapeJobs, savedLineups } from "../drizzle/schema";
import { runContestScrape, refreshActiveContests } from "./contestScraper";
import { processUnidentifiedEntries, runIdentificationPipeline } from "./cardIdentifier";

export const contestRouter = router({
  /**
   * Get all contests with optional status filter.
   */
  list: publicProcedure
    .input(z.object({
      status: z.string().optional(),
      format: z.string().optional(),
      rarityRestriction: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { contests: [], total: 0 };

      const conditions = [];
      
      if (input.status) conditions.push(eq(contests.contestStatus, input.status));
      if (input.format) conditions.push(eq(contests.format, input.format));
      if (input.rarityRestriction) conditions.push(eq(contests.rarityRestriction, input.rarityRestriction));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [data, countResult] = await Promise.all([
        db.select()
          .from(contests)
          .where(where)
          .orderBy(desc(contests.startDate))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`count(*)` })
          .from(contests)
          .where(where),
      ]);

      return {
        contests: data,
        total: Number(countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Get a single contest with its leaderboard.
   */
  getWithLeaderboard: publicProcedure
    .input(z.object({
      contestId: z.number(),
      leaderboardLimit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const [contest] = await db.select()
        .from(contests)
        .where(eq(contests.id, input.contestId))
        .limit(1);

      if (!contest) return null;

      const entries = await db.select()
        .from(leaderboardEntries)
        .where(eq(leaderboardEntries.contestId, input.contestId))
        .orderBy(asc(leaderboardEntries.rank))
        .limit(input.leaderboardLimit);

      return { contest, leaderboard: entries };
    }),

  /**
   * Get winning lineups analysis — top lineups from completed contests
   * grouped by contest type/rarity restriction.
   */
  winningLineups: publicProcedure
    .input(z.object({
      rarityRestriction: z.string().optional(),
      format: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [
        eq(contests.contestStatus, "COMPLETED"),
        isNotNull(leaderboardEntries.identifiedChampions),
      ];

      if (input.rarityRestriction) {
        conditions.push(eq(contests.rarityRestriction, input.rarityRestriction));
      }
      if (input.format) {
        conditions.push(eq(contests.format, input.format));
      }

      const results = await db.select({
        entryId: leaderboardEntries.id,
        rank: leaderboardEntries.rank,
        score: leaderboardEntries.score,
        identifiedChampions: leaderboardEntries.identifiedChampions,
        identifiedScheme: leaderboardEntries.identifiedScheme,
        aiConfidence: leaderboardEntries.aiConfidence,
        cardImages: leaderboardEntries.cardImages,
        contestName: contests.name,
        contestFormat: contests.format,
        rarityRestriction: contests.rarityRestriction,
        prizePool: contests.prizePool,
        estimatedPayout: leaderboardEntries.estimatedPayout,
      })
        .from(leaderboardEntries)
        .innerJoin(contests, eq(leaderboardEntries.contestId, contests.id))
        .where(and(...conditions))
        .orderBy(asc(leaderboardEntries.rank))
        .limit(input.limit);

      return results;
    }),

  /**
   * Get contest statistics dashboard data.
   */
  stats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;

    const [
      totalContests,
      completedContests,
      liveContests,
      openContests,
      draftContests,
      totalEntries,
      identifiedEntries,
      lastJob,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(contests),
      db.select({ count: sql<number>`count(*)` }).from(contests).where(eq(contests.contestStatus, "COMPLETED")),
      db.select({ count: sql<number>`count(*)` }).from(contests).where(eq(contests.contestStatus, "LIVE")),
      db.select({ count: sql<number>`count(*)` }).from(contests).where(eq(contests.contestStatus, "OPEN")),
      db.select({ count: sql<number>`count(*)` }).from(contests).where(eq(contests.contestStatus, "DRAFT")),
      db.select({ count: sql<number>`count(*)` }).from(leaderboardEntries),
      db.select({ count: sql<number>`count(*)` }).from(leaderboardEntries).where(isNotNull(leaderboardEntries.aiProcessedAt)),
      db.select().from(scrapeJobs).orderBy(desc(scrapeJobs.createdAt)).limit(1),
    ]);

    return {
      totalContests: Number(totalContests[0]?.count ?? 0),
      completedContests: Number(completedContests[0]?.count ?? 0),
      liveContests: Number(liveContests[0]?.count ?? 0),
      openContests: Number(openContests[0]?.count ?? 0),
      draftContests: Number(draftContests[0]?.count ?? 0),
      totalLeaderboardEntries: Number(totalEntries[0]?.count ?? 0),
      identifiedEntries: Number(identifiedEntries[0]?.count ?? 0),
      lastScrapeJob: lastJob[0] ?? null,
    };
  }),

  /**
   * Trigger a full contest scrape (admin action).
   * Non-blocking: starts the scrape in background and returns the job ID immediately.
   */
  triggerScrape: publicProcedure.mutation(async () => {
    console.log("[ContestRouter] Starting full contest scrape (non-blocking)...");
    // Start scrape in background — don't await
    const scrapePromise = runContestScrape();
    scrapePromise.then((result) => {
      console.log(`[ContestRouter] Scrape complete: ${result.contestsProcessed} contests, ${result.entriesProcessed} entries`);
    }).catch((err) => {
      console.error(`[ContestRouter] Scrape failed:`, err);
    });
    // Return immediately so the UI doesn't hang
    return { started: true, message: "Scrape started in background. Refresh stats to see progress." };
  }),

  /**
   * Refresh only active contests (LIVE, OPEN, DRAFT).
   */
  refreshActive: publicProcedure.mutation(async () => {
    const count = await refreshActiveContests();
    return { refreshed: count };
  }),

  /**
   * Trigger AI identification of card images.
   * Non-blocking: starts in background and returns immediately.
   */
  triggerIdentification: publicProcedure
    .input(z.object({
      topN: z.number().min(1).max(50).default(10),
    }))
    .mutation(async ({ input }) => {
      const topN = input.topN;
      console.log(`[ContestRouter] Starting AI identification (top ${topN} per contest) (non-blocking)...`);
      const idPromise = runIdentificationPipeline(topN);
      idPromise.then((result) => {
        console.log(`[ContestRouter] Identification complete: ${result.processed} processed, ${result.errors} errors`);
      }).catch((err) => {
        console.error(`[ContestRouter] Identification failed:`, err);
      });
      return { started: true, message: "AI identification started in background. Refresh stats to see progress." };
    }),

  /**
   * Get scrape job history.
   */
  scrapeJobs: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      return db.select()
        .from(scrapeJobs)
        .orderBy(desc(scrapeJobs.createdAt))
        .limit(input.limit);
    }),

  /**
   * Get rarity restriction distribution for contests.
   */
  rarityDistribution: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    return db.select({
      rarityRestriction: contests.rarityRestriction,
      count: sql<number>`count(*)`,
    })
      .from(contests)
      .groupBy(contests.rarityRestriction);
  }),
});
