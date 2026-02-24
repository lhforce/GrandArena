/**
 * Card Crafter — Multi-rarity Acquisition Advisor
 *
 * Ranks the best MOKIs for a given scheme by avg score then win%,
 * checks which ones the user already owns at the target rarity,
 * fetches Ronin Marketplace floor prices for all rarities,
 * and calculates the most economical path to acquiring the target rarity card.
 *
 * Crafting ratios (free to craft, no gem cost):
 *   3 Basic  → 1 Rare
 *   10 Rare  → 1 Epic
 *   8 Epic   → 1 Legendary
 */

import { getDb } from "./db";
import { matchPlayerStats, matchHistory, userCards } from "../drizzle/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";

const GRAPHQL_URL = "https://marketplace-graphql.skymavis.com/graphql";
const GA_CARDS_CONTRACT = "0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b";
const SEASON_1_START = new Date("2026-02-19T00:00:00Z");

// Crafting ratios
const BASICS_PER_RARE = 3;
const RARES_PER_EPIC = 10;
const EPICS_PER_LEGENDARY = 8;

// Derived totals
const RARES_FOR_LEGENDARY = RARES_PER_EPIC * EPICS_PER_LEGENDARY; // 80
const BASICS_FOR_LEGENDARY = BASICS_PER_RARE * RARES_FOR_LEGENDARY; // 240
const BASICS_FOR_EPIC = BASICS_PER_RARE * RARES_PER_EPIC; // 30

type TargetRarity = "Rare" | "Epic" | "Legendary";

interface ChampionRanking {
  championTokenId: string;
  name: string;
  avgScore: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  totalMatches: number;
  rank: number;
}

interface PriceData {
  Basic: number | null;
  Rare: number | null;
  Epic: number | null;
  Legendary: number | null;
}

interface AcquisitionOption {
  method: string;
  label: string;
  totalCostRON: number | null;
  cardsNeeded: number;
  unitPrice: number | null;
  available: boolean;
}

export interface CardCrafterEntry {
  rank: number;
  championTokenId: string;
  name: string;
  avgScore: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  totalMatches: number;
  ownsTarget: boolean;
  ownedRarity: string | null; // highest rarity owned
  acquisitionOptions: AcquisitionOption[];
  cheapestOption: AcquisitionOption | null;
  cheapestCostRON: number | null;
}

export interface CardCrafterResult {
  schemeName: string;
  targetRarity: TargetRarity;
  topChampions: CardCrafterEntry[];
  totalTargetOwned: number;
  fetchedAt: string;
}

// Keep backward compat aliases
export type LegendaryAdvisorEntry = CardCrafterEntry;
export type LegendaryAdvisorResult = CardCrafterResult;

// ─── Marketplace Pricing ──────────────────────────────────────────────

async function gqlFetch(query: string): Promise<unknown> {
  const resp = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (data.errors) throw new Error(data.errors[0]?.message ?? "GraphQL error");
  return data.data;
}

async function fetchFloorPrices(championName: string): Promise<PriceData> {
  const rarities = ["Basic", "Rare", "Epic", "Legendary"] as const;
  const prices: PriceData = { Basic: null, Rare: null, Epic: null, Legendary: null };

  await Promise.all(
    rarities.map(async (rarity) => {
      const query = `{
        erc721Tokens(
          tokenAddress: "${GA_CARDS_CONTRACT}",
          from: 0,
          size: 1,
          sort: PriceAsc,
          auctionType: Sale,
          criteria: [
            {name: "Card Type", values: ["MOKI"]},
            {name: "Rarity", values: ["${rarity}"]}
          ],
          name: "${championName.replace(/"/g, '\\"')}"
        ) {
          results {
            order {
              currentPrice
            }
          }
        }
      }`;
      try {
        const data = await gqlFetch(query) as {
          erc721Tokens: {
            results: Array<{
              order: { currentPrice: string } | null;
            }>;
          };
        };
        const r = data.erc721Tokens.results;
        if (r.length > 0 && r[0]?.order?.currentPrice) {
          const price = Number(BigInt(r[0].order.currentPrice)) / 1e18;
          prices[rarity] = Math.round(price * 100) / 100;
        }
      } catch {
        // Price unavailable for this rarity
      }
    })
  );

  return prices;
}

