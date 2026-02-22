/**
 * Match History Scraper — Fetches match data from GATracker's webhook API
 * and stores it in the match_history + match_player_stats tables.
 *
 * Data source: GATracker n8n webhook (mokiMatches endpoint)
 *
 * SEASON 1 FILTER: Only fetches/stores matches from Feb 19, 2026 onwards.
 * Stops paginating when it hits matches older than the cutoff date.
 *
 * OPTIMIZED v4: 10 concurrent + Season 1 date filter + auto-resume
 * + batch DB inserts + reduced delays → very fast (~1-2 min for 3 days of data).
 */

import { eq, sql, lt, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  matchHistory,
  matchPlayerStats,
  matchScrapeProgress,
} from "../drizzle/schema";

const GATRACKER_BASE = "https://botto-n8n-botto.eelnl8.easypanel.host/webhook";
const MATCHES_PER_PAGE = 100;
const REQUEST_DELAY_MS = 150; // 150ms between pages (~7 req/sec per champion)
const INTER_BATCH_DELAY_MS = 50; // 50ms between batches
const PARALLEL_CHAMPIONS = 10; // 10 champions concurrently
const DB_BATCH_SIZE = 100; // Larger batch inserts

/**
 * Season 1 officially started on February 19, 2026.
 * We only want match data from this date onwards.
 * Format matches the API's matchDate field: "YYYY-MM-DD"
 */
const SEASON_1_START_DATE = "2026-02-19";

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
  speed: string | null;
  season1Only: boolean;
}

// ─── In-memory scrape state ────────────────────────────────────────

let scrapeRunning = false;
let scrapeAborted = false;
let currentChampionName: string | null = null;
let currentPage = 0;
let scrapeStartedAt: Date | null = null;
let championsCompletedSoFar = 0;

// ─── Date Helpers ─────────────────────────────────────────────────

/**
 * Check if a match date string is before the Season 1 start date.
 * Returns true if the match is PRE-season (should be excluded).
 */
function isBeforeSeason1(matchDate: string | null | undefined): boolean {
  if (!matchDate) return false; // If no date, include it (conservative)
  // matchDate format can be "YYYY-MM-DD" or ISO string "2026-02-19T..."
  const dateStr = matchDate.substring(0, 10); // Extract YYYY-MM-DD
  return dateStr < SEASON_1_START_DATE;
}

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

    const matchDate = entry.matchDate || match.matchDate || null;

    // SEASON 1 FILTER: Skip matches before Feb 19, 2026
    if (isBeforeSeason1(matchDate)) continue;

    matchRows.push({
      matchId: entry.matchId,
      gameType: match.gameType || "mokiMayhem",
      winType: result.winType || null,
      teamWon: result.teamWon || null,
      duration: String(result.duration || 0),
      matchDate,
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
        matchDate,
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
        .onDuplicateKeyUpdate({ set: { matchId: sql`matchId` } });
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
          set: { matchId: sql`matchId`, championTokenId: sql`championTokenId` },
        });
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

// ─── Single Champion Scraper (with date-based early stop) ────────

/**
 * Scrape match history for a single champion.
 * SEASON 1 MODE: Stops paginating as soon as ALL entries on a page
 * are before Feb 19, 2026 (since matches are sorted newest-first).
 */
