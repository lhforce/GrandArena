/**
 * Arbitrage Calculator — Profit-focused craft-up analysis and supply squeeze detection.
 *
 * Two strategies:
 * 1. Craft Arbitrage: Buy low-rarity cards at floor → craft up → sell at higher rarity for profit
 * 2. Supply Squeeze: Identify low-supply cards, calculate buyout cost, estimate relist markup
 *
 * All calculations exclude outlier listings (>3x median) via marketplaceClient.
 */

import {
  fetchMarketplacePrice,
  fetchAllRarityPrices,
  getExchangeRates,
  type MarketplacePriceData,
  type ExchangeRates,
} from "./marketplaceClient";
import { getDb } from "./db";
import {
  marketplacePrices,
  marketplacePriceHistory,
  arbitrageOpportunities,
  exchangeRates as exchangeRatesTable,
} from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";

// Crafting ratios
const BASICS_PER_RARE = 3;
const RARES_PER_EPIC = 10;
const EPICS_PER_LEGENDARY = 8;

// Derived multi-step costs
const BASICS_PER_EPIC = BASICS_PER_RARE * RARES_PER_EPIC; // 30
const RARES_PER_LEGENDARY = RARES_PER_EPIC * EPICS_PER_LEGENDARY; // 80
const BASICS_PER_LEGENDARY = BASICS_PER_RARE * RARES_PER_LEGENDARY; // 240

// Marketplace fee (4.25% royalty + platform fee on Ronin Marketplace)
const MARKETPLACE_FEE_PERCENT = 4.25;

// ─── Types ──────────────────────────────────────────────────────────

export interface CraftArbitrageOpportunity {
  championName: string;
  targetRarity: string; // Rare, Epic, Legendary
  sourceRarity: string; // Basic, Rare, Epic
  sourceFloorRon: number;
  sourceFloorUsd: number;
  cardsNeeded: number;
  totalCraftCostRon: number;
  totalCraftCostUsd: number;
  sellPriceRon: number;
  sellPriceUsd: number;
  // After marketplace fee
  netSellPriceRon: number;
  netSellPriceUsd: number;
  profitRon: number;
  profitUsd: number;
  profitPercent: number;
  // Listing info
  sourceBuyableListings: number;
  sourceTotalListings: number;
  targetBuyableListings: number;
  targetTotalListings: number;
  // Hot signals
  hotSignal: string | null;
  hotScore: number;
}

export interface SupplySqueezeOpportunity {
  championName: string;
  rarity: string;
  totalListings: number;
  buyableListings: number;
  buyoutCostRon: number;
  buyoutCostUsd: number;
  floorPriceRon: number;
  floorPriceUsd: number;
  // Estimated relist price (1.5x-2x floor after buyout)
  estimatedRelistRon: number;
  estimatedRelistUsd: number;
  estimatedProfitRon: number;
  estimatedProfitUsd: number;
  estimatedProfitPercent: number;
  squeezeScore: number; // Lower supply + higher demand = higher score
}

export interface ArbitrageScanResult {
  craftOpportunities: CraftArbitrageOpportunity[];
  squeezeOpportunities: SupplySqueezeOpportunity[];
  scannedChampions: number;
  scanDurationMs: number;
  rates: ExchangeRates;
  scannedAt: string;
}

// ─── Champion List ──────────────────────────────────────────────────

function loadAllChampionNames(): string[] {
  const gameDataPath = path.resolve(process.cwd(), "client/public/game-data.json");
  const raw = fs.readFileSync(gameDataPath, "utf-8");
  const data = JSON.parse(raw) as {
    champions?: Array<{ name: string }>;
    schemes?: Array<{ qualifyingChampions: Array<{ name: string }> }>;
  };

  // Get unique champion names from the champions array or from schemes
  const names = new Set<string>();
  if (data.champions) {
    for (const c of data.champions) names.add(c.name);
  }
  if (data.schemes) {
    for (const s of data.schemes) {
      for (const c of s.qualifyingChampions) names.add(c.name);
    }
  }
  return Array.from(names);
}

// ─── Craft Arbitrage Calculator ─────────────────────────────────────

interface CraftPath {
  targetRarity: string;
  sourceRarity: string;
  cardsNeeded: number;
}

