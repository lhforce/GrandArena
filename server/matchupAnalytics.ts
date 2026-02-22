/**
 * Matchup Analytics — Calculates head-to-head champion matchup stats
 * and per-champion performance metrics from stored match history data.
 *
 * All data comes from the match_history + match_player_stats tables,
 * populated by the matchScraper.
 */

import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { matchHistory, matchPlayerStats } from "../drizzle/schema";

// ─── Types ─────────────────────────────────────────────────────────

export interface HeadToHeadRecord {
  championTokenId: number;
  championName: string;
  championClass: string;
  opponentTokenId: number;
  opponentName: string;
  opponentClass: string;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  avgOpponentKills: number;
  avgOpponentBalls: number;
  avgOpponentWartDistance: number;
}

export interface ChampionMatchPerformance {
  championTokenId: number;
  championName: string;
  championClass: string;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  totalKills: number;
  totalBalls: number;
  totalWartDistance: number;
  // Win type breakdown
  eliminationWins: number;
  wartWins: number;
  gachaWins: number;
  // Per-match scoring estimate (V4: 85*kills + 40*balls + wart + 200*win)
  avgEstimatedScore: number;
}

export interface ClassMatchupSummary {
  className: string;
  opponentClass: string;
  totalMatches: number;
  wins: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
}

// ─── Head-to-Head Matchup Queries ──────────────────────────────────

/**
 * Get head-to-head record between two specific champions.
 * Finds all matches where both champions appeared and calculates win/loss.
 */
export async function getHeadToHead(
  championTokenId: number,
  opponentTokenId: number
): Promise<HeadToHeadRecord | null> {
  const db = await getDb();
  if (!db) return null;

  // Find matches where both champions played
  const result = await db.execute(sql`
    SELECT 
      a.matchId,
      a.championName AS champName,
      a.championClass AS champClass,
      a.team AS champTeam,
      a.kills AS champKills,
      a.balls AS champBalls,
      a.wartDistance AS champWart,
      a.isWinner AS champWon,
      b.championName AS oppName,
      b.championClass AS oppClass,
      b.team AS oppTeam,
      b.kills AS oppKills,
      b.balls AS oppBalls,
      b.wartDistance AS oppWart,
      b.isWinner AS oppWon
    FROM match_player_stats a
    JOIN match_player_stats b ON a.matchId = b.matchId
    WHERE a.championTokenId = ${championTokenId}
      AND b.championTokenId = ${opponentTokenId}
      AND a.team != b.team
  `);

  const rows = (result as any)[0] as any[];
  if (!rows || rows.length === 0) return null;

  let wins = 0;
  let losses = 0;
  let totalChampKills = 0;
  let totalChampBalls = 0;
  let totalChampWart = 0;
  let totalOppKills = 0;
  let totalOppBalls = 0;
  let totalOppWart = 0;

  for (const row of rows) {
    if (row.champWon) wins++;
    else losses++;

    totalChampKills += Number(row.champKills) || 0;
    totalChampBalls += Number(row.champBalls) || 0;
    totalChampWart += Number(row.champWart) || 0;
    totalOppKills += Number(row.oppKills) || 0;
    totalOppBalls += Number(row.oppBalls) || 0;
    totalOppWart += Number(row.oppWart) || 0;
  }

  const total = rows.length;

  return {
    championTokenId,
    championName: rows[0].champName,
    championClass: rows[0].champClass || "",
    opponentTokenId,
    opponentName: rows[0].oppName,
    opponentClass: rows[0].oppClass || "",
    totalMatches: total,
    wins,
    losses,
    winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
    avgKills: total > 0 ? Math.round((totalChampKills / total) * 100) / 100 : 0,
    avgBalls: total > 0 ? Math.round((totalChampBalls / total) * 100) / 100 : 0,
    avgWartDistance:
      total > 0 ? Math.round((totalChampWart / total) * 100) / 100 : 0,
    avgOpponentKills:
      total > 0 ? Math.round((totalOppKills / total) * 100) / 100 : 0,
    avgOpponentBalls:
      total > 0 ? Math.round((totalOppBalls / total) * 100) / 100 : 0,
    avgOpponentWartDistance:
      total > 0 ? Math.round((totalOppWart / total) * 100) / 100 : 0,
  };
}

/**
 * Get all head-to-head records for a champion against all opponents they've faced.
 * Returns sorted by most matches played (most data = most reliable).
 */