// ─── Acquisition Cost Calculator ─────────────────────────────────────

function calculateAcquisitionOptions(prices: PriceData, targetRarity: TargetRarity): AcquisitionOption[] {
  const options: AcquisitionOption[] = [];

  if (targetRarity === "Rare") {
    // Option 1: Buy Rare directly
    options.push({
      method: "buy_rare",
      label: "Buy Rare directly",
      totalCostRON: prices.Rare,
      cardsNeeded: 1,
      unitPrice: prices.Rare,
      available: prices.Rare !== null,
    });

    // Option 2: Buy 3 Basics → craft 1 Rare
    const craftFromBasicCost = prices.Basic !== null ? prices.Basic * BASICS_PER_RARE : null;
    options.push({
      method: "craft_from_basic",
      label: `Buy ${BASICS_PER_RARE} Basics → craft Rare`,
      totalCostRON: craftFromBasicCost,
      cardsNeeded: BASICS_PER_RARE,
      unitPrice: prices.Basic,
      available: prices.Basic !== null,
    });
  } else if (targetRarity === "Epic") {
    // Option 1: Buy Epic directly
    options.push({
      method: "buy_epic",
      label: "Buy Epic directly",
      totalCostRON: prices.Epic,
      cardsNeeded: 1,
      unitPrice: prices.Epic,
      available: prices.Epic !== null,
    });

    // Option 2: Buy 10 Rares → craft 1 Epic
    const craftFromRareCost = prices.Rare !== null ? prices.Rare * RARES_PER_EPIC : null;
    options.push({
      method: "craft_from_rare",
      label: `Buy ${RARES_PER_EPIC} Rares → craft Epic`,
      totalCostRON: craftFromRareCost,
      cardsNeeded: RARES_PER_EPIC,
      unitPrice: prices.Rare,
      available: prices.Rare !== null,
    });

    // Option 3: Buy 30 Basics → 10 Rares → 1 Epic
    const craftFromBasicCost = prices.Basic !== null ? prices.Basic * BASICS_FOR_EPIC : null;
    options.push({
      method: "craft_from_basic",
      label: `Buy ${BASICS_FOR_EPIC} Basics → craft to Epic`,
      totalCostRON: craftFromBasicCost,
      cardsNeeded: BASICS_FOR_EPIC,
      unitPrice: prices.Basic,
      available: prices.Basic !== null,
    });
  } else {
    // Legendary
    // Option 1: Buy Legendary directly
    options.push({
      method: "buy_legendary",
      label: "Buy Legendary directly",
      totalCostRON: prices.Legendary,
      cardsNeeded: 1,
      unitPrice: prices.Legendary,
      available: prices.Legendary !== null,
    });

    // Option 2: Buy 8 Epics → craft 1 Legendary
    const craftFromEpicCost = prices.Epic !== null ? prices.Epic * EPICS_PER_LEGENDARY : null;
    options.push({
      method: "craft_from_epic",
      label: `Buy ${EPICS_PER_LEGENDARY} Epics → craft Legendary`,
      totalCostRON: craftFromEpicCost,
      cardsNeeded: EPICS_PER_LEGENDARY,
      unitPrice: prices.Epic,
      available: prices.Epic !== null,
    });

    // Option 3: Buy 80 Rares → 8 Epics → 1 Legendary
    const craftFromRareCost = prices.Rare !== null ? prices.Rare * RARES_FOR_LEGENDARY : null;
    options.push({
      method: "craft_from_rare",
      label: `Buy ${RARES_FOR_LEGENDARY} Rares → craft to Legendary`,
      totalCostRON: craftFromRareCost,
      cardsNeeded: RARES_FOR_LEGENDARY,
      unitPrice: prices.Rare,
      available: prices.Rare !== null,
    });

    // Option 4: Buy 240 Basics → 80 Rares → 8 Epics → 1 Legendary
    const craftFromBasicCost = prices.Basic !== null ? prices.Basic * BASICS_FOR_LEGENDARY : null;
    options.push({
      method: "craft_from_basic",
      label: `Buy ${BASICS_FOR_LEGENDARY} Basics → craft to Legendary`,
      totalCostRON: craftFromBasicCost,
      cardsNeeded: BASICS_FOR_LEGENDARY,
      unitPrice: prices.Basic,
      available: prices.Basic !== null,
    });
  }

  return options;
}