async function scrapeChampionMatches(
  championTokenId: number,
  championName: string,
  startFromPage: number = 1
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
  let page = startFromPage;
  let totalPages = 1;
  let newestMatchId: string | null = null;

  // Update progress to in_progress
  await db
    .insert(matchScrapeProgress)
    .values({
      championTokenId,
      championName,
      status: "in_progress",
      pagesScraped: Math.max(0, startFromPage - 1),
    })
    .onDuplicateKeyUpdate({
      set: { status: "in_progress" },
    });

  while (page <= totalPages) {
    if (scrapeAborted) break;

    currentPage = page;

    let response = await fetchMokiMatches(championTokenId, page);
    if (!response) {
      // Retry once after a longer delay
      await sleep(1500);
      response = await fetchMokiMatches(championTokenId, page);
      if (!response) {
        console.error(
          `[MatchScraper] Failed to fetch ${championName} page ${page} after retry`
        );
        break;
      }
    }

    totalPages = response.pagination.pages;
    totalAvailable = response.pagination.total;

    // Capture newestMatchId from page 1 (no extra API call!)
    if (page === 1 && response.data.length > 0) {
      newestMatchId = response.data[0].matchId;
    }

    // SEASON 1 DATE FILTER: Check if we've gone past the cutoff date.
    // Matches are returned newest-first, so once we see a page where
    // the LAST entry is before Season 1, we can stop after processing
    // the Season 1 entries on this page.
    let hitPreSeason = false;
    if (response.data.length > 0) {
      const lastEntry = response.data[response.data.length - 1];
      const lastDate = lastEntry.matchDate || lastEntry.match?.matchDate;
      if (isBeforeSeason1(lastDate)) {
        hitPreSeason = true;
        // Some entries on this page may still be Season 1 — storeMatchDataBatch
        // will filter them out via isBeforeSeason1 check
      }
    }

    const { matchesInserted, statsInserted } = await storeMatchDataBatch(response.data);
    totalMatchesStored += matchesInserted;
    totalStatsStored += statsInserted;

    // Update progress every page
    await db
      .update(matchScrapeProgress)
      .set({
        pagesScraped: page,
        totalPages,
        totalMatchesAvailable: totalAvailable,
        matchesScraped: sql`matchesScraped + ${matchesInserted}`,
        lastScrapedAt: new Date(),
      })
      .where(eq(matchScrapeProgress.championTokenId, championTokenId));

    // EARLY STOP: If we hit pre-season data, no need to fetch more pages
    if (hitPreSeason) {
      console.log(
        `[MatchScraper] ${championName}: Hit pre-Season 1 data on page ${page}, stopping early`
      );
      break;
    }

    page++;

    // Rate limiting between pages
    if (page <= totalPages) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Mark as completed — newestMatchId already captured from page 1 above
  const finalStatus = scrapeAborted ? "pending" : "completed";

  // For resume case where we started from page > 1, we need to get newestMatchId
  if (!newestMatchId && startFromPage > 1) {
    // Fetch page 1 just to get the newest matchId
    const page1 = await fetchMokiMatches(championTokenId, 1);
    if (page1 && page1.data.length > 0) {
      newestMatchId = page1.data[0].matchId;
    }
  }

  await db
    .update(matchScrapeProgress)
    .set({
      status: finalStatus,
      lastScrapedAt: new Date(),
      newestMatchId,
      lastIncrementalAt: new Date(),
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
 * Also tries to resolve names from the game data file.
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
    } else if (raw.data && Array.isArray(raw.data)) {
      entries = raw.data;
    } else if (Array.isArray(raw)) {
      entries = raw;
    } else {
      entries = [];
    }

    // Try to load names from game data
    let nameMap = new Map<number, string>();
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const gameDataPath = path.resolve(process.cwd(), "client/public/game-data.json");
      const gameDataRaw = await fs.readFile(gameDataPath, "utf-8");
      const gameData = JSON.parse(gameDataRaw);
      for (const scheme of gameData.schemes || []) {
        for (const champ of scheme.champions || []) {
          if (champ.championTokenId) {
            nameMap.set(Number(champ.championTokenId), champ.name || `Champion #${champ.championTokenId}`);
          }
        }
      }
    } catch {
      // game-data.json not available, use fallback names
    }

    return entries.map((e: any) => ({
      championTokenId: Number(e.champion_id),
      name: nameMap.get(Number(e.champion_id)) || e.name || `Champion #${e.champion_id}`,
    }));
  } catch (err) {
    console.error("[MatchScraper] Failed to fetch champion list:", err);
    return [];
  }
}

// ─── Clear Pre-Season Data ───────────────────────────────────────

/**
 * Delete all match data from before Season 1 (Feb 19, 2026).
 * Also resets scrape progress so we get a clean re-scrape.
 */
export async function clearPreSeasonData(): Promise<{
  matchesDeleted: number;
  statsDeleted: number;
  progressReset: number;
}> {
  const db = await getDb();
  if (!db) return { matchesDeleted: 0, statsDeleted: 0, progressReset: 0 };

  console.log(`[MatchScraper] Clearing all match data before ${SEASON_1_START_DATE}...`);

  // Delete player stats for pre-season matches
  const statsResult = await db.execute(
    sql`DELETE FROM match_player_stats WHERE matchDate < ${SEASON_1_START_DATE} OR matchDate IS NULL`
  );
  const statsDeleted = (statsResult as any)[0]?.affectedRows ?? 0;

  // Delete pre-season matches
  const matchResult = await db.execute(
    sql`DELETE FROM match_history WHERE matchDate < ${SEASON_1_START_DATE} OR matchDate IS NULL`
  );
  const matchesDeleted = (matchResult as any)[0]?.affectedRows ?? 0;

  // Reset all scrape progress so we re-scrape everything fresh
  const progressResult = await db.execute(
    sql`DELETE FROM match_scrape_progress`
  );
  const progressReset = (progressResult as any)[0]?.affectedRows ?? 0;

  console.log(
    `[MatchScraper] Cleared: ${matchesDeleted} matches, ${statsDeleted} player stats, ` +
      `${progressReset} progress records deleted`
  );

  return { matchesDeleted, statsDeleted, progressReset };
}