export async function getChampionMatchups(
  championTokenId: number,
  limit: number = 50,
  minMatches: number = 1
): Promise<HeadToHeadRecord[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      b.championTokenId AS opponentTokenId,
      b.championName AS opponentName,
      b.championClass AS opponentClass,
      a.championName AS champName,
      a.championClass AS champClass,
      COUNT(*) AS totalMatches,
      SUM(CASE WHEN a.isWinner = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN a.isWinner = 0 THEN 1 ELSE 0 END) AS losses,
      ROUND(AVG(a.kills), 2) AS avgKills,
      ROUND(AVG(a.balls), 2) AS avgBalls,
      ROUND(AVG(a.wartDistance), 2) AS avgWart,
      ROUND(AVG(b.kills), 2) AS avgOppKills,
      ROUND(AVG(b.balls), 2) AS avgOppBalls,
      ROUND(AVG(b.wartDistance), 2) AS avgOppWart
    FROM match_player_stats a
    JOIN match_player_stats b ON a.matchId = b.matchId AND a.team != b.team
    WHERE a.championTokenId = ${championTokenId}
    GROUP BY b.championTokenId, b.championName, b.championClass, a.championName, a.championClass
    HAVING COUNT(*) >= ${minMatches}
    ORDER BY totalMatches DESC
    LIMIT ${limit}
  `);

  const rows = (result as any)[0] as any[];
  if (!rows) return [];

  return rows.map((row) => ({
    championTokenId,
    championName: row.champName || "",
    championClass: row.champClass || "",
    opponentTokenId: Number(row.opponentTokenId),
    opponentName: row.opponentName || "",
    opponentClass: row.opponentClass || "",
    totalMatches: Number(row.totalMatches),
    wins: Number(row.wins),
    losses: Number(row.losses),
    winRate:
      Number(row.totalMatches) > 0
        ? Math.round(
            (Number(row.wins) / Number(row.totalMatches)) * 10000
          ) / 100
        : 0,
    avgKills: Number(row.avgKills) || 0,
    avgBalls: Number(row.avgBalls) || 0,
    avgWartDistance: Number(row.avgWart) || 0,
    avgOpponentKills: Number(row.avgOppKills) || 0,
    avgOpponentBalls: Number(row.avgOppBalls) || 0,
    avgOpponentWartDistance: Number(row.avgOppWart) || 0,
  }));
}

/**
 * Get overall performance stats for a champion from actual match data.
 */
export async function getChampionPerformance(
  championTokenId: number
): Promise<ChampionMatchPerformance | null> {
  const db = await getDb();
  if (!db) return null;

  // Get basic stats
  const basicResult = await db.execute(sql`
    SELECT 
      championName,
      championClass,
      COUNT(*) AS totalMatches,
      SUM(CASE WHEN isWinner = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(kills) AS totalKills,
      SUM(balls) AS totalBalls,
      SUM(wartDistance) AS totalWart,
      ROUND(AVG(kills), 2) AS avgKills,
      ROUND(AVG(balls), 2) AS avgBalls,
      ROUND(AVG(wartDistance), 2) AS avgWart
    FROM match_player_stats
    WHERE championTokenId = ${championTokenId}
    GROUP BY championName, championClass
  `);

  const rows = (basicResult as any)[0] as any[];
  if (!rows || rows.length === 0) return null;

  const row = rows[0];
  const totalMatches = Number(row.totalMatches);
  const wins = Number(row.wins);
  const losses = totalMatches - wins;

  // Get win type breakdown
  const winTypeResult = await db.execute(sql`
    SELECT 
      mh.winType,
      COUNT(*) AS count
    FROM match_player_stats mps
    JOIN match_history mh ON mps.matchId = mh.matchId
    WHERE mps.championTokenId = ${championTokenId}
      AND mps.isWinner = 1
    GROUP BY mh.winType
  `);

  const winTypeRows = (winTypeResult as any)[0] as any[];
  let eliminationWins = 0;
  let wartWins = 0;
  let gachaWins = 0;

  for (const wtr of winTypeRows || []) {
    switch (wtr.winType) {
      case "eliminations":
        eliminationWins = Number(wtr.count);
        break;
      case "wart":
        wartWins = Number(wtr.count);
        break;
      case "gacha":
        gachaWins = Number(wtr.count);
        break;
    }
  }

  const avgKills = Number(row.avgKills) || 0;
  const avgBalls = Number(row.avgBalls) || 0;
  const avgWart = Number(row.avgWart) || 0;
  const winRate = totalMatches > 0 ? wins / totalMatches : 0;

  // V4 scoring estimate: 85*kills + 40*balls + wart + 200*winRate
  const avgEstimatedScore =
    Math.round((85 * avgKills + 40 * avgBalls + avgWart + 200 * winRate) * 100) / 100;

  return {
    championTokenId,
    championName: row.championName || "",
    championClass: row.championClass || "",
    totalMatches,
    wins,
    losses,
    winRate: Math.round(winRate * 10000) / 100,
    avgKills,
    avgBalls,
    avgWartDistance: avgWart,
    totalKills: Number(row.totalKills) || 0,
    totalBalls: Number(row.totalBalls) || 0,
    totalWartDistance: Number(row.totalWart) || 0,
    eliminationWins,
    wartWins,
    gachaWins,
    avgEstimatedScore,
  };
}

/**
 * Get performance rankings for all champions from match data.
 */
export async function getAllChampionPerformance(
  sortBy: string = "winRate",
  limit: number = 50,
  offset: number = 0,
  minMatches: number = 5
): Promise<{ champions: ChampionMatchPerformance[]; total: number }> {
  const db = await getDb();
  if (!db) return { champions: [], total: 0 };

  // Get all champion stats in one query
  const result = await db.execute(sql`
    SELECT 
      mps.championTokenId,
      mps.championName,
      mps.championClass,
      COUNT(*) AS totalMatches,
      SUM(CASE WHEN mps.isWinner = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(mps.kills) AS totalKills,
      SUM(mps.balls) AS totalBalls,
      SUM(mps.wartDistance) AS totalWart,
      ROUND(AVG(mps.kills), 2) AS avgKills,
      ROUND(AVG(mps.balls), 2) AS avgBalls,
      ROUND(AVG(mps.wartDistance), 2) AS avgWart
    FROM match_player_stats mps
    GROUP BY mps.championTokenId, mps.championName, mps.championClass
    HAVING COUNT(*) >= ${minMatches}
    ORDER BY ${
      sortBy === "avgKills"
        ? sql`avgKills DESC`
        : sortBy === "avgBalls"
          ? sql`avgBalls DESC`
          : sortBy === "avgWart"
            ? sql`avgWart DESC`
            : sortBy === "totalMatches"
              ? sql`totalMatches DESC`
              : sql`(SUM(CASE WHEN mps.isWinner = 1 THEN 1 ELSE 0 END) / COUNT(*)) DESC`
    }
    LIMIT ${limit} OFFSET ${offset}
  `);

  const rows = (result as any)[0] as any[];
  if (!rows) return { champions: [], total: 0 };

  // Get total count
  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total FROM (
      SELECT championTokenId
      FROM match_player_stats
      GROUP BY championTokenId
      HAVING COUNT(*) >= ${minMatches}
    ) sub
  `);
  const total = Number((countResult as any)[0]?.[0]?.total) || 0;

  const champions: ChampionMatchPerformance[] = rows.map((row: any) => {
    const totalMatches = Number(row.totalMatches);
    const wins = Number(row.wins);
    const avgKills = Number(row.avgKills) || 0;
    const avgBalls = Number(row.avgBalls) || 0;
    const avgWart = Number(row.avgWart) || 0;
    const winRate = totalMatches > 0 ? wins / totalMatches : 0;

    return {
      championTokenId: Number(row.championTokenId),
      championName: row.championName || "",
      championClass: row.championClass || "",
      totalMatches,
      wins,
      losses: totalMatches - wins,
      winRate: Math.round(winRate * 10000) / 100,
      avgKills,
      avgBalls,
      avgWartDistance: avgWart,
      totalKills: Number(row.totalKills) || 0,
      totalBalls: Number(row.totalBalls) || 0,
      totalWartDistance: Number(row.totalWart) || 0,
      eliminationWins: 0, // Would need a join to get this
      wartWins: 0,
      gachaWins: 0,
      avgEstimatedScore:
        Math.round(
          (85 * avgKills + 40 * avgBalls + avgWart + 200 * winRate) * 100
        ) / 100,
    };
  });

  return { champions, total };
}

/**
 * Get class vs class matchup summary.
 */
export async function getClassMatchups(): Promise<ClassMatchupSummary[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      a.championClass AS className,
      b.championClass AS opponentClass,
      COUNT(*) AS totalMatches,
      SUM(CASE WHEN a.isWinner = 1 THEN 1 ELSE 0 END) AS wins,
      ROUND(AVG(a.kills), 2) AS avgKills,
      ROUND(AVG(a.balls), 2) AS avgBalls,
      ROUND(AVG(a.wartDistance), 2) AS avgWart
    FROM match_player_stats a
    JOIN match_player_stats b ON a.matchId = b.matchId AND a.team != b.team
    WHERE a.championClass IS NOT NULL AND b.championClass IS NOT NULL
      AND a.championClass != '' AND b.championClass != ''
    GROUP BY a.championClass, b.championClass
    ORDER BY a.championClass, wins DESC
  `);

  const rows = (result as any)[0] as any[];
  if (!rows) return [];

  return rows.map((row: any) => ({
    className: row.className,
    opponentClass: row.opponentClass,
    totalMatches: Number(row.totalMatches),
    wins: Number(row.wins),
    winRate:
      Number(row.totalMatches) > 0
        ? Math.round(
            (Number(row.wins) / Number(row.totalMatches)) * 10000
          ) / 100
        : 0,
    avgKills: Number(row.avgKills) || 0,
    avgBalls: Number(row.avgBalls) || 0,
    avgWartDistance: Number(row.avgWart) || 0,
  }));
}

/**
 * Search for champions by name (for the matchup lookup UI).
 */
export async function searchChampionsByName(
  query: string,
  limit: number = 20
): Promise<Array<{ championTokenId: number; championName: string; championClass: string; totalMatches: number }>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      championTokenId,
      championName,
      championClass,
      COUNT(*) AS totalMatches
    FROM match_player_stats
    WHERE championName LIKE ${`%${query}%`}
    GROUP BY championTokenId, championName, championClass
    ORDER BY totalMatches DESC
    LIMIT ${limit}
  `);

  const rows = (result as any)[0] as any[];
  if (!rows) return [];

  return rows.map((row: any) => ({
    championTokenId: Number(row.championTokenId),
    championName: row.championName || "",
    championClass: row.championClass || "",
    totalMatches: Number(row.totalMatches),
  }));
}

