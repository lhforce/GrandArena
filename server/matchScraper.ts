/**
 * Match History Scraper — Fetches match data from GATracker's webhook API
 * and stores it in the match_history + match_player_stats tables.
 *
 * Data source: GATracker n8n webhook (mokiMatches endpoint)
 * Each champion has ~900 matches, 100 per page.
 * 179 champions × ~10 pages = ~1,790 API calls for full scrape.
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  matchHistory,
  matchPlayerStats,
  matchScrapeProgress,
} from "../drizzle/schema";

const GATRACKER_BASE = "https://botto-n8n-botto.eelnl8.easypanel.host/webhook";
const MATCHES_PER_PAGE = 100;
const REQUEST_DELAY_MS = 800; // Rate limit: ~1.2 req/sec to be polite

// Standard headers required by the GATracker API
const GATRACKER_HEADERS = {
  Origin: "https://gatracker.xyz",
  Referer: "https://gatracker.xyz/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

// ─── Types ─────────────────────────────────────────────────────────

interface GAMatchPlayer {
  mokiId: string;
  team: number;
  name: string;
  tokenId: number;
  imageUrl: string;
  class: string;
}

interface GAMatchResult {
  players: Array<{
    mokiId: string;
    deposits: number;
    eliminations: number;
    wartDistance: number;
  }>;
  winType: string;
  teamWon: number;
  duration: number;
}

interface GAMatch {
  id: string;
  gameType: string;
  state: string;
  isBye: boolean;
  players: GAMatchPlayer[];
  result: GAMatchResult;
  matchDate: string;
}

interface GAMatchEntry {
  id: string;
  matchId: string;
  mokiId: string;
  isBye: boolean;
  matchDate: string;
  results: {
    winType: string;
    deposits: number;
    eliminations: number;
    wartDistance: number;
  };
  match: GAMatch;
}

interface GAMatchResponse {
  data: GAMatchEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ScrapeProgress {
  totalChampions: number;
  championsCompleted: number;
  championsInProgress: number;
  championsFailed: number;
  totalMatchesStored: number;
  totalPlayerStatsStored: number;
  currentChampion: string | null;
  currentPage: number;
  isRunning: boolean;
  startedAt: string | null;
  estimatedTimeRemaining: string | null;
}

// ─── In-memory scrape state ────────────────────────────────────────

let scrapeRunning = false;
let scrapeAborted = false;
let currentChampionName: string | null = null;
let currentPage = 0;
let scrapeStartedAt: Date | null = null;

// ─── API Helpers ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMokiMatches(
  championTokenId: number,
  page: number = 1
): Promise<GAMatchResponse | null> {
  const url = `${GATRACKER_BASE}/mokiMatches?id=${championTokenId}&page=${page}&limit=${MATCHES_PER_PAGE}`;

  try {
    const resp = await fetch(url, { headers: GATRACKER_HEADERS });
    if (!resp.ok) {
      console.error(
        `[MatchScraper] HTTP ${resp.status} for champion ${championTokenId} page ${page}`
      );
      return null;
    }

    const raw = await resp.json();

    // Response can be either { data: [...], pagination: {...} }
    // or [{ data: [...], pagination: {...} }]
    if (Array.isArray(raw) && raw.length > 0 && raw[0].data) {
      return raw[0] as GAMatchResponse;
    }
    if (raw.data && raw.pagination) {
      return raw as GAMatchResponse;
    }

    console.error(
      `[MatchScraper] Unexpected response format for champion ${championTokenId}`
    );
    return null;
  } catch (err) {
    console.error(
      `[MatchScraper] Fetch error for champion ${championTokenId} page ${page}:`,
      err
    );
    return null;
  }
}

// ─── Database Helpers ──────────────────────────────────────────────

async function storeMatchData(entries: GAMatchEntry[]): Promise<{ matchesInserted: number; statsInserted: number }> {
  const db = await getDb();
  if (!db) return { matchesInserted: 0, statsInserted: 0 };

  let matchesInserted = 0;
  let statsInserted = 0;

  for (const entry of entries) {
    if (entry.isBye || !entry.match) continue;

    const match = entry.match;
    const result = match.result;
    if (!result) continue;

    // Insert match (ignore duplicates)
    try {
      await db
        .insert(matchHistory)
        .values({
          matchId: entry.matchId,
          gameType: match.gameType || "mokiMayhem",
          winType: result.winType || null,
          teamWon: result.teamWon || null,
          duration: String(result.duration || 0),
          matchDate: entry.matchDate || match.matchDate || null,
          isBye: false,
        })
        .onDuplicateKeyUpdate({ set: { matchId: entry.matchId } }); // no-op on duplicate
      matchesInserted++;
    } catch (err: any) {
      // Duplicate key is fine, just skip
      if (!err.message?.includes("Duplicate")) {
        console.error("[MatchScraper] Error inserting match:", err.message);
      }
    }

    // Insert player stats for each player in the match
    for (const player of match.players) {
      // Find this player's stats in the result
      const playerResult = result.players?.find(
        (pr) => pr.mokiId === player.mokiId
      );

      const isWinner = result.teamWon === player.team;

      try {
        await db
          .insert(matchPlayerStats)
          .values({
            matchId: entry.matchId,
            championTokenId: player.tokenId,
            championName: player.name,
            championClass: player.class || null,
            team: player.team,
            kills: playerResult?.eliminations ?? 0,
            balls: playerResult?.deposits ?? 0,
            wartDistance: String(playerResult?.wartDistance ?? 0),
            isWinner,
            matchDate: entry.matchDate || match.matchDate || null,
          })
          .onDuplicateKeyUpdate({
            set: { matchId: entry.matchId, championTokenId: player.tokenId },
          }); // no-op on duplicate
        statsInserted++;
      } catch (err: any) {
        if (!err.message?.includes("Duplicate")) {
          console.error(
            "[MatchScraper] Error inserting player stat:",
            err.message
          );
        }
      }
    }
  }

  return { matchesInserted, statsInserted };
}

// ─── Main Scraper ──────────────────────────────────────────────────

/**
 * Scrape match history for a single champion (all pages).
 */
