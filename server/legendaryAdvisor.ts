/**
 * Legendary Card Acquisition Advisor
 *
 * Ranks the best MOKIs for a given scheme by avg score then win%,
 * checks which ones the user already owns as Legendary,
 * fetches Ronin Marketplace floor prices for all rarities,
 * and calculates the most economical path to acquiring a Legendary card.
 *
 * Crafting ratios (free to craft, no gem cost):
 *   3 Basic  → 1 Rare
 *   10 Rare  → 1 Epic
 *   8 Epic   → 1 Legendary
 *
 * Therefore to craft 1 Legendary from scratch:
 *   8 Epic   → 1 Legendary
 *   80 Rare  → 8 Epic → 1 Legendary
 *   240 Basic → 80 Rare → 8 Epic → 1 Legendary
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

// Derived totals to craft 1 Legendary from scratch
const RARES_FOR_LEGENDARY = RARES_PER_EPIC * EPICS_PER_LEGENDARY; // 80
const BASICS_FOR_LEGENDARY = BASICS_PER_RARE * RARES_FOR_LEGENDARY; // 240

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
  method: "buy_legendary" | "craft_from_epic" | "craft_from_rare" | "craft_from_basic";
  label: string;
  totalCostRON: number | null;
  cardsNeeded: number;
  unitPrice: number | null;
  available: boolean;
}

export interface LegendaryAdvisorEntry {
  rank: number;
  championTokenId: string;
  name: string;
  avgScore: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  totalMatches: number;
  ownsLegendary: boolean;
  ownedRarity: string | null; // highest rarity owned
  acquisitionOptions: AcquisitionOption[];
  cheapestOption: AcquisitionOption | null;
  cheapestCostRON: number | null;
}

export interface LegendaryAdvisorResult {
  schemeName: string;
  topChampions: LegendaryAdvisorEntry[];
  totalLegendariesOwned: number;
  fetchedAt: string;
}

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
          // RON uses 18 decimals (wei)
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

function calculateAcquisitionOptions(prices: PriceData): AcquisitionOption[] {
  const options: AcquisitionOption[] = [];

  // Option 1: Buy Legendary directly
  options.push({
    method: "buy_legendary",
    label: "Buy Legendary directly",
    totalCostRON: prices.Legendary,
    cardsNeeded: 1,
    unitPrice: prices.Legendary,
    available: prices.Legendary !== null,
  });

  // Option 2: Buy 8 Epics and craft → 1 Legendary
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

  // Find qualifying champions for this scheme
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

  // Query Season 1 match stats for qualifying champions
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

  // Build name lookup from game data
  const nameMap = new Map<string, string>();
  for (const c of scheme.qualifyingChampions) {
    nameMap.set(c.championTokenId, c.name);
  }

  // Sort: primary = avgScore desc, secondary = winRate desc
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
  topN: number = 10
): Promise<LegendaryAdvisorResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. Rank champions for this scheme
  const rankings = await rankChampionsForScheme(schemeName, topN);

  if (rankings.length === 0) {
    return {
      schemeName,
      topChampions: [],
      totalLegendariesOwned: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  // 2. Check which ones the user owns (any rarity) and specifically Legendary
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

  // 3. Fetch marketplace prices for champions that don't have Legendary yet
  const needsPricing = rankings.filter(
    (r) => ownershipMap.get(r.championTokenId) !== "Legendary"
  );

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

  // 4. Build advisor entries
  let totalLegendariesOwned = 0;
  const topChampions: LegendaryAdvisorEntry[] = rankings.map((r) => {
    const ownedRarity = ownershipMap.get(r.championTokenId) ?? null;
    const ownsLegendary = ownedRarity === "Legendary";

    if (ownsLegendary) totalLegendariesOwned++;

    if (ownsLegendary) {
      return {
        ...r,
        ownsLegendary: true,
        ownedRarity: "Legendary",
        acquisitionOptions: [],
        cheapestOption: null,
        cheapestCostRON: null,
      };
    }

    const prices = priceMap.get(r.championTokenId) ?? { Basic: null, Rare: null, Epic: null, Legendary: null };
    const options = calculateAcquisitionOptions(prices);
    const availableOptions = options.filter((o) => o.available && o.totalCostRON !== null);
    const cheapestOption = availableOptions.length > 0
      ? availableOptions.reduce((best, o) =>
          (o.totalCostRON ?? Infinity) < (best.totalCostRON ?? Infinity) ? o : best
        )
      : null;

    return {
      ...r,
      ownsLegendary: false,
      ownedRarity,
      acquisitionOptions: options,
      cheapestOption,
      cheapestCostRON: cheapestOption?.totalCostRON ?? null,
    };
  });

  return {
    schemeName,
    topChampions,
    totalLegendariesOwned,
    fetchedAt: new Date().toISOString(),
  };
}