/**
 * Get the best and worst matchups for a champion.
 */
export async function getBestWorstMatchups(
  championTokenId: number,
  minMatches: number = 3
): Promise<{
  bestMatchups: HeadToHeadRecord[];
  worstMatchups: HeadToHeadRecord[];
}> {
  const allMatchups = await getChampionMatchups(championTokenId, 200, minMatches);

  // Sort by win rate for best/worst
  const sorted = [...allMatchups].sort((a, b) => b.winRate - a.winRate);

  return {
    bestMatchups: sorted.slice(0, 10),
    worstMatchups: sorted.slice(-10).reverse(),
  };
}

/**
 * Get data summary for the matchup intelligence page.
 */
export async function getMatchDataSummary(): Promise<{
  totalMatches: number;
  totalPlayerStats: number;
  uniqueChampions: number;
  dateRange: { earliest: string | null; latest: string | null };
  winTypeBreakdown: Record<string, number>;
}> {
  const db = await getDb();
  if (!db)
    return {
      totalMatches: 0,
      totalPlayerStats: 0,
      uniqueChampions: 0,
      dateRange: { earliest: null, latest: null },
      winTypeBreakdown: {},
    };

  const matchCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(matchHistory);

  const statsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(matchPlayerStats);

  const champCount = await db.execute(sql`
    SELECT COUNT(DISTINCT championTokenId) AS count FROM match_player_stats
  `);

  const dateRange = await db.execute(sql`
    SELECT MIN(matchDate) AS earliest, MAX(matchDate) AS latest FROM match_history
  `);

  const winTypes = await db.execute(sql`
    SELECT winType, COUNT(*) AS count FROM match_history 
    WHERE winType IS NOT NULL
    GROUP BY winType
  `);

  const winTypeBreakdown: Record<string, number> = {};
  for (const row of (winTypes as any)[0] || []) {
    winTypeBreakdown[row.winType] = Number(row.count);
  }

  const dateRow = (dateRange as any)[0]?.[0];

  return {
    totalMatches: matchCount[0]?.count ?? 0,
    totalPlayerStats: statsCount[0]?.count ?? 0,
    uniqueChampions: Number((champCount as any)[0]?.[0]?.count) || 0,
    dateRange: {
      earliest: dateRow?.earliest || null,
      latest: dateRow?.latest || null,
    },
    winTypeBreakdown,
  };
}