const CRAFT_PATHS: CraftPath[] = [
  { targetRarity: "Rare", sourceRarity: "Basic", cardsNeeded: BASICS_PER_RARE },
  { targetRarity: "Epic", sourceRarity: "Rare", cardsNeeded: RARES_PER_EPIC },
  { targetRarity: "Epic", sourceRarity: "Basic", cardsNeeded: BASICS_PER_EPIC },
  { targetRarity: "Legendary", sourceRarity: "Epic", cardsNeeded: EPICS_PER_LEGENDARY },
  { targetRarity: "Legendary", sourceRarity: "Rare", cardsNeeded: RARES_PER_LEGENDARY },
  { targetRarity: "Legendary", sourceRarity: "Basic", cardsNeeded: BASICS_PER_LEGENDARY },
];

/**
 * Calculate craft arbitrage for a single champion across all craft paths.
 */
function calculateCraftArbitrage(
  championName: string,
  prices: Record<string, MarketplacePriceData>,
  rates: ExchangeRates
): CraftArbitrageOpportunity[] {
  const opportunities: CraftArbitrageOpportunity[] = [];

  for (const craftPath of CRAFT_PATHS) {
    const sourceData = prices[craftPath.sourceRarity];
    const targetData = prices[craftPath.targetRarity];

    if (!sourceData?.floorPriceRon || !targetData?.floorPriceRon) continue;
    if (sourceData.buyableListings < craftPath.cardsNeeded) continue; // Not enough supply to craft

    const totalCraftCostRon = sourceData.floorPriceRon * craftPath.cardsNeeded;
    const totalCraftCostUsd = totalCraftCostRon * rates.ronUsd;

    const sellPriceRon = targetData.floorPriceRon;
    const sellPriceUsd = sellPriceRon * rates.ronUsd;

    // Net sell price after marketplace fee
    const feeMultiplier = 1 - MARKETPLACE_FEE_PERCENT / 100;
    const netSellPriceRon = sellPriceRon * feeMultiplier;
    const netSellPriceUsd = netSellPriceRon * rates.ronUsd;

    const profitRon = netSellPriceRon - totalCraftCostRon;
    const profitUsd = profitRon * rates.ronUsd;
    const profitPercent = totalCraftCostRon > 0 ? (profitRon / totalCraftCostRon) * 100 : 0;

    // Only include profitable opportunities
    if (profitPercent <= 0) continue;

    opportunities.push({
      championName,
      targetRarity: craftPath.targetRarity,
      sourceRarity: craftPath.sourceRarity,
      sourceFloorRon: sourceData.floorPriceRon,
      sourceFloorUsd: sourceData.floorPriceRon * rates.ronUsd,
      cardsNeeded: craftPath.cardsNeeded,
      totalCraftCostRon: Math.round(totalCraftCostRon * 100) / 100,
      totalCraftCostUsd: Math.round(totalCraftCostUsd * 100) / 100,
      sellPriceRon: Math.round(sellPriceRon * 100) / 100,
      sellPriceUsd: Math.round(sellPriceUsd * 100) / 100,
      netSellPriceRon: Math.round(netSellPriceRon * 100) / 100,
      netSellPriceUsd: Math.round(netSellPriceUsd * 100) / 100,
      profitRon: Math.round(profitRon * 100) / 100,
      profitUsd: Math.round(profitUsd * 100) / 100,
      profitPercent: Math.round(profitPercent * 10) / 10,
      sourceBuyableListings: sourceData.buyableListings,
      sourceTotalListings: sourceData.totalListings,
      targetBuyableListings: targetData.buyableListings,
      targetTotalListings: targetData.totalListings,
      hotSignal: null,
      hotScore: 0,
    });
  }

  return opportunities;
}

// ─── Supply Squeeze Detector ────────────────────────────────────────

const SQUEEZE_MAX_LISTINGS = 10; // Cards with ≤10 listings are squeeze candidates
const SQUEEZE_RELIST_MULTIPLIER = 1.75; // Estimated relist at 1.75x floor after buyout

/**
 * Detect supply squeeze opportunities for a champion.
 */
