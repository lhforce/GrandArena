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
  fetchSaleHistory,
  getExchangeRates,
  type MarketplacePriceData,
  type ExchangeRates,
  type SaleHistoryData,
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
  // Signal Score (0-100) — composite sell-side liquidity + profit score
  signalScore: number;
  signalLabel: string; // 'Fire' | 'Hot' | 'Warm' | 'Cold'
  // Last sold data at target rarity
  lastSoldPriceRon: number | null;
  lastSoldPriceUsd: number | null;
  lastSoldAt: number | null; // Unix timestamp
  salesLast24h: number;
  salesLast7d: number;
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
  // Signal Score (0-100) — composite sell-side liquidity + profit score
  signalScore: number;
  signalLabel: string; // 'Fire' | 'Hot' | 'Warm' | 'Cold'
  // Last sold data
  lastSoldPriceRon: number | null;
  lastSoldPriceUsd: number | null;
  lastSoldAt: number | null; // Unix timestamp
  salesLast24h: number;
  salesLast7d: number;
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

// ─── Signal Score ──────────────────────────────────────────────────

/**
 * Compute Signal Score (0–100) for a craft arbitrage opportunity.
 *
 * Components:
 *   Profit %              25 pts  (scaled: 0% → 0, 100%+ → 25)
 *   Source supply         20 pts  (fewer buyable listings to acquire = easier)
 *   Sale velocity 7d      25 pts  (5+ sales → 25, 3–4 → 18, 1–2 → 10, 0 → 0)
 *   Days since last sale  15 pts  (<1d → 15, <3d → 10, <7d → 5, >7d → 0)
 *   Sell-side depth       15 pts  (≤5 competing listings → 15, ≤10 → 10, ≤20 → 5, >20 → 0)
 */
function computeSignalScore(
  profitPercent: number,
  sourceBuyableListings: number,
  targetBuyableListings: number,
  saleHistory: SaleHistoryData | null
): { signalScore: number; signalLabel: string } {
  const now = Math.floor(Date.now() / 1000);

  // 1. Profit % (25 pts)
  const profitPts = Math.min(25, (profitPercent / 100) * 25);

  // 2. Source supply tightness (20 pts) — how easy it is to buy the source cards
  let supplyPts = 0;
  if (sourceBuyableListings <= 3) supplyPts = 20;
  else if (sourceBuyableListings <= 5) supplyPts = 15;
  else if (sourceBuyableListings <= 10) supplyPts = 10;
  else if (sourceBuyableListings <= 20) supplyPts = 5;

  // 3. Sale velocity at target rarity (25 pts)
  const salesLast7d = saleHistory?.salesLast7d ?? 0;
  let velocityPts = 0;
  if (salesLast7d >= 5) velocityPts = 25;
  else if (salesLast7d >= 3) velocityPts = 18;
  else if (salesLast7d >= 1) velocityPts = 10;

  // 4. Days since last sale (15 pts)
  let recencyPts = 0;
  if (saleHistory?.lastSoldAt) {
    const daysSince = (now - saleHistory.lastSoldAt) / 86400;
    if (daysSince < 1) recencyPts = 15;
    else if (daysSince < 3) recencyPts = 10;
    else if (daysSince < 7) recencyPts = 5;
  }

  // 5. Sell-side depth at target rarity (15 pts) — fewer competing sellers = faster sale
  let depthPts = 0;
  if (targetBuyableListings <= 5) depthPts = 15;
  else if (targetBuyableListings <= 10) depthPts = 10;
  else if (targetBuyableListings <= 20) depthPts = 5;

  const signalScore = Math.round(profitPts + supplyPts + velocityPts + recencyPts + depthPts);

  let signalLabel: string;
  if (signalScore >= 80) signalLabel = 'Fire';
  else if (signalScore >= 60) signalLabel = 'Hot';
  else if (signalScore >= 40) signalLabel = 'Warm';
  else signalLabel = 'Cold';

  return { signalScore, signalLabel };
}