async function scrapeChampionMatches(
  championTokenId: number,
  championName: string
): Promise<{ matchesStored: number; statsStored: number; totalAvailable: number }> {
  const db = await getDb();
  if (!db) return { matchesStored: 0, statsStored: 0, totalAvailable: 0 };

  let totalMatchesStored = 0;
  let totalStatsStored = 0;
  let totalAvailable = 0;
  let page = 1;
  let totalPages = 1;

  // Update progress to in_progress
  await db
    .insert(matchScrapeProgress)
    .values({
      championTokenId,
      championName,
      status: "in_progress",
      pagesScraped: 0,
    })
    .onDuplicateKeyUpdate({
      set: { status: "in_progress", pagesScraped: 0 },
    });

  while (page <= totalPages) {
    if (scrapeAborted) break;

    currentPage = page;

    const response = await fetchMokiMatches(championTokenId, page);
    if (!response) {
      // Retry once after a longer delay
      await sleep(3000);
      const retry = await fetchMokiMatches(championTokenId, page);
      if (!retry) {
        console.error(
          `[MatchScraper] Failed to fetch ${championName} page ${page} after retry`
        );
        break;
      }
      // Use retry result
      totalPages = retry.pagination.pages;
      totalAvailable = retry.pagination.total;
      const { matchesInserted, statsInserted } = await storeMatchData(
        retry.data
      );
      totalMatchesStored += matchesInserted;
      totalStatsStored += statsInserted;
    } else {
      totalPages = response.pagination.pages;
      totalAvailable = response.pagination.total;
      const { matchesInserted, statsInserted } = await storeMatchData(
        response.data
      );
      totalMatchesStored += matchesInserted;
      totalStatsStored += statsInserted;
    }

    // Update progress
    await db
      .update(matchScrapeProgress)
      .set({
        pagesScraped: page,
        totalPages,
        totalMatchesAvailable: totalAvailable,
        matchesScraped: totalMatchesStored,
        lastScrapedAt: new Date(),
      })
      .where(eq(matchScrapeProgress.championTokenId, championTokenId));

    page++;

    // Rate limiting
    if (page <= totalPages) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Mark as completed
  const finalStatus = scrapeAborted ? "pending" : "completed";
  await db
    .update(matchScrapeProgress)
    .set({
      status: finalStatus,
      matchesScraped: totalMatchesStored,
      lastScrapedAt: new Date(),
    })
    .where(eq(matchScrapeProgress.championTokenId, championTokenId));

  return {
    matchesStored: totalMatchesStored,
    statsStored: totalStatsStored,
    totalAvailable,
  };
}

/**
 * Get all 179 champion token IDs from the GATracker leaderboard API.
 */
async function fetchChampionList(): Promise<
  Array<{ championTokenId: number; name: string }>
> {
  try {
    const resp = await fetch(`${GATRACKER_BASE}/leaderboardSeason1`, {
      headers: GATRACKER_HEADERS,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const raw = await resp.json();
    let entries: any[];

    if (Array.isArray(raw) && raw.length > 0 && raw[0].data) {
      entries = raw[0].data;
    } else if (Array.isArray(raw)) {
      entries = raw;
    } else {
      entries = raw.data || [];
    }

    // The leaderboard only has champion_id, not names
    // We'll get names from the first match response for each champion
    return entries.map((e: any) => ({
      championTokenId: Number(e.champion_id),
      name: `Champion #${e.champion_id}`, // Will be updated from match data
    }));
  } catch (err) {
    console.error("[MatchScraper] Failed to fetch champion list:", err);
    return [];
  }
}

/**
 * Run the full match history scrape for all champions.
 * This is a long-running process (~30-60 minutes for all 179 champions).
 */
export async function runFullMatchScrape(): Promise<void> {
  if (scrapeRunning) {
    console.log("[MatchScraper] Scrape already in progress");
    return;
  }

  scrapeRunning = true;
  scrapeAborted = false;
  scrapeStartedAt = new Date();

  try {
    const db = await getDb();
    if (!db) {
      console.error("[MatchScraper] Database not available");
      return;
    }

    // Get champion list from leaderboard
    const champions = await fetchChampionList();
    console.log(
      `[MatchScraper] Starting scrape for ${champions.length} champions`
    );

    // Check which champions already have completed scrapes
    const existingProgress = await db
      .select()
      .from(matchScrapeProgress);

    const completedSet = new Set(
      existingProgress
        .filter((p) => p.status === "completed")
        .map((p) => p.championTokenId)
    );

    let completed = 0;
    for (const champ of champions) {
      if (scrapeAborted) {
        console.log("[MatchScraper] Scrape aborted by user");
        break;
      }

      // Skip already completed champions
      if (completedSet.has(champ.championTokenId)) {
        completed++;
        continue;
      }

      currentChampionName = champ.name;
      console.log(
        `[MatchScraper] Scraping ${champ.name} (${champ.championTokenId}) — ${completed + 1}/${champions.length}`
      );

      const result = await scrapeChampionMatches(
        champ.championTokenId,
        champ.name
      );

      console.log(
        `[MatchScraper] ${champ.name}: ${result.matchesStored} matches, ${result.statsStored} player stats (${result.totalAvailable} total available)`
      );

      completed++;

      // Small delay between champions
      await sleep(500);
    }

    console.log(
      `[MatchScraper] Scrape complete. ${completed}/${champions.length} champions processed.`
    );
  } catch (err) {
    console.error("[MatchScraper] Fatal error:", err);
  } finally {
    scrapeRunning = false;
    currentChampionName = null;
    currentPage = 0;
  }
}

/**
 * Stop the running scrape gracefully.
 */
export function stopMatchScrape(): void {
  scrapeAborted = true;
}

/**
 * Get the current scrape progress.
 */
export async function getMatchScrapeProgress(): Promise<ScrapeProgress> {
  const db = await getDb();

  let totalChampions = 179;
  let championsCompleted = 0;
  let championsInProgress = 0;
  let championsFailed = 0;

  if (db) {
    const progress = await db.select().from(matchScrapeProgress);
    totalChampions = Math.max(progress.length, 179);
    championsCompleted = progress.filter((p) => p.status === "completed").length;
    championsInProgress = progress.filter(
      (p) => p.status === "in_progress"
    ).length;
    championsFailed = progress.filter((p) => p.status === "failed").length;
  }

  // Count stored records
  let totalMatchesStored = 0;
  let totalPlayerStatsStored = 0;
  if (db) {
    const matchCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(matchHistory);
    totalMatchesStored = matchCount[0]?.count ?? 0;

    const statsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(matchPlayerStats);
    totalPlayerStatsStored = statsCount[0]?.count ?? 0;
  }

  // Estimate time remaining
  let estimatedTimeRemaining: string | null = null;
  if (scrapeRunning && scrapeStartedAt && championsCompleted > 0) {
    const elapsed = Date.now() - scrapeStartedAt.getTime();
    const msPerChampion = elapsed / championsCompleted;
    const remaining = (totalChampions - championsCompleted) * msPerChampion;
    const minutes = Math.ceil(remaining / 60000);
    estimatedTimeRemaining =
      minutes > 60
        ? `~${Math.ceil(minutes / 60)}h ${minutes % 60}m`
        : `~${minutes}m`;
  }

  return {
    totalChampions,
    championsCompleted,
    championsInProgress,
    championsFailed,
    totalMatchesStored,
    totalPlayerStatsStored,
    currentChampion: currentChampionName,
    currentPage,
    isRunning: scrapeRunning,
    startedAt: scrapeStartedAt?.toISOString() ?? null,
    estimatedTimeRemaining,
  };
}

/**
 * Scrape matches for a single champion by token ID (for targeted refresh).
 */
export async function scrapeSingleChampion(
  championTokenId: number,
  championName?: string
): Promise<{
  matchesStored: number;
  statsStored: number;
  totalAvailable: number;
}> {
  const name = championName || `Champion #${championTokenId}`;
  return scrapeChampionMatches(championTokenId, name);
}