function detectSupplySqueeze(
  championName: string,
  prices: Record<string, MarketplacePriceData>,
  rates: ExchangeRates
): SupplySqueezeOpportunity[] {
  const opportunities: SupplySqueezeOpportunity[] = [];

  for (const rarity of ["Basic", "Rare", "Epic", "Legendary"]) {
    const data = prices[rarity];
    if (!data || !data.floorPriceRon || !data.buyoutCostRon) continue;

    // Only flag low-supply cards
    if (data.buyableListings > SQUEEZE_MAX_LISTINGS || data.buyableListings < 1) continue;

    const estimatedRelistRon = data.floorPriceRon * SQUEEZE_RELIST_MULTIPLIER;
    const estimatedRelistUsd = estimatedRelistRon * rates.ronUsd;

    // Revenue from relisting all bought cards at markup (minus marketplace fee)
    const feeMultiplier = 1 - MARKETPLACE_FEE_PERCENT / 100;
    const totalRelistRevenue = estimatedRelistRon * data.buyableListings * feeMultiplier;
    const estimatedProfitRon = totalRelistRevenue - data.buyoutCostRon;
    const estimatedProfitUsd = estimatedProfitRon * rates.ronUsd;
    const estimatedProfitPercent = data.buyoutCostRon > 0
      ? (estimatedProfitRon / data.buyoutCostRon) * 100
      : 0;

    // Only include profitable squeezes
    if (estimatedProfitPercent <= 0) continue;

    // Score: lower supply + higher profit % = better opportunity
    const squeezeScore = Math.round(
      (estimatedProfitPercent * (SQUEEZE_MAX_LISTINGS - data.buyableListings + 1)) / 10
    );

    opportunities.push({
      championName,
      rarity,
      totalListings: data.totalListings,
      buyableListings: data.buyableListings,
      buyoutCostRon: Math.round(data.buyoutCostRon * 100) / 100,
      buyoutCostUsd: Math.round((data.buyoutCostRon * rates.ronUsd) * 100) / 100,
      floorPriceRon: Math.round(data.floorPriceRon * 100) / 100,
      floorPriceUsd: Math.round((data.floorPriceRon * rates.ronUsd) * 100) / 100,
      estimatedRelistRon: Math.round(estimatedRelistRon * 100) / 100,
      estimatedRelistUsd: Math.round(estimatedRelistUsd * 100) / 100,
      estimatedProfitRon: Math.round(estimatedProfitRon * 100) / 100,
      estimatedProfitUsd: Math.round(estimatedProfitUsd * 100) / 100,
      estimatedProfitPercent: Math.round(estimatedProfitPercent * 10) / 10,
      squeezeScore,
    });
  }

  return opportunities;
}

// ─── Full Arbitrage Scan ────────────────────────────────────────────

// Scan state for progress tracking
let scanInProgress = false;
let scanProgress = { current: 0, total: 0, startedAt: 0 };

export function getScanProgress() {
  return { ...scanProgress, inProgress: scanInProgress };
}

/**
 * Run a full arbitrage scan across all champions.
 * Fetches marketplace prices, calculates craft arbitrage and supply squeeze.
 */