// ─── Parallel Full Scraper ────────────────────────────────────────

/**
 * Process a batch of champions in parallel.
 * Each champion is wrapped in try/catch so one failure doesn't kill the batch.
 */
async function scrapeChampionBatch(
  batch: Array<{ championTokenId: number; name: string; resumeFromPage?: number }>,
  totalChampions: number
): Promise<void> {
  const promises = batch.map(async (champ) => {
    if (scrapeAborted) return;

    currentChampionName = champ.name;

    try {
      const result = await scrapeChampionMatches(
        champ.championTokenId,
        champ.name,
        champ.resumeFromPage || 1
      );

      championsCompletedSoFar++;
      console.log(
        `[MatchScraper] ✓ ${champ.name} (#${champ.championTokenId}): ${result.matchesStored} matches ` +
          `(${championsCompletedSoFar}/${totalChampions})`
      );
    } catch (err) {
      console.error(
        `[MatchScraper] ✗ Error scraping ${champ.name} (#${champ.championTokenId}):`,
        err
      );
      championsCompletedSoFar++;
    }
  });

  await Promise.all(promises);
}

/**
 * Run the full match history scrape for all champions.
 * SEASON 1 MODE: Only fetches matches from Feb 19, 2026 onwards.
 * Stops early per champion when hitting pre-season data.
 * Estimated time: ~1-2 minutes for 3 days of data.
 */
export async function runFullMatchScrape(): Promise<void> {
  if (scrapeRunning) {
    console.log("[MatchScraper] Scrape already in progress, ignoring duplicate request");
    return;
  }

  scrapeRunning = true;
  scrapeAborted = false;
  scrapeStartedAt = new Date();
  championsCompletedSoFar = 0;

  console.log(`[MatchScraper] === SEASON 1 SCRAPE STARTING (from ${SEASON_1_START_DATE}) ===`);

  try {
    const db = await getDb();
    if (!db) {
      console.error("[MatchScraper] Database not available, aborting");
      return;
    }

    // Get champion list from leaderboard
    const champions = await fetchChampionList();
    console.log(`[MatchScraper] Fetched ${champions.length} champions from leaderboard`);

    if (champions.length === 0) {
      console.error("[MatchScraper] No champions found from leaderboard API, aborting");
      return;
    }

    // Check existing progress in DB
    const existingProgress = await db.select().from(matchScrapeProgress);
    const progressMap = new Map(
      existingProgress.map((p) => [p.championTokenId, p])
    );

    // Build the work queue: skip completed, resume in-progress, start new
    const workQueue: Array<{ championTokenId: number; name: string; resumeFromPage?: number }> = [];
    let alreadyCompleted = 0;
    let resuming = 0;

    for (const champ of champions) {
      const progress = progressMap.get(champ.championTokenId);

      if (progress?.status === "completed") {
        alreadyCompleted++;
        continue;
      }

      if (progress?.status === "in_progress" || progress?.status === "pending") {
        // Resume from where we left off (next page after last scraped)
        const resumePage = (progress.pagesScraped ?? 0) + 1;
        if (resumePage <= (progress.totalPages ?? 10)) {
          workQueue.push({
            ...champ,
            resumeFromPage: resumePage,
          });
          resuming++;
          continue;
        }
      }

      // New champion — start from page 1
      workQueue.push({ ...champ, resumeFromPage: 1 });
    }

    championsCompletedSoFar = alreadyCompleted;
    const totalToProcess = champions.length;

    console.log(
      `[MatchScraper] Work queue: ${workQueue.length} to scrape ` +
        `(${alreadyCompleted} already done, ${resuming} resuming) ` +
        `— ${PARALLEL_CHAMPIONS} concurrent, Season 1 only`
    );

    if (workQueue.length === 0) {
      console.log("[MatchScraper] All champions already scraped!");
      return;
    }

    // Process in parallel batches
    for (let i = 0; i < workQueue.length; i += PARALLEL_CHAMPIONS) {
      if (scrapeAborted) {
        console.log("[MatchScraper] Scrape aborted by user");
        break;
      }

      const batch = workQueue.slice(i, i + PARALLEL_CHAMPIONS);
      const batchNum = Math.floor(i / PARALLEL_CHAMPIONS) + 1;
      const totalBatches = Math.ceil(workQueue.length / PARALLEL_CHAMPIONS);
      console.log(
        `[MatchScraper] Processing batch ${batchNum}/${totalBatches} ` +
          `(${batch.map((c) => c.name).join(", ")})`
      );

      await scrapeChampionBatch(batch, totalToProcess);

      // Small delay between batches
      if (i + PARALLEL_CHAMPIONS < workQueue.length) {
        await sleep(INTER_BATCH_DELAY_MS);
      }
    }

    console.log(
      `[MatchScraper] === SEASON 1 SCRAPE COMPLETE === ` +
        `${championsCompletedSoFar}/${totalToProcess} champions processed`
    );
  } catch (err) {
    console.error("[MatchScraper] Fatal error in full scrape:", err);
  } finally {
    scrapeRunning = false;
    currentChampionName = null;
    currentPage = 0;
  }
}

