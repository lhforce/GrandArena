/**
 * Arbitrage Router — tRPC procedures for Card Arbitrage feature.
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  runArbitrageScan,
  getCachedArbitrageOpportunities,
  getCachedPrices,
  getPriceHistory,
  getScanProgress,
} from "./arbitrageCalculator";
import {
  fetchMarketplacePrice,
  fetchAllRarityPrices,
  getExchangeRates,
} from "./marketplaceClient";
import { getDb } from "./db";
import { marketplacePrices, arbitrageOpportunities } from "../drizzle/schema";
import { desc, sql } from "drizzle-orm";

export const arbitrageRouter = router({
  /**
   * Get cached arbitrage opportunities from last scan.
   */
  getOpportunities: publicProcedure.query(async () => {
    const opportunities = await getCachedArbitrageOpportunities();
    const progress = getScanProgress();
    
    // Get last scan time from DB
    const db = await getDb();
    let lastScanAt: string | null = null;
    if (db) {
      const [latest] = await db
        .select({ calculatedAt: arbitrageOpportunities.calculatedAt })
        .from(arbitrageOpportunities)
        .orderBy(desc(arbitrageOpportunities.calculatedAt))
        .limit(1);
      if (latest) lastScanAt = latest.calculatedAt.toISOString();
    }

    return {
      opportunities,
      lastScanAt,
      scanInProgress: progress.inProgress,
      scanProgress: progress,
    };
  }),

  /**
   * Get supply squeeze opportunities (low-supply cards).
   */
  getSqueezeOpportunities: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { opportunities: [] };

    // Get cards with ≤10 buyable listings from cached prices
    const rows = await db
      .select()
      .from(marketplacePrices)
      .where(sql`${marketplacePrices.buyableListings} > 0 AND ${marketplacePrices.buyableListings} <= 10`)
      .orderBy(marketplacePrices.buyableListings);

    const rates = await getExchangeRates();
    const RELIST_MULTIPLIER = 1.75;
    const FEE = 0.0425;

    const opportunities = rows
      .filter((r) => Number(r.buyoutCostRon) > 0 && Number(r.floorPriceRon) > 0)
      .map((r) => {
        const buyoutCostRon = Number(r.buyoutCostRon) || 0;
        const floorRon = Number(r.floorPriceRon) || 0;
        const relistRon = floorRon * RELIST_MULTIPLIER;
        const revenue = relistRon * (r.buyableListings || 0) * (1 - FEE);
        const profitRon = revenue - buyoutCostRon;
        const profitPct = buyoutCostRon > 0 ? (profitRon / buyoutCostRon) * 100 : 0;
        const score = Math.round(profitPct * (11 - (r.buyableListings || 0)) / 10);

        return {
          championName: r.championName,
          rarity: r.rarity,
          totalListings: r.totalListings || 0,
          buyableListings: r.buyableListings || 0,
          buyoutCostRon: Math.round(buyoutCostRon * 100) / 100,
          buyoutCostUsd: Math.round(buyoutCostRon * rates.ronUsd * 100) / 100,
          floorPriceRon: Math.round(floorRon * 100) / 100,
          floorPriceUsd: Math.round(floorRon * rates.ronUsd * 100) / 100,
          estimatedRelistRon: Math.round(relistRon * 100) / 100,
          estimatedRelistUsd: Math.round(relistRon * rates.ronUsd * 100) / 100,
          estimatedProfitRon: Math.round(profitRon * 100) / 100,
          estimatedProfitUsd: Math.round(profitRon * rates.ronUsd * 100) / 100,
          estimatedProfitPercent: Math.round(profitPct * 10) / 10,
          squeezeScore: score,
        };
      })
      .filter((o) => o.estimatedProfitPercent > 0)
      .sort((a, b) => b.squeezeScore - a.squeezeScore);

    return { opportunities };
  }),

  /**
   * Trigger a full arbitrage scan (all champions).
   */
  triggerScan: publicProcedure.mutation(async () => {
    // Run in background, don't await
    runArbitrageScan().catch((err) => {
      console.error("[Arbitrage] Scan failed:", err);
    });
    return { started: true, message: "Arbitrage scan started in background" };
  }),

  /**
   * Trigger a targeted scan for specific champions.
   */
  triggerTargetedScan: publicProcedure
    .input(z.object({ championNames: z.array(z.string()).min(1).max(20) }))
    .mutation(async ({ input }) => {
      runArbitrageScan(input.championNames).catch((err) => {
        console.error("[Arbitrage] Targeted scan failed:", err);
      });
      return { started: true, champions: input.championNames.length };
    }),

  /**
   * Get scan progress.
   */
  getScanProgress: publicProcedure.query(() => {
    return getScanProgress();
  }),

  /**
   * Get live marketplace prices for a specific champion (real-time, not cached).
   */
  getLivePrices: publicProcedure
    .input(z.object({ championName: z.string() }))
    .query(async ({ input }) => {
      const prices = await fetchAllRarityPrices(input.championName);
      const rates = await getExchangeRates();
      return { prices, rates };
    }),

  /**
   * Get cached marketplace prices for a champion.
   */
  getCachedPrices: publicProcedure
    .input(z.object({ championName: z.string() }))
    .query(async ({ input }) => {
      const prices = await getCachedPrices(input.championName);
      return { prices };
    }),

  /**
   * Get price history for a champion at a rarity.
   */
  getPriceHistory: publicProcedure
    .input(z.object({ championName: z.string(), rarity: z.string(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      const history = await getPriceHistory(input.championName, input.rarity, input.limit || 24);
      return { history };
    }),

  /**
   * Get current exchange rates.
   */
  getExchangeRates: publicProcedure.query(async () => {
    const rates = await getExchangeRates();
    return rates;
  }),

  /**
   * Get marketplace overview stats.
   */
  getOverview: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalPricesTracked: 0, totalOpportunities: 0, avgProfitPercent: 0 };

    const [priceCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(marketplacePrices);

    const [oppCount] = await db
      .select({
        count: sql<number>`COUNT(*)`,
        avgProfit: sql<number>`AVG(CAST(${arbitrageOpportunities.profitPercent} AS DECIMAL(8,2)))`,
      })
      .from(arbitrageOpportunities);

    return {
      totalPricesTracked: priceCount?.count || 0,
      totalOpportunities: oppCount?.count || 0,
      avgProfitPercent: Math.round((oppCount?.avgProfit || 0) * 10) / 10,
    };
  }),
});