/**
 * Get match-derived performance stats for multiple champions at once.
 * Used by the lineup optimizer to blend match data into scoring.
 * Returns a Map keyed by championTokenId (as string, matching championStats format).
 */
export async function getBulkMatchPerformance(
  championTokenIds: number[]
): Promise<Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>> {
  const db = await getDb();
  const result = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number; totalMatches: number }>();
  if (!db || championTokenIds.length === 0) return result;

  const rows = await db.execute(sql`
    SELECT 
      championTokenId,
      COUNT(*) AS totalMatches,
      ROUND(AVG(kills), 4) AS avgKills,
      ROUND(AVG(balls), 4) AS avgBalls,
      ROUND(AVG(wartDistance), 4) AS avgWart,
      ROUND(SUM(CASE WHEN isWinner = 1 THEN 1 ELSE 0 END) / COUNT(*), 4) AS winRate
    FROM match_player_stats
    WHERE championTokenId IN (${sql.join(championTokenIds.map(id => sql`${id}`), sql`, `)})
    GROUP BY championTokenId
  `);

  const data = (rows as any)[0] as any[];
  if (!data) return result;

  for (const row of data) {
    // Key as string to match championStats.championTokenId format
    result.set(String(row.championTokenId), {
      avgKills: Number(row.avgKills) || 0,
      avgBalls: Number(row.avgBalls) || 0,
      avgWartDistance: Number(row.avgWart) || 0,
      winRate: Number(row.winRate) || 0,
      totalMatches: Number(row.totalMatches) || 0,
    });
  }

  return result;
}