/**
 * Compute Signal Score for a supply squeeze opportunity.
 *
 * Components:
 *   Profit %              25 pts
 *   Supply tightness      25 pts  (fewer listings = more control)
 *   Sale velocity 7d      25 pts
 *   Days since last sale  15 pts
 *   Buyout affordability  10 pts  (lower buyout cost = lower risk)
 */
function computeSqueezeSignalScore(
  estimatedProfitPercent: number,
  buyableListings: number,
  buyoutCostRon: number,
  saleHistory: SaleHistoryData | null
): { signalScore: number; signalLabel: string } {
  const now = Math.floor(Date.now() / 1000);

  // 1. Profit % (25 pts)
  const profitPts = Math.min(25, (estimatedProfitPercent / 75) * 25);

  // 2. Supply tightness (25 pts)
  let supplyPts = 0;
  if (buyableListings <= 2) supplyPts = 25;
  else if (buyableListings <= 4) supplyPts = 20;
  else if (buyableListings <= 6) supplyPts = 15;
  else if (buyableListings <= 8) supplyPts = 10;
  else supplyPts = 5;

  // 3. Sale velocity at this rarity (25 pts)
  const salesLast7d = saleHistory?.salesLast7d ?? 0;
  let velocityPts = 0;
  if (salesLast7d >= 5) velocityPts = 25;
  else if (salesLast7d >= 3) velocityPts = 18;
  else if (salesLast7d >= 1) velocityPts = 10;

  // 4. Days since last sale (15 pts)
  let recencyPts = 0;
  if (saleHistory?.lastSoldAt) {
    const daysSince = (now - saleHistory.lastSoldAt) / 86400;
    if (daysSince < 1) recencyPts = 15;
    else if (daysSince < 3) recencyPts = 10;
    else if (daysSince < 7) recencyPts = 5;
  }

  // 5. Buyout affordability (10 pts) — lower cost = lower risk
  let affordPts = 0;
  if (buyoutCostRon <= 50) affordPts = 10;
  else if (buyoutCostRon <= 200) affordPts = 7;
  else if (buyoutCostRon <= 500) affordPts = 4;

  const signalScore = Math.round(profitPts + supplyPts + velocityPts + recencyPts + affordPts);

  let signalLabel: string;
  if (signalScore >= 80) signalLabel = 'Fire';
  else if (signalScore >= 60) signalLabel = 'Hot';
  else if (signalScore >= 40) signalLabel = 'Warm';
  else signalLabel = 'Cold';

  return { signalScore, signalLabel };
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
 * Accepts a saleHistoryMap keyed by rarity for signal score computation.
 */
function calculateCraftArbitrage(
  championName: string,
  prices: Record<string, MarketplacePriceData>,
  rates: ExchangeRates,
  saleHistoryMap: Record<string, SaleHistoryData> = {}
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

    // Sale history for the target rarity (the card we plan to sell)
    const targetSaleHistory = saleHistoryMap[craftPath.targetRarity] ?? null;

    const { signalScore, signalLabel } = computeSignalScore(
      profitPercent,
      sourceData.buyableListings,
      targetData.buyableListings,
      targetSaleHistory
    );

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
      signalScore,
      signalLabel,
      lastSoldPriceRon: targetSaleHistory?.lastSoldPriceRon ?? null,
      lastSoldPriceUsd: targetSaleHistory?.lastSoldPriceUsd ?? null,
      lastSoldAt: targetSaleHistory?.lastSoldAt ?? null,
      salesLast24h: targetSaleHistory?.salesLast24h ?? 0,
      salesLast7d: targetSaleHistory?.salesLast7d ?? 0,
    });
  }

  return opportunities;
}

// ─── Supply Squeeze Detector ────────────────────────────────────────

const SQUEEZE_MAX_LISTINGS = 10; // Cards with ≤10 listings are squeeze candidates
const SQUEEZE_RELIST_MULTIPLIER = 1.75; // Estimated relist at 1.75x floor after buyout

