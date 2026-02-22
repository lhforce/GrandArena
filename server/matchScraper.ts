/**
 * Match History Scraper — Fetches match data from GATracker's webhook API
 * and stores it in the match_history + match_player_stats tables.
 *
 * Data source: GATracker n8n webhook (mokiMatches endpoint)
 * Each champion has ~900 matches, 100 per page.
 * 179 champions × ~10 pages = ~1,790 API calls for full scrape.
 *
 * OPTIMIZED: Parallel champion fetching (5 concurrent) + batch DB inserts
 * + reduced delays → ~5-8 min instead of ~40 min.
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
const REQUEST_DELAY_MS = 200; // Reduced from 800ms — still polite at ~5 req/sec
const INTER_CHAMPION_DELAY_MS = 100; // Reduced from 500ms
const PARALLEL_CHAMPIONS = 5; // Scrape 5 champions concurrently
const DB_BATCH_SIZE = 50; // Batch insert size

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
  speed: string | null; // e.g. "12.5 champs/min"
}

// ─── In-memory scrape state ────────────────────────────────────────

let scrapeRunning = false;
let scrapeAborted = false;
let currentChampionName: string | null = null;
let currentPage = 0;
let scrapeStartedAt: Date | null = null;
let championsCompletedSoFar = 0;

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

// ─── Database Helpers (Batch) ─────────────────────────────────────

async function storeMatchDataBatch(
  entries: GAMatchEntry[]
): Promise<{ matchesInserted: number; statsInserted: number }> {
  const db = await getDb();
  if (!db) return { matchesInserted: 0, statsInserted: 0 };

  let matchesInserted = 0;
  let statsInserted = 0;

  // Collect all match rows and stat rows first
  const matchRows: Array<{
    matchId: string;
    gameType: string;
    winType: string | null;
    teamWon: number | null;
    duration: string;
    matchDate: string | null;
    isBye: boolean;
  }> = [];

  const statRows: Array<{
    matchId: string;
    championTokenId: number;
    championName: string;
    championClass: string | null;
    team: number;
    kills: number;
    balls: number;
    wartDistance: string;
    isWinner: boolean;
    matchDate: string | null;
  }> = [];

  for (const entry of entries) {
    if (entry.isBye || !entry.match) continue;

    const match = entry.match;
    const result = match.result;
    if (!result) continue;

    matchRows.push({
      matchId: entry.matchId,
      gameType: match.gameType || "mokiMayhem",
      winType: result.winType || null,
      teamWon: result.teamWon || null,
      duration: String(result.duration || 0),
      matchDate: entry.matchDate || match.matchDate || null,
      isBye: false,
    });

    // Player stats for each player in the match
    for (const player of match.players) {
      const playerResult = result.players?.find(
        (pr) => pr.mokiId === player.mokiId
      );
      const isWinner = result.teamWon === player.team;

      statRows.push({
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
      });
    }
  }

  // Batch insert matches
  for (let i = 0; i < matchRows.length; i += DB_BATCH_SIZE) {
    const batch = matchRows.slice(i, i + DB_BATCH_SIZE);
    try {
      await db
        .insert(matchHistory)
        .values(batch)
        .onDuplicateKeyUpdate({ set: { matchId: sql`match_id` } }); // no-op on duplicate
      matchesInserted += batch.length;
    } catch (err: any) {
      // Fall back to individual inserts on batch failure
      for (const row of batch) {
        try {
          await db
            .insert(matchHistory)
            .values(row)
            .onDuplicateKeyUpdate({ set: { matchId: row.matchId } });
          matchesInserted++;
        } catch (innerErr: any) {
          if (!innerErr.message?.includes("Duplicate")) {
            console.error("[MatchScraper] Error inserting match:", innerErr.message);
          }
        }
      }
    }
  }

  // Batch insert player stats
  for (let i = 0; i < statRows.length; i += DB_BATCH_SIZE) {
    const batch = statRows.slice(i, i + DB_BATCH_SIZE);
    try {
      await db
        .insert(matchPlayerStats)
        .values(batch)
        .onDuplicateKeyUpdate({
          set: { matchId: sql`match_id`, championTokenId: sql`champion_token_id` },
        }); // no-op on duplicate
      statsInserted += batch.length;
    } catch (err: any) {
      // Fall back to individual inserts on batch failure
      for (const row of batch) {
        try {
          await db
            .insert(matchPlayerStats)
            .values(row)
            .onDuplicateKeyUpdate({
              set: { matchId: row.matchId, championTokenId: row.championTokenId },
            });
          statsInserted++;
        } catch (innerErr: any) {
          if (!innerErr.message?.includes("Duplicate")) {
            console.error("[MatchScraper] Error inserting player stat:", innerErr.message);
          }
        }
      }
    }
  }

  return { matchesInserted, statsInserted };
}

// ─── Single Champion Scraper ──────────────────────────────────────

/**
 * Scrape match history for a single champion (all pages).
 */
