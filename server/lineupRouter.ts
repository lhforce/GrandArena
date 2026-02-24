/**
 * Lineup Router — tRPC procedures for wallet sync, lineup optimization,
 * card lockups, gem budget tracking, and user settings.
 */

import { z } from "zod";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  users,
  userCards,
  cardLockups,
  savedLineups,
  gemSpendingLog,
  contests,
  championStats,
} from "../drizzle/schema";
import { syncWalletInventory, getUserInventory, getAvailableCards } from "./walletSync";
import {
  optimizeLineups,
  userCardsToChampionCards,
  categorizeScheme,
  type SchemeCardData,
  type ContestRules,
  type ChampionCard,
} from "./lineupOptimizer";

export const lineupRouter = router({
  // ─── Wallet Sync ──────────────────────────────────────────────────

  /**
   * Sync wallet inventory from Ronin Marketplace.
   */
  syncWallet: protectedProcedure
    .input(z.object({ walletAddress: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const result = await syncWalletInventory(ctx.user.id, input.walletAddress);
      return result;
    }),

  /**
   * Get the user's current card inventory (from DB cache).
   */
  inventory: protectedProcedure.query(async ({ ctx }) => {
    const inv = await getUserInventory(ctx.user.id);
    return {
      mokis: inv.mokis,
      schemes: inv.schemes,
      totalMokis: inv.mokis.length,
      totalSchemes: inv.schemes.length,
    };
  }),

  /**
   * Get available (unlocked) cards for lineup building.
   */
  availableCards: protectedProcedure.query(async ({ ctx }) => {
    return getAvailableCards(ctx.user.id);
  }),

  // ─── Lineup Optimizer ─────────────────────────────────────────────

  /**
   * Build optimal lineups for a specific contest.
   */
  optimize: protectedProcedure
    .input(
      z.object({
        contestId: z.number(),
        numEntries: z.number().min(1).max(25).default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Get contest details
      const [contest] = await db
        .select()
        .from(contests)
        .where(eq(contests.id, input.contestId))
        .limit(1);

      if (!contest) throw new Error("Contest not found");

      // Get user's available cards
      const available = await getAvailableCards(ctx.user.id);

      // Get user's daily budget
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      const dailyBudget = user?.dailyGemBudget ?? 5000;

      // Calculate today's spending
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [spentResult] = await db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
        .from(gemSpendingLog)
        .where(
          and(
            eq(gemSpendingLog.userId, ctx.user.id),
            sql`spentAt >= ${todayStart}`
          )
        );
      const spentToday = Number(spentResult?.total ?? 0);
      const remainingBudget = dailyBudget - spentToday;

      // Load game-data.json for scheme descriptions and trait info
      const fs = await import("fs");
      const path = await import("path");
      const gameDataPath = path.resolve(import.meta.dirname ?? process.cwd(), "../client/public/game-data.json");
      let gameDataSchemes: Array<{ name: string; description: string; effect?: string }> = [];
      try {
        const raw = fs.readFileSync(gameDataPath, "utf-8");
        const gameData = JSON.parse(raw);
        gameDataSchemes = gameData.schemes ?? [];
      } catch (err) {
        console.error("[Optimizer] Failed to load game-data.json for schemes:", err);
      }

      // Build scheme lookup by name (case-insensitive)
      // Include hasTraitFilter and qualifyingChampions from game data
      const schemeLookup = new Map<string, {
        description: string;
        hasTraitFilter: boolean;
        qualifyingChampionIds: string[];
      }>();
      for (const gs of gameDataSchemes) {
        const hasFilter = !!(gs as any).hasTraitFilter;
        const qualChamps = ((gs as any).qualifyingChampions ?? []) as Array<{ championTokenId?: string }>;
        const qualIds = qualChamps
          .map((q) => q.championTokenId)
          .filter((id): id is string => !!id);
        schemeLookup.set(gs.name.toLowerCase(), {
          description: gs.description ?? gs.effect ?? "",
          hasTraitFilter: hasFilter,
          qualifyingChampionIds: qualIds,
        });
      }

      // Load scheme data with risk classification and trait info
      const { classifySchemeRisk, categorizeScheme: catScheme } = await import("./lineupOptimizer");
      const schemeCards: SchemeCardData[] = available.schemes.map((s) => {
        const sName = s.name ?? "Unknown Scheme";
        const lookup = schemeLookup.get(sName.toLowerCase());
        const desc = lookup?.description ?? "";
        const hasTraitFilter = lookup?.hasTraitFilter ?? false;
        const qualifyingChampionIds = lookup?.qualifyingChampionIds ?? [];
        return {
          tokenId: s.tokenId,
          name: sName,
          description: desc,
          hasTraitFilter,
          qualifyingChampionIds,
          category: catScheme(desc, hasTraitFilter),
          riskLevel: classifySchemeRisk(sName, desc),
          imageUrl: s.imageUrl ?? null,
        };
      });

      // Load champion performance stats from database (class-based model)
      let statsRows = await db.select().from(championStats);

      // Auto-refresh stats if the table is empty (first-time use)
      if (statsRows.length === 0) {
        console.log("[Optimizer] No champion stats found, auto-refreshing...");
        try {
          const { rankAllChampions, parseGameDataChampions, saveChampionStats } = await import("./championStats");
          const fs = await import("fs");
          const path = await import("path");
          const gameDataPath = path.resolve(import.meta.dirname ?? process.cwd(), "../client/public/game-data.json");
          const raw = fs.readFileSync(gameDataPath, "utf-8");
          const gameData = JSON.parse(raw);
          const champions = parseGameDataChampions(gameData);
          const rankings = rankAllChampions(champions);
          await saveChampionStats(rankings, "season");
          statsRows = await db.select().from(championStats);
          console.log(`[Optimizer] Auto-refreshed ${statsRows.length} champion stats`);
        } catch (err) {
          console.error("[Optimizer] Failed to auto-refresh stats:", err);
        }
      }

      // Load empirical stats from winning lineups
      const { aggregateEmpiricalStats, blendStats } = await import("./empiricalStats");
      let empiricalResult = { champions: new Map(), totalEntriesAnalyzed: 0, totalContestsAnalyzed: 0, lastUpdated: new Date() } as Awaited<ReturnType<typeof aggregateEmpiricalStats>>;
      try {
        empiricalResult = await aggregateEmpiricalStats(0.7);
        if (empiricalResult.totalEntriesAnalyzed > 0) {
          console.log(`[Optimizer] Loaded empirical data: ${empiricalResult.totalEntriesAnalyzed} entries, ${empiricalResult.champions.size} unique champions`);
        }
      } catch (err) {
        console.error("[Optimizer] Failed to load empirical stats:", err);
      }

      // Load match history performance data (3rd data source)
      const { getBulkMatchPerformance } = await import("./matchupAnalytics");
      let matchPerformanceData = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>();
      try {
        // Collect all championTokenIds from the user's mokis
        const champTokenIds = available.mokis
          .map(m => m.championTokenId ? Number(m.championTokenId) : null)
          .filter((id): id is number => id !== null && !isNaN(id));
        if (champTokenIds.length > 0) {
          matchPerformanceData = await getBulkMatchPerformance(champTokenIds);
          if (matchPerformanceData.size > 0) {
            console.log(`[Optimizer] Loaded match history data for ${matchPerformanceData.size} champions`);
          }
        }
      } catch (err) {
        console.error("[Optimizer] Failed to load match history data:", err);
      }

      // Build blended performance stats (model + empirical + match history)
      const performanceStats = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number }>();
      const blendMetadata: Record<string, { dataSource: string; empiricalWeight: number; appearances: number; matchHistoryMatches: number }> = {};

      for (const row of statsRows) {
        const modelStats = {
          avgKills: Number(row.avgKills ?? 0),
          avgBalls: Number(row.avgBalls ?? 0),
          avgWartDistance: Number(row.avgWartDistance ?? 0),
          winRate: Number(row.winRate ?? 0),
        };

        // Look up empirical data for this champion
        const empirical = empiricalResult.champions.get(row.championTokenId);
        const rarity = row.fur ?? "Basic";

        // Find the card's actual rarity from the user's inventory
        const userCard = available.mokis.find(m => m.championTokenId === row.championTokenId);
        const cardRarity = userCard?.rarity ?? "Basic";

        const blended = blendStats(modelStats, empirical, cardRarity);

        // Layer 3: Match history data (real match performance from GATracker)
        // Match history is the MOST RELIABLE source — actual kills/balls/wart from real games.
        // When we have enough match history, it should DOMINATE over model/empirical estimates.
        const matchData = matchPerformanceData.get(row.championTokenId);
        let finalStats = {
          avgKills: blended.avgKills,
          avgBalls: blended.avgBalls,
          avgWartDistance: blended.avgWartDistance,
          winRate: blended.winRate,
        };
        let matchHistoryMatches = 0;

        if (matchData && matchData.totalMatches >= 10) {
          matchHistoryMatches = matchData.totalMatches;

          if (matchData.totalMatches >= 50) {
            // 50+ matches: match history is highly reliable, use it as primary source
            // Only blend in a small amount of model data for smoothing
            const matchWeight = Math.min(0.95, 0.8 + (matchData.totalMatches - 50) / 500);
            finalStats = {
              avgKills: Math.round((modelStats.avgKills * (1 - matchWeight) + matchData.avgKills * matchWeight) * 100) / 100,
              avgBalls: Math.round((modelStats.avgBalls * (1 - matchWeight) + matchData.avgBalls * matchWeight) * 100) / 100,
              avgWartDistance: Math.round((modelStats.avgWartDistance * (1 - matchWeight) + matchData.avgWartDistance * matchWeight) * 100) / 100,
              winRate: Math.round((modelStats.winRate * (1 - matchWeight) + matchData.winRate * matchWeight) * 1000) / 1000,
            };
          } else {
            // 10-49 matches: blend match history with model (skip empirical to avoid corruption)
            const matchWeight = Math.min(0.7, (matchData.totalMatches - 10) / 60);
            finalStats = {
              avgKills: Math.round((modelStats.avgKills * (1 - matchWeight) + matchData.avgKills * matchWeight) * 100) / 100,
              avgBalls: Math.round((modelStats.avgBalls * (1 - matchWeight) + matchData.avgBalls * matchWeight) * 100) / 100,
              avgWartDistance: Math.round((modelStats.avgWartDistance * (1 - matchWeight) + matchData.avgWartDistance * matchWeight) * 100) / 100,
              winRate: Math.round((modelStats.winRate * (1 - matchWeight) + matchData.winRate * matchWeight) * 1000) / 1000,
            };
          }
        }

        performanceStats.set(row.championTokenId, finalStats);

        const dataSource = matchData && matchData.totalMatches >= 10
          ? (blended.dataSource === "model" ? "match_history" : `${blended.dataSource}+match`)
          : blended.dataSource;

        blendMetadata[row.championTokenId] = {
          dataSource,
          empiricalWeight: blended.empiricalWeight,
          appearances: blended.empiricalAppearances,
          matchHistoryMatches,
        };
      }

      // Detect contest type from name for variance-aware scheme selection
      // "Top X%" contests reward consistency (trait schemes preferred)
      // "Winner" or "1st Place" contests reward ceiling (performance schemes preferred)
      const contestNameLower = (contest.name ?? "").toLowerCase();
      const contestType: import("./lineupOptimizer").ContestType =
        /top\s*\d+\s*%/.test(contestNameLower) ? "topPercent" :
        /winner|1st place|first place|highest score/.test(contestNameLower) ? "winnerTakeAll" :
        "standard";

      // Detect short-match contests (Half Day = ~10 matches per MOKI)
      // Performance schemes suffer in short matches due to insufficient RNG samples
      const { isShortMatchContest } = await import("./lineupOptimizer");
      const isShortMatch = isShortMatchContest(contest.name ?? "");

      const contestRules: ContestRules = {
        rarityRestriction: contest.rarityRestriction ?? "OPEN",
        isOneOfEach: contest.isOneOfEach ?? false,
        isStarCap: contest.isStarCap ?? false,
        maxEntriesPerUser: contest.maxEntriesPerUser ?? 1,
        format: contest.format,
        contestType,
        isShortMatch,
      };

      // Load empirical scheme performance data for risk override
      let schemeEmpirical = new Map<string, { winRate: number; appearances: number; confidence: number }>();
      try {
        const { aggregateSchemePerformance } = await import("./empiricalStats");
        const schemePerf = await aggregateSchemePerformance(0.5);
        for (const sp of schemePerf.schemes) {
          schemeEmpirical.set(sp.schemeName.toLowerCase(), {
            winRate: sp.winRate,
            appearances: sp.appearances,
            confidence: sp.confidence,
          });
        }
        if (schemePerf.schemes.length > 0) {
          console.log(`[Optimizer] Loaded empirical scheme data: ${schemePerf.schemes.length} schemes`);
        }
      } catch (err) {
        console.error("[Optimizer] Failed to load empirical scheme data:", err);
      }

      // Load ALL 180 champions from game-data.json as the candidate pool.
      // The optimizer picks the best lineup from all champions, not just owned cards.
      // Owned cards are only used for lockup tracking (cards in active contests).
      let allGameChampions: ChampionCard[] = [];
      try {
        const rawGd = fs.readFileSync(gameDataPath, "utf-8");
        const gd = JSON.parse(rawGd);
        const { parseGameDataChampions } = await import("./championStats");
        const gdChampions = parseGameDataChampions(gd);
        allGameChampions = gdChampions.map((ch) => ({
          tokenId: ch.championTokenId,        // virtual tokenId = championTokenId
          championTokenId: ch.championTokenId,
          name: ch.name,
          rarity: ch.rarity ?? "Basic",
          imageUrl: ch.image ?? null,
        }));
        console.log(`[Optimizer] Loaded ${allGameChampions.length} champions from game-data.json as candidate pool`);
      } catch (err) {
        console.error("[Optimizer] Failed to load all champions from game-data.json, falling back to owned cards:", err);
        allGameChampions = userCardsToChampionCards(available.mokis);
      }
      const result = optimizeLineups({
        ownedMokis: userCardsToChampionCards(available.mokis),
        allMokis: allGameChampions.length > 0 ? allGameChampions : userCardsToChampionCards(available.mokis),
        ownedSchemes: schemeCards,
        allSchemes: schemeCards,
        contestRules,
        numEntries: input.numEntries,
        entryFee: contest.entryFee ?? 0,
        dailyBudget: remainingBudget,
        performanceStats: performanceStats.size > 0 ? performanceStats : undefined,
        schemeEmpirical,
      });

      return {
        ...result,
        contestName: contest.name,
        contestFormat: contest.format,
        rarityRestriction: contest.rarityRestriction,
        entryFee: contest.entryFee,
        remainingBudget,
        spentToday,
        empiricalData: {
          totalEntriesAnalyzed: empiricalResult.totalEntriesAnalyzed,
          totalContestsAnalyzed: empiricalResult.totalContestsAnalyzed,
          championsWithData: empiricalResult.champions.size,
          blendMetadata,
        },
        matchHistoryData: {
          championsWithMatchData: matchPerformanceData.size,
          totalMatchesInDb: Array.from(matchPerformanceData.values()).reduce((sum, d) => sum + d.totalMatches, 0),
        },
      };
    }),

  /**
   * Save a lineup (draft or submitted).
   */
  saveLineup: protectedProcedure
    .input(
      z.object({
        contestId: z.number(),
        entryNumber: z.number().min(1).max(25),
        champion1TokenId: z.string(),
        champion2TokenId: z.string(),
        champion3TokenId: z.string(),
        champion4TokenId: z.string(),
        schemeTokenId: z.string().nullable(),
        predictedScore: z.number().optional(),
        status: z.enum(["draft", "submitted"]).default("draft"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [existing] = await db
        .select()
        .from(savedLineups)
        .where(
          and(
            eq(savedLineups.userId, ctx.user.id),
            eq(savedLineups.contestId, input.contestId),
            eq(savedLineups.entryNumber, input.entryNumber)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(savedLineups)
          .set({
            champion1TokenId: input.champion1TokenId,
            champion2TokenId: input.champion2TokenId,
            champion3TokenId: input.champion3TokenId,
            champion4TokenId: input.champion4TokenId,
            schemeTokenId: input.schemeTokenId,
            predictedScore: input.predictedScore ? String(input.predictedScore) : null,
            status: input.status,
          })
          .where(eq(savedLineups.id, existing.id));
        return { id: existing.id, updated: true };
      }

      const [result] = await db
        .insert(savedLineups)
        .values({
          userId: ctx.user.id,
          contestId: input.contestId,
          entryNumber: input.entryNumber,
          champion1TokenId: input.champion1TokenId,
          champion2TokenId: input.champion2TokenId,
          champion3TokenId: input.champion3TokenId,
          champion4TokenId: input.champion4TokenId,
          schemeTokenId: input.schemeTokenId,
          predictedScore: input.predictedScore ? String(input.predictedScore) : null,
          status: input.status,
          source: "optimizer",
        })
        .$returningId();

      // Lock cards if submitted
      if (input.status === "submitted") {
        const tokenIds = [
          input.champion1TokenId,
          input.champion2TokenId,
          input.champion3TokenId,
          input.champion4TokenId,
        ];
        if (input.schemeTokenId) tokenIds.push(input.schemeTokenId);

        for (const tokenId of tokenIds) {
          await db
            .insert(cardLockups)
            .values({
              userId: ctx.user.id,
              contestId: input.contestId,
              tokenId,
              entryNumber: input.entryNumber,
            })
            .onDuplicateKeyUpdate({ set: { lockedAt: new Date() } });
        }

        // Log gem spending
        const [contest] = await db
          .select()
          .from(contests)
          .where(eq(contests.id, input.contestId))
          .limit(1);

        if (contest?.entryFee && contest.entryFee > 0) {
          await db.insert(gemSpendingLog).values({
            userId: ctx.user.id,
            contestId: input.contestId,
            amount: contest.entryFee,
            description: `Entry #${input.entryNumber} for ${contest.name}`,
          });
        }
      }

      return { id: result.id, updated: false };
    }),

  /**
   * Get saved lineups for the current user.
   */
  savedLineups: protectedProcedure
    .input(
      z.object({
        contestId: z.number().optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [eq(savedLineups.userId, ctx.user.id)];
      if (input.contestId) {
        conditions.push(eq(savedLineups.contestId, input.contestId));
      }

      return db
        .select()
        .from(savedLineups)
        .where(and(...conditions))
        .orderBy(desc(savedLineups.createdAt))
        .limit(input.limit);
    }),

  // ─── Card Lockups ─────────────────────────────────────────────────

  /**
   * Get active card lockups for the current user.
   */
  lockups: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select({
        id: cardLockups.id,
        tokenId: cardLockups.tokenId,
        contestId: cardLockups.contestId,
        entryNumber: cardLockups.entryNumber,
        lockedAt: cardLockups.lockedAt,
        contestName: contests.name,
        contestStatus: contests.contestStatus,
      })
      .from(cardLockups)
      .innerJoin(contests, eq(cardLockups.contestId, contests.id))
      .where(
        and(eq(cardLockups.userId, ctx.user.id), isNull(cardLockups.unlockedAt))
      )
      .orderBy(desc(cardLockups.lockedAt));
  }),

  /**
   * Unlock cards from a completed contest.
   */
  unlockCards: protectedProcedure
    .input(z.object({ contestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const result = await db
        .update(cardLockups)
        .set({ unlockedAt: new Date() })
        .where(
          and(
            eq(cardLockups.userId, ctx.user.id),
            eq(cardLockups.contestId, input.contestId),
            isNull(cardLockups.unlockedAt)
          )
        );

      return { unlocked: true };
    }),

  // ─── Gem Budget ───────────────────────────────────────────────────

  /**
   * Get today's gem spending summary.
   */
  gemBudget: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { dailyBudget: 5000, spentToday: 0, remaining: 5000, entries: [] };

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    const dailyBudget = user?.dailyGemBudget ?? 5000;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [spentResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(gemSpendingLog)
      .where(
        and(
          eq(gemSpendingLog.userId, ctx.user.id),
          sql`spentAt >= ${todayStart}`
        )
      );

    const spentToday = Number(spentResult?.total ?? 0);

    const recentEntries = await db
      .select()
      .from(gemSpendingLog)
      .where(
        and(
          eq(gemSpendingLog.userId, ctx.user.id),
          sql`spentAt >= ${todayStart}`
        )
      )
      .orderBy(desc(gemSpendingLog.spentAt))
      .limit(20);

    return {
      dailyBudget,
      spentToday,
      remaining: dailyBudget - spentToday,
      entries: recentEntries,
    };
  }),

  // ─── User Settings ────────────────────────────────────────────────

  /**
   * Get user settings.
   */
  settings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    return user
      ? {
          walletAddress: user.walletAddress,
          dailyGemBudget: user.dailyGemBudget,
          telegramChatId: user.telegramChatId,
          telegramAlertsEnabled: user.telegramAlertsEnabled,
        }
      : null;
  }),

  /**
   * Update user settings.
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        walletAddress: z.string().optional(),
        dailyGemBudget: z.number().min(0).max(100000).optional(),
        telegramChatId: z.string().optional(),
        telegramAlertsEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const updates: Record<string, unknown> = {};
      if (input.walletAddress !== undefined) updates.walletAddress = input.walletAddress.toLowerCase();
      if (input.dailyGemBudget !== undefined) updates.dailyGemBudget = input.dailyGemBudget;
      if (input.telegramChatId !== undefined) updates.telegramChatId = input.telegramChatId;
      if (input.telegramAlertsEnabled !== undefined) updates.telegramAlertsEnabled = input.telegramAlertsEnabled;

      if (Object.keys(updates).length > 0) {
        await db.update(users).set(updates).where(eq(users.id, ctx.user.id));
      }

      return { success: true };
    }),
});