/**
 * Run a clean Season 1 scrape: clear old data first, then scrape fresh.
 */
export async function runSeason1Scrape(): Promise<void> {
  console.log("[MatchScraper] === CLEAN SEASON 1 SCRAPE ===");
  console.log("[MatchScraper] Step 1: Clearing pre-season data...");
  await clearPreSeasonData();
  console.log("[MatchScraper] Step 2: Running fresh scrape...");
  await runFullMatchScrape();
}

/**
 * Stop the running scrape gracefully.
 */
export function stopMatchScrape(): void {
  console.log("[MatchScraper] Stop requested");
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
    season1Only: true,
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
 * Season 1 filter is applied via storeMatchDataBatch.
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

    // Store new entries using batch insert (Season 1 filter applied inside)
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
 * Processes 10 champions concurrently for speed.
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
          try {
            const { newMatches, newStats } = await scrapeChampionIncremental(
              champ.championTokenId,
              champ.championName ?? `Champion #${champ.championTokenId}`,
              champ.newestMatchId
            );
            return { newMatches, newStats, name: champ.championName };
          } catch (err) {
            console.error(
              `[MatchScraper] Error in incremental scrape for ${champ.championName}:`,
              err
            );
            return { newMatches: 0, newStats: 0, name: champ.championName };
          }
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
        await sleep(INTER_BATCH_DELAY_MS);
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
 * Also auto-resumes any interrupted full scrapes on startup.
 * Safe to call multiple times — won't create duplicate intervals.
 */
export function startMatchScrapeCron(): void {
  if (cronIntervalId) {
    console.log("[MatchScraper] Cron already running");
    return;
  }

  console.log("[MatchScraper] Starting hourly incremental match scrape cron");

  // Auto-resume: check for incomplete scrapes after a 10-second delay
  setTimeout(async () => {
    try {
      const db = await getDb();
      if (!db) return;

      const progress = await db.select().from(matchScrapeProgress);
      const incomplete = progress.filter(
        (p) => p.status === "in_progress" || p.status === "pending"
      );
      const completed = progress.filter((p) => p.status === "completed");

      // If there are incomplete champions AND not all are done, auto-resume
      if (incomplete.length > 0 || completed.length < 179) {
        console.log(
          `[MatchScraper] Auto-resume: ${completed.length} completed, ${incomplete.length} incomplete. ` +
            `Will auto-resume full scrape in 30s...`
        );
        setTimeout(() => {
          if (!scrapeRunning) {
            console.log("[MatchScraper] Auto-resuming full scrape (Season 1 only)...");
            runFullMatchScrape().catch((err) =>
              console.error("[MatchScraper] Auto-resume scrape failed:", err)
            );
          }
        }, 30000);
      } else {
        // All done — just run incremental after 2 min
        setTimeout(() => {
          runIncrementalMatchScrape().catch((err) =>
            console.error("[MatchScraper] Initial incremental scrape failed:", err)
          );
        }, 2 * 60 * 1000);
      }
    } catch (err) {
      console.error("[MatchScraper] Auto-resume check failed:", err);
    }
  }, 10000);

  // Then run incremental every hour
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