async function scrapeChampionMatches(
  championTokenId: number,
  championName: string
): Promise<{
  matchesStored: number;
  statsStored: number;
  totalAvailable: number;
}> {
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
      await sleep(2000);
      const retry = await fetchMokiMatches(championTokenId, page);
      if (!retry) {
        console.error(
          `[MatchScraper] Failed to fetch ${championName} page ${page} after retry`
        );
        break;
      }
      totalPages = retry.pagination.pages;
      totalAvailable = retry.pagination.total;
      const { matchesInserted, statsInserted } = await storeMatchDataBatch(
        retry.data
      );
      totalMatchesStored += matchesInserted;
      totalStatsStored += statsInserted;
    } else {
      totalPages = response.pagination.pages;
      totalAvailable = response.pagination.total;
      const { matchesInserted, statsInserted } = await storeMatchDataBatch(
        response.data
      );
      totalMatchesStored += matchesInserted;
      totalStatsStored += statsInserted;
    }

    // Track newest matchId from page 1 for incremental scraping
    if (page === 1) {
      const resp = await fetchMokiMatches(championTokenId, 1);
      // Already fetched above, just update newestMatchId from the response
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

    // Rate limiting between pages (reduced from 800ms)
    if (page <= totalPages) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Mark as completed and store the newest matchId for incremental scraping
  const finalStatus = scrapeAborted ? "pending" : "completed";

  // Get the newest matchId from the first page
  let newestMatchId: string | null = null;
  try {
    const firstPage = await fetchMokiMatches(championTokenId, 1);
    if (firstPage?.data?.[0]) {
      newestMatchId = firstPage.data[0].matchId;
    }
  } catch {
    // ignore — not critical
  }

  await db
    .update(matchScrapeProgress)
    .set({
      status: finalStatus,
      matchesScraped: totalMatchesStored,
      lastScrapedAt: new Date(),
      newestMatchId,
    })
    .where(eq(matchScrapeProgress.championTokenId, championTokenId));

  return {
    matchesStored: totalMatchesStored,
    statsStored: totalStatsStored,
    totalAvailable,
  };
}

// ─── Champion List ────────────────────────────────────────────────

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

    return entries.map((e: any) => ({
      championTokenId: Number(e.champion_id),
      name: `Champion #${e.champion_id}`,
    }));
  } catch (err) {
    console.error("[MatchScraper] Failed to fetch champion list:", err);
    return [];
  }
}

// ─── Parallel Full Scraper ────────────────────────────────────────

/**
 * Process a batch of champions in parallel.
 */
async function scrapeChampionBatch(
  batch: Array<{ championTokenId: number; name: string }>,
  completedSet: Set<number>,
  totalChampions: number
): Promise<void> {
  const promises = batch.map(async (champ) => {
    if (scrapeAborted) return;
    if (completedSet.has(champ.championTokenId)) {
      championsCompletedSoFar++;
      return;
    }

    currentChampionName = champ.name;

    const result = await scrapeChampionMatches(
      champ.championTokenId,
      champ.name
    );

    championsCompletedSoFar++;
    console.log(
      `[MatchScraper] ${champ.name}: ${result.matchesStored} matches, ${result.statsStored} stats ` +
        `(${championsCompletedSoFar}/${totalChampions})`
    );
  });

  await Promise.all(promises);
}

/**
 * Run the full match history scrape for all champions.
 * OPTIMIZED: Processes champions in parallel batches of 5.
 * Estimated time: ~5-8 minutes (down from ~40 minutes).
 */
