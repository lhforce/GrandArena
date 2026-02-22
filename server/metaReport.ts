/**
 * Meta Report — Top performing champions with real match stats + marketplace prices.
 *
 * Aggregates:
 * - Win rate, avg score, avg kills/balls/wart from match_player_stats
 * - Ronin Marketplace floor prices for each rarity tier
 * - Class breakdown showing which classes dominate
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

const GA_CARDS_CONTRACT = "0x8c811e3c958e190f5ec15fb376533a3398620500";
const GRAPHQL_URL = "https://marketplace-graphql.skymavis.com/graphql";

// ─── Types ─────────────────────────────────────────────────────────

export interface MetaChampion {
  championTokenId: number;
  championName: string;
  championClass: string;
  imageUrl?: string | null;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100
  avgScore: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  rank: number;
  /** Floor prices by rarity (RON) */
  prices: {
    Basic: number | null;
    Rare: number | null;
    Epic: number | null;
    Legendary: number | null;
  };
  /** Cheapest entry point (lowest non-null price) */
  cheapestEntry: { rarity: string; price: number } | null;
}

export interface ClassMetaSummary {
  championClass: string;
  totalChampions: number;
  avgWinRate: number;
  avgScore: number;
  topChampion: string;
}

export interface MetaReportResult {
  champions: MetaChampion[];
  classSummary: ClassMetaSummary[];
  totalChampionsWithData: number;
  sortBy: string;
  generatedAt: number;
}

// ─── GraphQL Helper ────────────────────────────────────────────────

async function gqlFetch(query: string): Promise<unknown> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json() as { data?: unknown; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`GraphQL error: ${JSON.stringify(json.errors[0])}`);
  return json.data;
}