/**
 * Detect supply squeeze opportunities for a champion.
 * Accepts a saleHistoryMap keyed by rarity for signal score computation.
 */
function detectSupplySqueeze(
  championName: string,
  prices: Record<string, MarketplacePriceData>,
  rates: ExchangeRates,
  saleHistoryMap: Record<string, SaleHistoryData> = {}
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

    // Sale history for this rarity
    const saleHistory = saleHistoryMap[rarity] ?? null;

    const { signalScore, signalLabel } = computeSqueezeSignalScore(
      estimatedProfitPercent,
      data.buyableListings,
      data.buyoutCostRon,
      saleHistory
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
      signalScore,
      signalLabel,
      lastSoldPriceRon: saleHistory?.lastSoldPriceRon ?? null,
      lastSoldPriceUsd: saleHistory?.lastSoldPriceUsd ?? null,
      lastSoldAt: saleHistory?.lastSoldAt ?? null,
      salesLast24h: saleHistory?.salesLast24h ?? 0,
      salesLast7d: saleHistory?.salesLast7d ?? 0,
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

          // Determine which rarities we need sale history for:
          // - Target rarities of craft opportunities (to check sell-side liquidity)
          // - Rarities with squeeze potential (to check buy-side demand)
          const raritiesNeeded = new Set<string>();

          // Check craft paths to find which target rarities are relevant
          for (const craftPath of CRAFT_PATHS) {
            const sourceData = prices[craftPath.sourceRarity];
            const targetData = prices[craftPath.targetRarity];
            if (sourceData?.floorPriceRon && targetData?.floorPriceRon &&
                sourceData.buyableListings >= craftPath.cardsNeeded) {
              raritiesNeeded.add(craftPath.targetRarity);
            }
          }

          // Check squeeze candidates
          for (const rarity of ["Basic", "Rare", "Epic", "Legendary"]) {
            const data = prices[rarity];
            if (data?.floorPriceRon && data.buyableListings >= 1 &&
                data.buyableListings <= SQUEEZE_MAX_LISTINGS) {
              raritiesNeeded.add(rarity);
            }
          }

          // Fetch sale history for each needed rarity
          const saleHistoryMap: Record<string, SaleHistoryData> = {};
          for (const rarity of Array.from(raritiesNeeded)) {
            try {
              saleHistoryMap[rarity] = await fetchSaleHistory(name, rarity);
              await sleep(150); // Small delay between sale history calls
            } catch (err) {
              console.warn(`[Arbitrage] Sale history failed for ${name} ${rarity}:`, (err as Error).message);
            }
          }

          const craftOpps = calculateCraftArbitrage(name, prices, rates, saleHistoryMap);
          const squeezeOpps = detectSupplySqueeze(name, prices, rates, saleHistoryMap);

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
          imageUrl: data.imageUrl ?? null,
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
            imageUrl: data.imageUrl ?? null,
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
        signalScore: opp.signalScore,
        signalLabel: opp.signalLabel,
        lastSoldPriceRon: opp.lastSoldPriceRon != null ? String(opp.lastSoldPriceRon) : null,
        lastSoldPriceUsd: opp.lastSoldPriceUsd != null ? String(opp.lastSoldPriceUsd) : null,
        lastSoldAt: opp.lastSoldAt,
        salesLast24h: opp.salesLast24h,
        salesLast7d: opp.salesLast7d,
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
    signalScore: r.signalScore || 0,
    signalLabel: r.signalLabel || 'Cold',
    lastSoldPriceRon: r.lastSoldPriceRon != null ? Number(r.lastSoldPriceRon) : null,
    lastSoldPriceUsd: r.lastSoldPriceUsd != null ? Number(r.lastSoldPriceUsd) : null,
    lastSoldAt: r.lastSoldAt ?? null,
    salesLast24h: r.salesLast24h || 0,
    salesLast7d: r.salesLast7d || 0,
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