export async function runArbitrageScan(
  championNames?: string[]
): Promise<ArbitrageScanResult> {
  if (scanInProgress) {
    throw new Error("Arbitrage scan already in progress");
  }

  scanInProgress = true;
  const startTime = Date.now();
  const names = championNames || loadAllChampionNames();
  scanProgress = { current: 0, total: names.length, startedAt: startTime };

  const allCraftOpps: CraftArbitrageOpportunity[] = [];
  const allSqueezeOpps: SupplySqueezeOpportunity[] = [];

  try {
    const rates = await getExchangeRates();

    // Process champions in batches of 3 to avoid rate limiting
    const batchSize = 3;
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);

      const batchPromises = batch.map(async (name) => {
        try {
          const prices = await fetchAllRarityPrices(name);

          const craftOpps = calculateCraftArbitrage(name, prices, rates);
          const squeezeOpps = detectSupplySqueeze(name, prices, rates);

          return { craftOpps, squeezeOpps, prices, name };
        } catch (err) {
          console.warn(`[Arbitrage] Failed to scan ${name}:`, (err as Error).message);
          return { craftOpps: [], squeezeOpps: [], prices: {}, name };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        allCraftOpps.push(...result.craftOpps);
        allSqueezeOpps.push(...result.squeezeOpps);

        // Save price data to database
        await savePriceData(result.name, result.prices, rates);
      }

      scanProgress.current = Math.min(i + batchSize, names.length);

      // Rate limit between batches
      if (i + batchSize < names.length) {
        await sleep(300);
      }
    }

    // Sort by profit
    allCraftOpps.sort((a, b) => b.profitPercent - a.profitPercent);
    allSqueezeOpps.sort((a, b) => b.squeezeScore - a.squeezeScore);

    // Save opportunities to database
    await saveArbitrageOpportunities(allCraftOpps);

    // Save exchange rates
    await saveExchangeRates(rates);

    const result: ArbitrageScanResult = {
      craftOpportunities: allCraftOpps,
      squeezeOpportunities: allSqueezeOpps,
      scannedChampions: names.length,
      scanDurationMs: Date.now() - startTime,
      rates,
      scannedAt: new Date().toISOString(),
    };

    console.log(
      `[Arbitrage] Scan complete: ${names.length} champions, ` +
      `${allCraftOpps.length} craft opportunities, ` +
      `${allSqueezeOpps.length} squeeze opportunities, ` +
      `${Math.round(result.scanDurationMs / 1000)}s`
    );

    return result;
  } finally {
    scanInProgress = false;
    scanProgress = { current: 0, total: 0, startedAt: 0 };
  }
}

// ─── Database Persistence ───────────────────────────────────────────

async function savePriceData(
  championName: string,
  prices: Record<string, MarketplacePriceData>,
  rates: ExchangeRates
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  for (const [rarity, data] of Object.entries(prices)) {
    if (!data.floorPriceRon) continue;

    try {
      // Upsert current price
      await db
        .insert(marketplacePrices)
        .values({
          championName,
          rarity,
          floorPriceRon: String(data.floorPriceRon),
          floorPriceUsd: String(data.floorPriceUsd || 0),
          medianPriceRon: data.medianPriceRon ? String(data.medianPriceRon) : null,
          buyoutCostRon: data.buyoutCostRon ? String(data.buyoutCostRon) : null,
          buyoutCostUsd: data.buyoutCostUsd ? String(data.buyoutCostUsd) : null,
          paymentToken: "RON",
          buyableListings: data.buyableListings,
          totalListings: data.totalListings,
          outlierCount: data.outlierCount,
          allPricesJson: JSON.stringify(data.listings),
        })
        .onDuplicateKeyUpdate({
          set: {
            floorPriceRon: String(data.floorPriceRon),
            floorPriceUsd: String(data.floorPriceUsd || 0),
            medianPriceRon: data.medianPriceRon ? String(data.medianPriceRon) : null,
            buyoutCostRon: data.buyoutCostRon ? String(data.buyoutCostRon) : null,
            buyoutCostUsd: data.buyoutCostUsd ? String(data.buyoutCostUsd) : null,
            buyableListings: data.buyableListings,
            totalListings: data.totalListings,
            outlierCount: data.outlierCount,
            allPricesJson: JSON.stringify(data.listings),
            fetchedAt: new Date(),
          },
        });

      // Insert price history snapshot
      await db.insert(marketplacePriceHistory).values({
        championName,
        rarity,
        floorPriceRon: String(data.floorPriceRon),
        floorPriceUsd: String(data.floorPriceUsd || 0),
      });
    } catch (err) {
      console.warn(`[Arbitrage] Failed to save price for ${championName} ${rarity}:`, (err as Error).message);
    }
  }
}