async function fetchChampionFloorPrices(
  championName: string
): Promise<{ Basic: number | null; Rare: number | null; Epic: number | null; Legendary: number | null }> {
  const rarities = ["Basic", "Rare", "Epic", "Legendary"] as const;
  const prices: { Basic: number | null; Rare: number | null; Epic: number | null; Legendary: number | null } = {
    Basic: null, Rare: null, Epic: null, Legendary: null,
  };
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
            order { currentPrice }
          }
        }
      }`;
      try {
        const data = await gqlFetch(query) as {
          erc721Tokens: { results: Array<{ order: { currentPrice: string } | null }> };
        };
        const r = data.erc721Tokens.results;
        if (r.length > 0 && r[0]?.order?.currentPrice) {
          prices[rarity] = Math.round(Number(BigInt(r[0].order.currentPrice)) / 1e18 * 100) / 100;
        }
      } catch {
        // Price unavailable
      }
    })
  );
  return prices;
}

// ─── Main Function ─────────────────────────────────────────────────

export async function getMetaReport(
  sortBy: "winRate" | "avgScore" | "avgKills" | "avgBalls" | "totalMatches" = "winRate",
  limit: number = 25,
  minMatches: number = 10,
  includePrices: boolean = true
): Promise<MetaReportResult> {
  const db = await getDb();
  if (!db) {
    return { champions: [], classSummary: [], totalChampionsWithData: 0, sortBy, generatedAt: Date.now() };
  }

  // Get champion performance from match data
  const orderClause =
    sortBy === "avgScore"
      ? sql`avgScore DESC`
      : sortBy === "avgKills"
      ? sql`avgKills DESC`
      : sortBy === "avgBalls"
      ? sql`avgBalls DESC`
      : sortBy === "totalMatches"
      ? sql`totalMatches DESC`
      : sql`winRate DESC`;

  const result = await db.execute(sql`
    SELECT 
      mps.championTokenId,
      mps.championName,
      mps.championClass,
      COUNT(*) AS totalMatches,
      SUM(CASE WHEN mps.isWinner = 1 THEN 1 ELSE 0 END) AS wins,
      ROUND(SUM(CASE WHEN mps.isWinner = 1 THEN 1 ELSE 0 END) / COUNT(*), 4) AS winRate,
      ROUND(AVG(CASE WHEN mps.score IS NOT NULL AND mps.score > 0 THEN mps.score ELSE NULL END), 2) AS avgScore,
      ROUND(AVG(mps.kills), 2) AS avgKills,
      ROUND(AVG(mps.balls), 2) AS avgBalls,
      ROUND(AVG(mps.wartDistance), 2) AS avgWart
    FROM match_player_stats mps
    GROUP BY mps.championTokenId, mps.championName, mps.championClass
    HAVING COUNT(*) >= ${minMatches}
    ORDER BY ${orderClause}
    LIMIT ${limit}
  `);

  const rows = (result as unknown as [unknown[]])[0] as Array<{
    championTokenId: string | number;
    championName: string;
    championClass: string;
    totalMatches: string | number;
    wins: string | number;
    winRate: string | number;
    avgScore: string | number;
    avgKills: string | number;
    avgBalls: string | number;
    avgWart: string | number;
  }>;

  if (!rows || rows.length === 0) {
    return { champions: [], classSummary: [], totalChampionsWithData: 0, sortBy, generatedAt: Date.now() };
  }

  // Get total count
  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total FROM (
      SELECT championTokenId FROM match_player_stats
      GROUP BY championTokenId HAVING COUNT(*) >= ${minMatches}
    ) sub
  `);
  const totalChampionsWithData = Number((countResult as unknown as [Array<{ total: string | number }>])[0]?.[0]?.total) || 0;

  // Load game data for images
  let gameDataMap = new Map<number, { image?: string }>();
  try {
    const fs = await import("fs");
    const path = await import("path");
    const gameDataPath = path.resolve(process.cwd(), "client/public/game-data.json");
    const raw = fs.readFileSync(gameDataPath, "utf-8");
    const gameData = JSON.parse(raw) as { champions: Array<{ championTokenId: string; image?: string }> };
    for (const c of gameData.champions) {
      gameDataMap.set(Number(c.championTokenId), { image: c.image });
    }
  } catch {
    // Game data not available
  }

  // Build champion list
  const champions: MetaChampion[] = rows.map((row, i) => {
    const totalMatches = Number(row.totalMatches);
    const wins = Number(row.wins);
    const winRate = Math.round(Number(row.winRate) * 10000) / 100;
    const gameInfo = gameDataMap.get(Number(row.championTokenId));
    return {
      championTokenId: Number(row.championTokenId),
      championName: row.championName ?? "",
      championClass: row.championClass ?? "",
      imageUrl: gameInfo?.image ?? null,
      totalMatches,
      wins,
      losses: totalMatches - wins,
      winRate,
      avgScore: Math.round(Number(row.avgScore) * 100) / 100 || 0,
      avgKills: Math.round(Number(row.avgKills) * 100) / 100 || 0,
      avgBalls: Math.round(Number(row.avgBalls) * 100) / 100 || 0,
      avgWartDistance: Math.round(Number(row.avgWart) * 100) / 100 || 0,
      rank: i + 1,
      prices: { Basic: null, Rare: null, Epic: null, Legendary: null },
      cheapestEntry: null,
    };
  });

  // Fetch marketplace prices (batched with small concurrency limit)
  if (includePrices) {
    const BATCH_SIZE = 5;
    for (let i = 0; i < champions.length; i += BATCH_SIZE) {
      const batch = champions.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (c) => {
          try {
            c.prices = await fetchChampionFloorPrices(c.championName);
            // Find cheapest entry
            const rawEntries = (["Basic", "Rare", "Epic", "Legendary"] as const)
              .map((r) => ({ rarity: r as string, price: c.prices[r] }));
            const entries: Array<{ rarity: string; price: number }> = rawEntries
              .filter((e) => e.price !== null && (e.price as number) > 0)
              .map((e) => ({ rarity: e.rarity, price: e.price as number }));
            if (entries.length > 0) {
              c.cheapestEntry = entries.reduce<{ rarity: string; price: number }>(
                (min, e) => e.price < min.price ? e : min, entries[0]
              );
            }
          } catch {
            // Prices unavailable
          }
        })
      );
    }
  }

  // Build class summary
  const classMap = new Map<string, { winRates: number[]; scores: number[]; topChampion: string; topWinRate: number }>();
  for (const c of champions) {
    const cls = c.championClass || "Unknown";
    if (!classMap.has(cls)) classMap.set(cls, { winRates: [], scores: [], topChampion: c.championName, topWinRate: c.winRate });
    const entry = classMap.get(cls)!;
    entry.winRates.push(c.winRate);
    entry.scores.push(c.avgScore);
    if (c.winRate > entry.topWinRate) {
      entry.topWinRate = c.winRate;
      entry.topChampion = c.championName;
    }
  }

  const classSummary: ClassMetaSummary[] = Array.from(classMap.entries())
    .map(([cls, data]) => ({
      championClass: cls,
      totalChampions: data.winRates.length,
      avgWinRate: Math.round((data.winRates.reduce((s, v) => s + v, 0) / data.winRates.length) * 100) / 100,
      avgScore: Math.round((data.scores.reduce((s, v) => s + v, 0) / data.scores.length) * 100) / 100,
      topChampion: data.topChampion,
    }))
    .sort((a, b) => b.avgWinRate - a.avgWinRate);

  return {
    champions,
    classSummary,
    totalChampionsWithData,
    sortBy,
    generatedAt: Date.now(),
  };
}
