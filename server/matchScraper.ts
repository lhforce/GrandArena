/**
 * Match History Scraper — Fetches match data from GATracker's webhook API
 * and stores it in the match_history + match_player_stats tables.
 *
 * Data source: GATracker n8n webhook (mokiMatches endpoint)
 * Each champion has ~900 matches, 100 per page.
 * 179 champions × ~10 pages = ~1,790 API calls for full scrape.
 */

import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db";
import {
  matchHistory,
  matchPlayerStats,
  matchScrapeProgress,
} from "../drizzle/schema";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// ─── Official Scoring Formula (Season 1) ─────────────────────────
// Source: https://x.com/Moku_HQ/status/2021035700108358000 (Feb 10, 2026)
const SCORE_PER_KILL = 80;     // Eliminations: 80 pts each
const SCORE_PER_BALL = 50;     // Deposits: 50 pts each
const SCORE_PER_WART = 0.5625; // Wart distance: 45 pts per 80 units
const SCORE_WIN_BONUS = 300;   // Victory: 300 pts

function calculateMatchScore(
  kills: number,
  balls: number,
  wartDistance: number,
  isWinner: boolean
): number {
  return (
    kills * SCORE_PER_KILL +
    balls * SCORE_PER_BALL +
    wartDistance * SCORE_PER_WART +
    (isWinner ? SCORE_WIN_BONUS : 0)
  );
}

// ─── Season 1 Date Filter ─────────────────────────────────────────
// Only store matches from Season 1 start (Feb 19, 2026) onwards
const SEASON_1_START = new Date("2026-02-19T00:00:00.000Z");

function isAfterSeason1Start(matchDate: string | null | undefined): boolean {
  if (!matchDate) return false;
  return new Date(matchDate) >= SEASON_1_START;
}

// ─── Database Helpers ──────────────────────────────────────────────