async function saveArbitrageOpportunities(
  opportunities: CraftArbitrageOpportunity[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Clear old opportunities
  await db.delete(arbitrageOpportunities);

  // Insert new ones (top 100)
  const top = opportunities.slice(0, 100);
  for (const opp of top) {
    try {
      await db.insert(arbitrageOpportunities).values({
        championName: opp.championName,
        targetRarity: opp.targetRarity,
        sourceRarity: opp.sourceRarity,
        sourceFloorUsd: String(opp.sourceFloorUsd),
        cardsNeeded: opp.cardsNeeded,
        totalCraftCostUsd: String(opp.totalCraftCostUsd),
        sellPriceUsd: String(opp.sellPriceUsd),
        profitUsd: String(opp.profitUsd),
        profitPercent: String(opp.profitPercent),
        hotSignal: opp.hotSignal,
        hotScore: opp.hotScore,
        buyableListings: opp.sourceBuyableListings,
        totalListings: opp.sourceTotalListings,
      });
    } catch (err) {
      console.warn(`[Arbitrage] Failed to save opportunity for ${opp.championName}:`, (err as Error).message);
    }
  }
}

async function saveExchangeRates(rates: ExchangeRates): Promise<void> {
  const db = await getDb();
  if (!db) return;

  for (const [token, rate] of [["RON", rates.ronUsd], ["WETH", rates.wethUsd]] as const) {
    try {
      await db
        .insert(exchangeRatesTable)
        .values({ token, usdRate: String(rate) })
        .onDuplicateKeyUpdate({ set: { usdRate: String(rate), lastUpdatedAt: new Date() } });
    } catch (err) {
      console.warn(`[Arbitrage] Failed to save ${token} rate:`, (err as Error).message);
    }
  }
}

// ─── Get Cached Data ────────────────────────────────────────────────

/**
 * Get the latest arbitrage opportunities from the database.
 */
export async function getCachedArbitrageOpportunities(): Promise<CraftArbitrageOpportunity[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(arbitrageOpportunities)
    .orderBy(desc(arbitrageOpportunities.profitPercent))
    .limit(100);

  return rows.map((r) => ({
    championName: r.championName,
    targetRarity: r.targetRarity,
    sourceRarity: r.sourceRarity || "",
    sourceFloorRon: 0, // Not stored in DB, recalculate if needed
    sourceFloorUsd: Number(r.sourceFloorUsd) || 0,
    cardsNeeded: r.cardsNeeded || 0,
    totalCraftCostRon: 0,
    totalCraftCostUsd: Number(r.totalCraftCostUsd) || 0,
    sellPriceRon: 0,
    sellPriceUsd: Number(r.sellPriceUsd) || 0,
    netSellPriceRon: 0,
    netSellPriceUsd: 0,
    profitRon: 0,
    profitUsd: Number(r.profitUsd) || 0,
    profitPercent: Number(r.profitPercent) || 0,
    sourceBuyableListings: r.buyableListings || 0,
    sourceTotalListings: r.totalListings || 0,
    targetBuyableListings: 0,
    targetTotalListings: 0,
    hotSignal: r.hotSignal,
    hotScore: r.hotScore || 0,
  }));
}

/**
 * Get cached marketplace prices for a specific champion.
 */
export async function getCachedPrices(
  championName: string
): Promise<Record<string, MarketplacePriceData> | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(marketplacePrices)
    .where(eq(marketplacePrices.championName, championName));

  if (rows.length === 0) return null;

  const result: Record<string, MarketplacePriceData> = {};
  for (const row of rows) {
    result[row.rarity] = {
      championName: row.championName,
      rarity: row.rarity,
      floorPriceRon: Number(row.floorPriceRon) || null,
      floorPriceUsd: Number(row.floorPriceUsd) || null,
      medianPriceRon: Number(row.medianPriceRon) || null,
      buyoutCostRon: Number(row.buyoutCostRon) || null,
      buyoutCostUsd: Number(row.buyoutCostUsd) || null,
      buyableListings: row.buyableListings || 0,
      totalListings: row.totalListings || 0,
      outlierCount: row.outlierCount || 0,
      listings: row.allPricesJson ? JSON.parse(row.allPricesJson) : [],
    };
  }

  return result;
}

/**
 * Get price history for a champion at a rarity.
 */
export async function getPriceHistory(
  championName: string,
  rarity: string,
  limit: number = 24
): Promise<Array<{ floorPriceRon: number; floorPriceUsd: number; snapshotAt: Date }>> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(marketplacePriceHistory)
    .where(
      and(
        eq(marketplacePriceHistory.championName, championName),
        eq(marketplacePriceHistory.rarity, rarity)
      )
    )
    .orderBy(desc(marketplacePriceHistory.snapshotAt))
    .limit(limit);

  return rows.map((r) => ({
    floorPriceRon: Number(r.floorPriceRon) || 0,
    floorPriceUsd: Number(r.floorPriceUsd) || 0,
    snapshotAt: r.snapshotAt,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