/**
 * Get H2H win rates for a set of champions against a set of opponents.
 * Returns a nested Map: champId -> oppId -> { wins, losses, winRate, totalMatches }.
 * Used by the swap advisor to evaluate all possible matchup permutations.
 */
export async function getBulkHeadToHead(
  championTokenIds: number[],
  opponentTokenIds: number[]
): Promise<Map<number, Map<number, { wins: number; losses: number; winRate: number; totalMatches: number; avgKills: number; avgBalls: number; avgWart: number }>>> {
  const db = await getDb();
  const result = new Map<number, Map<number, { wins: number; losses: number; winRate: number; totalMatches: number; avgKills: number; avgBalls: number; avgWart: number }>>();
  if (!db || championTokenIds.length === 0 || opponentTokenIds.length === 0) return result;

  const rows = await db.execute(sql`
    SELECT 
      a.championTokenId AS champId,
      b.championTokenId AS oppId,
      COUNT(*) AS totalMatches,
      SUM(CASE WHEN a.isWinner = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN a.isWinner = 0 THEN 1 ELSE 0 END) AS losses,
      ROUND(AVG(a.kills), 2) AS avgKills,
      ROUND(AVG(a.balls), 2) AS avgBalls,
      ROUND(AVG(a.wartDistance), 2) AS avgWart
    FROM match_player_stats a
    JOIN match_player_stats b ON a.matchId = b.matchId AND a.team != b.team
    WHERE a.championTokenId IN (${sql.join(championTokenIds.map(id => sql`${id}`), sql`, `)})
      AND b.championTokenId IN (${sql.join(opponentTokenIds.map(id => sql`${id}`), sql`, `)})
    GROUP BY a.championTokenId, b.championTokenId
  `);

  const data = (rows as any)[0] as any[];
  if (!data) return result;

  for (const row of data) {
    const champId = Number(row.champId);
    const oppId = Number(row.oppId);
    const total = Number(row.totalMatches);
    const wins = Number(row.wins);
    const losses = Number(row.losses);

    if (!result.has(champId)) {
      result.set(champId, new Map());
    }
    result.get(champId)!.set(oppId, {
      wins,
      losses,
      winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 50,
      totalMatches: total,
      avgKills: Number(row.avgKills) || 0,
      avgBalls: Number(row.avgBalls) || 0,
      avgWart: Number(row.avgWart) || 0,
    });
  }

  return result;
}