export async function runFullMatchScrape(): Promise<void> {
  if (scrapeRunning) {
    console.log("[MatchScraper] Scrape already in progress");
    return;
  }

  scrapeRunning = true;
  scrapeAborted = false;
  scrapeStartedAt = new Date();
  championsCompletedSoFar = 0;

  try {
    const db = await getDb();
    if (!db) {
      console.error("[MatchScraper] Database not available");
      return;
    }

    // Get champion list from leaderboard
    const champions = await fetchChampionList();
    console.log(
      `[MatchScraper] Starting PARALLEL scrape for ${champions.length} champions (${PARALLEL_CHAMPIONS} concurrent)`
    );

    // Check which champions already have completed scrapes
    const existingProgress = await db.select().from(matchScrapeProgress);
    const completedSet = new Set(
      existingProgress
        .filter((p) => p.status === "completed")
        .map((p) => p.championTokenId)
    );

    // Count already completed
    championsCompletedSoFar = completedSet.size;

    // Process in parallel batches
    for (let i = 0; i < champions.length; i += PARALLEL_CHAMPIONS) {
      if (scrapeAborted) {
        console.log("[MatchScraper] Scrape aborted by user");
        break;
      }

      const batch = champions.slice(i, i + PARALLEL_CHAMPIONS);
      await scrapeChampionBatch(batch, completedSet, champions.length);

      // Small delay between batches to avoid overwhelming the API
      if (i + PARALLEL_CHAMPIONS < champions.length) {
        await sleep(INTER_CHAMPION_DELAY_MS);
      }
    }

    console.log(
      `[MatchScraper] Scrape complete. ${championsCompletedSoFar}/${champions.length} champions processed.`
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

  // Estimate time remaining + speed
  let estimatedTimeRemaining: string | null = null;
  let speed: string | null = null;
  if (scrapeRunning && scrapeStartedAt && championsCompletedSoFar > 0) {
    const elapsed = Date.now() - scrapeStartedAt.getTime();
    const elapsedMin = elapsed / 60000;
    const champsPerMin = championsCompletedSoFar / elapsedMin;
    speed = `${champsPerMin.toFixed(1)} champs/min`;

    const remaining =
      ((totalChampions - championsCompletedSoFar) / champsPerMin) * 60000;
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
    speed,
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
 * Incremental scrape for a single champion: fetch page 1 (newest matches)
 * and stop as soon as we encounter a matchId we already have.
 */
async function scrapeChampionIncremental(
  championTokenId: number,
  championName: string,
  newestKnownMatchId: string | null
): Promise<{
  newMatches: number;
  newStats: number;
  latestMatchId: string | null;
}> {
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

    // Store new entries using batch insert
    if (newEntries.length > 0) {
      const { matchesInserted, statsInserted } =
        await storeMatchDataBatch(newEntries);
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

  return {
    newMatches: totalNewMatches,
    newStats: totalNewStats,
    latestMatchId,
  };
}

/**
 * Run incremental match scrape for all champions IN PARALLEL.
 * Only fetches new matches since the last scrape for each champion.
 * Processes 5 champions concurrently for speed.
 */
export async function runIncrementalMatchScrape(): Promise<IncrementalResult> {
  if (incrementalRunning || scrapeRunning) {
    console.log(
      "[MatchScraper] Scrape already in progress, skipping incremental run"
    );
    return (
      lastIncrementalResult ?? {
        championsChecked: 0,
        newMatchesFound: 0,
        newStatsFound: 0,
        duration: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    );
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
      console.log(
        "[MatchScraper] No completed champions found. Run a full scrape first."
      );
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
      `[MatchScraper] Starting parallel incremental scrape for ${completedChampions.length} champions (${PARALLEL_CHAMPIONS} concurrent)`
    );

    // Process in parallel batches
    for (let i = 0; i < completedChampions.length; i += PARALLEL_CHAMPIONS) {
      if (scrapeAborted) break;

      const batch = completedChampions.slice(i, i + PARALLEL_CHAMPIONS);

      const batchResults = await Promise.all(
        batch.map(async (champ) => {
          const { newMatches, newStats } = await scrapeChampionIncremental(
            champ.championTokenId,
            champ.championName ?? `Champion #${champ.championTokenId}`,
            champ.newestMatchId
          );
          return { newMatches, newStats, name: champ.championName };
        })
      );

      for (const r of batchResults) {
        totalNewMatches += r.newMatches;
        totalNewStats += r.newStats;
        championsChecked++;
        if (r.newMatches > 0) {
          console.log(
            `[MatchScraper] ${r.name}: +${r.newMatches} new matches`
          );
        }
      }

      // Small delay between batches
      if (i + PARALLEL_CHAMPIONS < completedChampions.length) {
        await sleep(INTER_CHAMPION_DELAY_MS);
      }
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