// ─── Champion Ranking by Scheme ───────────────────────────────────────

function loadGameData(): { schemes: Array<{ name: string; qualifyingChampions: Array<{ championTokenId: string; name: string }> }> } {
  const gameDataPath = path.resolve(process.cwd(), "client/public/game-data.json");
  const raw = fs.readFileSync(gameDataPath, "utf-8");
  return JSON.parse(raw);
}

async function rankChampionsForScheme(
  schemeName: string,
  topN: number = 10
): Promise<ChampionRanking[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const gameData = loadGameData();

  const scheme = gameData.schemes.find(
    (s) => s.name.toLowerCase() === schemeName.toLowerCase()
  );
  if (!scheme) {
    throw new Error(`Scheme "${schemeName}" not found in game data`);
  }

  const qualifyingIds = scheme.qualifyingChampions.map((c) => c.championTokenId);
  if (qualifyingIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      championTokenId: matchPlayerStats.championTokenId,
      avgScore: sql<number>`AVG(CAST(${matchPlayerStats.score} AS DECIMAL(10,2)))`,
      winRate: sql<number>`AVG(CASE WHEN ${matchPlayerStats.isWinner} = 1 THEN 1.0 ELSE 0.0 END)`,
      avgKills: sql<number>`AVG(${matchPlayerStats.kills})`,
      avgBalls: sql<number>`AVG(${matchPlayerStats.balls})`,
      avgWartDistance: sql<number>`AVG(${matchPlayerStats.wartDistance})`,
      totalMatches: sql<number>`COUNT(*)`,
    })
    .from(matchPlayerStats)
    .innerJoin(matchHistory, eq(matchPlayerStats.matchId, matchHistory.matchId))
    .where(
      and(
        sql`${matchHistory.matchDate} >= '2026-02-19'`,
        sql`${matchPlayerStats.championTokenId} IN (${sql.raw(qualifyingIds.join(", "))})`
      )
    )
    .groupBy(matchPlayerStats.championTokenId)
    .having(sql`COUNT(*) >= 5`);

  const nameMap = new Map<string, string>();
  for (const c of scheme.qualifyingChampions) {
    nameMap.set(c.championTokenId, c.name);
  }

  const ranked = rows
    .map((r) => ({
      championTokenId: String(r.championTokenId),
      name: nameMap.get(String(r.championTokenId)) ?? `Champion #${r.championTokenId}`,
      avgScore: Math.round(Number(r.avgScore) * 10) / 10,
      winRate: Math.round(Number(r.winRate) * 1000) / 1000,
      avgKills: Math.round(Number(r.avgKills) * 100) / 100,
      avgBalls: Math.round(Number(r.avgBalls) * 100) / 100,
      avgWartDistance: Math.round(Number(r.avgWartDistance) * 10) / 10,
      totalMatches: Number(r.totalMatches),
      rank: 0,
    }))
    .sort((a: ChampionRanking, b: ChampionRanking) => {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      return b.winRate - a.winRate;
    })
    .slice(0, topN)
    .map((c: ChampionRanking, i: number) => ({ ...c, rank: i + 1 }));

  return ranked;
}

// ─── Main Advisor Function ────────────────────────────────────────────