async function storeMatchData(entries: GAMatchEntry[]): Promise<{ matchesInserted: number; statsInserted: number; hitPreSeason: boolean }> {
  const db = await getDb();
  if (!db) return { matchesInserted: 0, statsInserted: 0, hitPreSeason: false };

  let matchesInserted = 0;
  let statsInserted = 0;
  let hitPreSeason = false;

  for (const entry of entries) {
    if (entry.isBye || !entry.match) continue;

    const match = entry.match;
    const result = match.result;
    if (!result) continue;

    // Skip pre-Season 1 matches (before Feb 19, 2026)
    const matchDate = entry.matchDate || match.matchDate;
    if (!isAfterSeason1Start(matchDate)) {
      hitPreSeason = true;
      continue;
    }

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
            score: String(calculateMatchScore(
              playerResult?.eliminations ?? 0,
              playerResult?.deposits ?? 0,
              playerResult?.wartDistance ?? 0,
              isWinner
            )),
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

  return { matchesInserted, statsInserted, hitPreSeason };
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
      const { matchesInserted, statsInserted, hitPreSeason } = await storeMatchData(
        response.data
      );
      totalMatchesStored += matchesInserted;
      totalStatsStored += statsInserted;

      // Stop paginating once we've hit pre-Season 1 matches
      if (hitPreSeason) {
        console.log(`[MatchScraper] ${championName}: reached pre-Season 1 data at page ${page}, stopping early`);
        break;
      }
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
 * Get all 179 champion token IDs from game-data.json (local fallback).
 * This is the primary source since the GATracker leaderboard API is unreliable.
 */
function fetchChampionListFromGameData(): Array<{ championTokenId: number; name: string }> {
  try {
    const gameDataPath = resolve(__dirname, "../client/public/game-data.json");
    const raw = JSON.parse(readFileSync(gameDataPath, "utf8"));
    const champions: Array<{ championTokenId: number; name: string }> = [];
    for (const champ of (raw as any).champions || []) {
      const tokenId = Number(champ.championTokenId);
      if (tokenId && !isNaN(tokenId)) {
        champions.push({ championTokenId: tokenId, name: champ.name || `Champion #${tokenId}` });
      }
    }
    console.log(`[MatchScraper] Loaded ${champions.length} champions from game-data.json`);
    return champions;
  } catch (err) {
    console.error("[MatchScraper] Failed to load game-data.json:", err);
    return [];
  }
}

/**
 * Get all 179 champion token IDs — uses local game-data.json first,
 * falls back to GATracker leaderboard API if local data unavailable.
 */
async function fetchChampionList(): Promise<
  Array<{ championTokenId: number; name: string }>
> {
  // Primary: use local game-data.json (always available, no API rate limits)
  const localChampions = fetchChampionListFromGameData();
  if (localChampions.length > 0) {
    return localChampions;
  }

  // Fallback: try GATracker leaderboard API
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

    return entries.map((e: any) => ({
      championTokenId: Number(e.champion_id),
      name: `Champion #${e.champion_id}`,
    }));
  } catch (err) {
    console.error("[MatchScraper] Failed to fetch champion list from API:", err);
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
 * Run Season 1 scrape: clears all existing match data and re-scrapes
 * all champions with the official scoring formula applied.
 * This ensures all records have the correct `score` field.
 */
export async function runSeason1Scrape(): Promise<{
  started: boolean;
  message: string;
}> {
  if (scrapeRunning) {
    return { started: false, message: "Scrape already in progress" };
  }

  const db = await getDb();
  if (!db) return { started: false, message: "Database not available" };

  // Clear all existing match data
  console.log("[MatchScraper] Clearing existing match data for Season 1 re-scrape...");
  await db.execute(sql`DELETE FROM match_player_stats`);
  await db.execute(sql`DELETE FROM match_history`);
  // Reset all scrape progress so all champions get re-scraped
  await db.execute(sql`UPDATE match_scrape_progress SET status = 'pending', pagesScraped = 0, matchesScraped = 0`);
  console.log("[MatchScraper] Cleared. Starting Season 1 re-scrape...");

  // Run full scrape in background
  runFullMatchScrape().catch((err) =>
    console.error("[MatchScraper] Season 1 scrape failed:", err)
  );

  return { started: true, message: "Season 1 re-scrape started — clearing old data and re-scraping all 179 champions with official scoring" };
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

// ─── Incremental Scraper ──────────────────────────────────────────

let incrementalRunning = false;
let lastIncrementalRun: Date | null = null;
let lastIncrementalResult: IncrementalResult | null = null;

export interface IncrementalResult {
  championsChecked: number;
  newMatchesFound: number;
  newStatsFound: number;
  duration: number; // ms
  startedAt: string;
  completedAt: string;
}

/**
 * Incremental scrape: for each champion, fetch page 1 (newest matches)
 * and stop as soon as we encounter a matchId we already have.
 * Much faster than full scrape — typically 1-2 pages per champion.
 */
async function scrapeChampionIncremental(
  championTokenId: number,
  championName: string,
  newestKnownMatchId: string | null
): Promise<{ newMatches: number; newStats: number; latestMatchId: string | null }> {
  const db = await getDb();
  if (!db) return { newMatches: 0, newStats: 0, latestMatchId: null };

  let totalNewMatches = 0;
  let totalNewStats = 0;
  let latestMatchId: string | null = null;
  let page = 1;
  let keepGoing = true;

  while (keepGoing) {
    const response = await fetchMokiMatches(championTokenId, page);
    if (!response || !response.data || response.data.length === 0) break;

    // Track the newest matchId from page 1
    if (page === 1 && response.data.length > 0) {
      latestMatchId = response.data[0].matchId;
    }

    // Check if we've hit already-known data
    let foundKnown = false;
    const newEntries: GAMatchEntry[] = [];

    for (const entry of response.data) {
      if (newestKnownMatchId && entry.matchId === newestKnownMatchId) {
        foundKnown = true;
        break;
      }
      newEntries.push(entry);
    }

    // Store new entries
    if (newEntries.length > 0) {
      const { matchesInserted, statsInserted } = await storeMatchData(newEntries);
      totalNewMatches += matchesInserted;
      totalNewStats += statsInserted;
    }

    // Stop if we found known data or reached the last page
    if (foundKnown || page >= response.pagination.pages) {
      keepGoing = false;
    } else {
      page++;
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Update progress record
  if (latestMatchId || totalNewMatches > 0) {
    await db
      .update(matchScrapeProgress)
      .set({
        newestMatchId: latestMatchId ?? newestKnownMatchId,
        lastIncrementalAt: new Date(),
        incrementalMatchesAdded: totalNewMatches,
        lastScrapedAt: new Date(),
      })
      .where(eq(matchScrapeProgress.championTokenId, championTokenId));
  }

  return { newMatches: totalNewMatches, newStats: totalNewStats, latestMatchId };
}

/**
 * Run incremental match scrape for all champions.
 * Only fetches new matches since the last scrape for each champion.
 * Typically completes in 5-15 minutes vs 30-60 for full scrape.
 */
export async function runIncrementalMatchScrape(): Promise<IncrementalResult> {
  if (incrementalRunning || scrapeRunning) {
    console.log("[MatchScraper] Scrape already in progress, skipping incremental run");
    return lastIncrementalResult ?? {
      championsChecked: 0,
      newMatchesFound: 0,
      newStatsFound: 0,
      duration: 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  incrementalRunning = true;
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  let championsChecked = 0;
  let totalNewMatches = 0;
  let totalNewStats = 0;

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Get all champions with their scrape progress
    const progress = await db.select().from(matchScrapeProgress);

    // Only run incremental on champions that have been fully scraped at least once
    const completedChampions = progress.filter((p) => p.status === "completed");

    if (completedChampions.length === 0) {
      console.log("[MatchScraper] No completed champions found. Run a full scrape first.");
      const result: IncrementalResult = {
        championsChecked: 0,
        newMatchesFound: 0,
        newStatsFound: 0,
        duration: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      lastIncrementalResult = result;
      return result;
    }

    console.log(
      `[MatchScraper] Starting incremental scrape for ${completedChampions.length} champions`
    );

    for (const champ of completedChampions) {
      if (scrapeAborted) break;

      const { newMatches, newStats } = await scrapeChampionIncremental(
        champ.championTokenId,
        champ.championName ?? `Champion #${champ.championTokenId}`,
        champ.newestMatchId
      );

      totalNewMatches += newMatches;
      totalNewStats += newStats;
      championsChecked++;

      if (newMatches > 0) {
        console.log(
          `[MatchScraper] ${champ.championName}: +${newMatches} new matches`
        );
      }

      // Rate limiting between champions
      await sleep(300);
    }

    const duration = Date.now() - startTime;
    console.log(
      `[MatchScraper] Incremental scrape complete. ` +
      `${championsChecked} champions checked, ${totalNewMatches} new matches found ` +
      `in ${Math.round(duration / 1000)}s`
    );

    const result: IncrementalResult = {
      championsChecked,
      newMatchesFound: totalNewMatches,
      newStatsFound: totalNewStats,
      duration,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    lastIncrementalResult = result;
    lastIncrementalRun = new Date();
    return result;
  } catch (err) {
    console.error("[MatchScraper] Incremental scrape error:", err);
    return {
      championsChecked,
      newMatchesFound: totalNewMatches,
      newStatsFound: totalNewStats,
      duration: Date.now() - startTime,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } finally {
    incrementalRunning = false;
  }
}

/**
 * Get the status of the incremental cron job.
 */
export function getIncrementalStatus(): {
  isRunning: boolean;
  lastRun: string | null;
  lastResult: IncrementalResult | null;
  nextRun: string | null;
  cronActive: boolean;
} {
  return {
    isRunning: incrementalRunning,
    lastRun: lastIncrementalRun?.toISOString() ?? null,
    lastResult: lastIncrementalResult,
    nextRun: cronIntervalId ? getNextCronRun() : null,
    cronActive: cronIntervalId !== null,
  };
}

function getNextCronRun(): string {
  if (!lastIncrementalRun) {
    // If never run, next run is ~1 hour from server start
    return new Date(Date.now() + CRON_INTERVAL_MS).toISOString();
  }
  const nextRun = new Date(lastIncrementalRun.getTime() + CRON_INTERVAL_MS);
  return nextRun.toISOString();
}

// ─── Cron Job ─────────────────────────────────────────────────────

const CRON_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let cronIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the hourly incremental match scrape cron job.
 * Safe to call multiple times — won't create duplicate intervals.
 */
export function startMatchScrapeCron(): void {
  if (cronIntervalId) {
    console.log("[MatchScraper] Cron already running");
    return;
  }

  console.log("[MatchScraper] Starting hourly incremental match scrape cron");

  // Run first incremental scrape after a 2-minute delay (let server fully start)
  setTimeout(() => {
    runIncrementalMatchScrape().catch((err) =>
      console.error("[MatchScraper] Initial incremental scrape failed:", err)
    );
  }, 2 * 60 * 1000);

  // Then run every hour
  cronIntervalId = setInterval(() => {
    console.log("[MatchScraper] Hourly cron triggered");
    runIncrementalMatchScrape().catch((err) =>
      console.error("[MatchScraper] Hourly incremental scrape failed:", err)
    );
  }, CRON_INTERVAL_MS);
}

/**
 * Stop the hourly cron job.
 */
export function stopMatchScrapeCron(): void {
  if (cronIntervalId) {
    clearInterval(cronIntervalId);
    cronIntervalId = null;
    console.log("[MatchScraper] Cron stopped");
  }
}