export async function getLegendaryAdvisory(
  schemeName: string,
  userId: number,
  topN: number = 10,
  targetRarity: TargetRarity = "Legendary"
): Promise<CardCrafterResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. Rank champions for this scheme
  const rankings = await rankChampionsForScheme(schemeName, topN);

  if (rankings.length === 0) {
    return {
      schemeName,
      targetRarity,
      topChampions: [],
      totalTargetOwned: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  // 2. Check which ones the user owns (any rarity)
  const championIds = rankings.map((r) => r.championTokenId);
  const ownedCards = await db
    .select({
      championTokenId: userCards.championTokenId,
      rarity: userCards.rarity,
    })
    .from(userCards)
    .where(
      and(
        eq(userCards.userId, userId),
        eq(userCards.cardType, "MOKI"),
        sql`${userCards.championTokenId} IN (${sql.raw(championIds.map(id => `'${id}'`).join(", "))})`
      )
    );

  // Build ownership map: championTokenId → highest rarity owned
  const rarityOrder = ["Basic", "Rare", "Epic", "Legendary"];
  const ownershipMap = new Map<string, string>();
  for (const card of ownedCards) {
    const existing = ownershipMap.get(card.championTokenId ?? "");
    const newRarity = card.rarity ?? "Basic";
    if (!existing || rarityOrder.indexOf(newRarity) > rarityOrder.indexOf(existing)) {
      ownershipMap.set(card.championTokenId ?? "", newRarity);
    }
  }

  // 3. Check if user owns the target rarity or higher
  const targetRarityIndex = rarityOrder.indexOf(targetRarity);

  // 4. Fetch marketplace prices for champions that need the target rarity
  const needsPricing = rankings.filter((r) => {
    const ownedRarity = ownershipMap.get(r.championTokenId);
    if (!ownedRarity) return true;
    return rarityOrder.indexOf(ownedRarity) < targetRarityIndex;
  });

  const priceMap = new Map<string, PriceData>();
  await Promise.all(
    needsPricing.map(async (r) => {
      try {
        const prices = await fetchFloorPrices(r.name);
        priceMap.set(r.championTokenId, prices);
      } catch {
        priceMap.set(r.championTokenId, { Basic: null, Rare: null, Epic: null, Legendary: null });
      }
    })
  );

  // 5. Build advisor entries
  let totalTargetOwned = 0;
  const topChampions: CardCrafterEntry[] = rankings.map((r) => {
    const ownedRarity = ownershipMap.get(r.championTokenId) ?? null;
    const ownsTarget = ownedRarity !== null && rarityOrder.indexOf(ownedRarity) >= targetRarityIndex;

    if (ownsTarget) totalTargetOwned++;

    if (ownsTarget) {
      return {
        ...r,
        ownsTarget: true,
        ownedRarity,
        acquisitionOptions: [],
        cheapestOption: null,
        cheapestCostRON: null,
        // backward compat
        ownsLegendary: ownedRarity === "Legendary",
      };
    }

    const prices = priceMap.get(r.championTokenId) ?? { Basic: null, Rare: null, Epic: null, Legendary: null };
    const options = calculateAcquisitionOptions(prices, targetRarity);
    const availableOptions = options.filter((o) => o.available && o.totalCostRON !== null);
    const cheapestOption = availableOptions.length > 0
      ? availableOptions.reduce((best, o) =>
          (o.totalCostRON ?? Infinity) < (best.totalCostRON ?? Infinity) ? o : best
        )
      : null;

    return {
      ...r,
      ownsTarget: false,
      ownedRarity,
      acquisitionOptions: options,
      cheapestOption,
      cheapestCostRON: cheapestOption?.totalCostRON ?? null,
      // backward compat
      ownsLegendary: false,
    };
  });

  return {
    schemeName,
    targetRarity,
    topChampions,
    totalTargetOwned,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get crafting advisory for a single champion by name.
 * Used by the "Select Card" entry point in Card Crafter.
 * Looks up the champion's match stats directly and returns the same
 * CardCrafterResult shape as getLegendaryAdvisory, but for one champion only.
 */
export async function getChampionAdvisoryByName(
  championName: string,
  userId: number,
  targetRarity: TargetRarity = "Legendary"
): Promise<CardCrafterResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. Look up match stats for this champion by name (case-insensitive)
  const rows = await db
    .select({
      championTokenId: matchPlayerStats.championTokenId,
      avgScore: sql<number>`AVG(CAST(${matchPlayerStats.score} AS DECIMAL(10,2)))`,
      winRate: sql<number>`AVG(CASE WHEN ${matchPlayerStats.isWinner} = 1 THEN 1.0 ELSE 0.0 END)`,
      avgKills: sql<number>`AVG(${matchPlayerStats.kills})`,
      avgBalls: sql<number>`AVG(${matchPlayerStats.balls})`,
      avgWartDistance: sql<number>`AVG(${matchPlayerStats.wartDistance})`,
      totalMatches: sql<number>`COUNT(*)`,
    })
    .from(matchPlayerStats)
    .innerJoin(matchHistory, eq(matchPlayerStats.matchId, matchHistory.matchId))
    .where(
      and(
        sql`${matchHistory.matchDate} >= '2026-02-19'`,
        sql`LOWER(${matchPlayerStats.championName}) = LOWER(${championName})`
      )
    )
    .groupBy(matchPlayerStats.championTokenId);

  if (rows.length === 0) {
    return {
      schemeName: championName,
      targetRarity,
      topChampions: [],
      totalTargetOwned: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Pick the row with the most matches (in case of tokenId collisions)
  const best = rows.reduce((a, b) => (Number(b.totalMatches) > Number(a.totalMatches) ? b : a));

  const ranking: ChampionRanking = {
    championTokenId: String(best.championTokenId),
    name: championName,
    avgScore: Math.round(Number(best.avgScore) * 10) / 10,
    winRate: Math.round(Number(best.winRate) * 1000) / 1000,
    avgKills: Math.round(Number(best.avgKills) * 100) / 100,
    avgBalls: Math.round(Number(best.avgBalls) * 100) / 100,
    avgWartDistance: Math.round(Number(best.avgWartDistance) * 10) / 10,
    totalMatches: Number(best.totalMatches),
    rank: 1,
  };

  // 2. Check ownership
  const rarityOrder = ["Basic", "Rare", "Epic", "Legendary"];
  const targetRarityIndex = rarityOrder.indexOf(targetRarity);

  const ownedCards = await db
    .select({
      championTokenId: userCards.championTokenId,
      rarity: userCards.rarity,
    })
    .from(userCards)
    .where(
      and(
        eq(userCards.userId, userId),
        eq(userCards.cardType, "MOKI"),
        sql`${userCards.championTokenId} = ${ranking.championTokenId}`
      )
    );

  let ownedRarity: string | null = null;
  for (const card of ownedCards) {
    const r = card.rarity ?? "Basic";
    if (!ownedRarity || rarityOrder.indexOf(r) > rarityOrder.indexOf(ownedRarity)) {
      ownedRarity = r;
    }
  }

  const ownsTarget = ownedRarity !== null && rarityOrder.indexOf(ownedRarity) >= targetRarityIndex;

  let entry: CardCrafterEntry;
  if (ownsTarget) {
    entry = {
      ...ranking,
      ownsTarget: true,
      ownedRarity,
      acquisitionOptions: [],
      cheapestOption: null,
      cheapestCostRON: null,
    };
  } else {
    let prices: PriceData = { Basic: null, Rare: null, Epic: null, Legendary: null };
    try {
      prices = await fetchFloorPrices(championName);
    } catch {
      // leave as nulls
    }
    const options = calculateAcquisitionOptions(prices, targetRarity);
    const availableOptions = options.filter((o) => o.available && o.totalCostRON !== null);
    const cheapestOption = availableOptions.length > 0
      ? availableOptions.reduce((best, o) =>
          (o.totalCostRON ?? Infinity) < (best.totalCostRON ?? Infinity) ? o : best
        )
      : null;
    entry = {
      ...ranking,
      ownsTarget: false,
      ownedRarity,
      acquisitionOptions: options,
      cheapestOption,
      cheapestCostRON: cheapestOption?.totalCostRON ?? null,
    };
  }

  return {
    schemeName: championName,
    targetRarity,
    topChampions: [entry],
    totalTargetOwned: ownsTarget ? 1 : 0,
    fetchedAt: new Date().toISOString(),
  };
}
