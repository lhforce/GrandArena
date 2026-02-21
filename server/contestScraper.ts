/**
 * Contest Scraper — Fetches contests and leaderboards from the Grand Arena Fantasy API.
 * 
 * API endpoints:
 *   GET https://fantasy.grandarena.gg/api/contests?status=COMPLETED&limit=50&offset=0
 *   GET https://fantasy.grandarena.gg/api/contests?status=LIVE&limit=50
 *   GET https://fantasy.grandarena.gg/api/contests?status=OPEN&limit=50
 *   GET https://fantasy.grandarena.gg/api/contests/{contestId}/leaderboard?limit=100&offset=0
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { contests, leaderboardEntries, scrapeJobs } from "../drizzle/schema";
import type { InsertContest, InsertLeaderboardEntry, InsertScrapeJob } from "../drizzle/schema";

const GA_API_BASE = "https://fantasy.grandarena.gg/api";
const LEADERBOARD_PAGE_SIZE = 100; // API hard cap
const CONTESTS_PAGE_SIZE = 50;

// ─── Types from GA API ──────────────────────────────────────────────
interface GAContest {
  _id: string;
  name: string;
  description?: string;
  contestStatus: string;
  format: string;
  entryFee?: number;
  prizePool?: number;
  entries?: number;
  maxEntries?: number;
  maxEntriesPerUser?: number;
  scoringMethod?: string;
  lineupConfig?: {
    slots?: Array<{ minRarity?: string; maxRarity?: string }>;
    schemeSlots?: Array<{ required?: boolean }>;
    allowDuplicateChampions?: boolean;
    cardUsageLimitPerContest?: number;
  };
  matchGroups?: string[];
  startDate?: string;
  endDate?: string;
  payoutsProcessed?: boolean;
  completed?: boolean;
}

interface GALeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  entryId: string;
  entryNumber: number;
  score: number;
  matchesCompleted: number;
  totalMatches: number;
  estimatedPayout: number;
  isCurrentUser: boolean;
  isTied: boolean;
  cardImages: string[];
}

interface GAContestsResponse {
  contests: GAContest[];
  total: number;
  limit: number;
  offset: number;
}

interface GALeaderboardResponse {
  entries: GALeaderboardEntry[];
  total: number;
  limit: number;
  offset: number;
  payoutThresholdRank: number;
  prizePool: number;
  lastUpdated: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
async function fetchJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "GrandArenaOptimizer/1.0" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json() as Promise<T>;
}

/**
 * Determine the rarity restriction from the lineup config and contest name.
 */
function classifyRarityRestriction(contest: GAContest): string {
  const name = contest.name.toLowerCase();
  const slots = contest.lineupConfig?.slots ?? [];

  // Check name patterns first
  if (name.includes("one-of-each")) return "ONE_OF_EACH";
  if (name.includes("legendary only")) return "LEGENDARY_ONLY";
  if (name.includes("epic only")) return "EPIC_ONLY";
  if (name.includes("rare only")) return "RARE_ONLY";
  if (name.includes("basic only") || name.includes("commons only")) return "COMMON_ONLY";
  if (name.includes("basic or rare")) return "BASIC_OR_RARE";
  if (name.includes("no legendary")) return "NO_LEGENDARY";

  // Check slot config
  if (slots.length > 0) {
    const minRarities = slots.map(s => s.minRarity?.toUpperCase());
    const maxRarities = slots.map(s => s.maxRarity?.toUpperCase());
    
    if (minRarities.every(r => r === "LEGENDARY") && maxRarities.every(r => r === "LEGENDARY")) return "LEGENDARY_ONLY";
    if (minRarities.every(r => r === "EPIC") && maxRarities.every(r => r === "EPIC")) return "EPIC_ONLY";
    if (minRarities.every(r => r === "RARE") && maxRarities.every(r => r === "RARE")) return "RARE_ONLY";
    if (minRarities.every(r => r === "COMMON") && maxRarities.every(r => r === "COMMON")) return "COMMON_ONLY";
  }

  return "OPEN";
}

// ─── Contest Scraper ────────────────────────────────────────────────
/**
 * Fetch all contests of a given status from the GA API.
 */
export async function fetchContests(status: string): Promise<GAContest[]> {
  const all: GAContest[] = [];
  let offset = 0;

  while (true) {
    const url = `${GA_API_BASE}/contests?status=${status}&limit=${CONTESTS_PAGE_SIZE}&offset=${offset}`;
    const data = await fetchJSON<GAContestsResponse>(url);
    
    // Filter to only the requested status (ENDED returns mixed statuses)
    const filtered = status === "COMPLETED" 
      ? data.contests.filter(c => c.contestStatus === "COMPLETED")
      : data.contests;
    
    all.push(...filtered);
    
    if (data.contests.length < CONTESTS_PAGE_SIZE || offset + CONTESTS_PAGE_SIZE >= data.total) break;
    offset += CONTESTS_PAGE_SIZE;
  }

  return all;
}

/**
 * Fetch the full leaderboard for a contest, paginating through all entries.
 */
export async function fetchLeaderboard(contestId: string): Promise<GALeaderboardEntry[]> {
  const all: GALeaderboardEntry[] = [];
  let offset = 0;

  while (true) {
    const url = `${GA_API_BASE}/contests/${contestId}/leaderboard?limit=${LEADERBOARD_PAGE_SIZE}&offset=${offset}`;
    const data = await fetchJSON<GALeaderboardResponse>(url);
    
    all.push(...data.entries);
    
    if (data.entries.length < LEADERBOARD_PAGE_SIZE || all.length >= data.total) break;
    offset += LEADERBOARD_PAGE_SIZE;
  }

  return all;
}

/**
 * Upsert a contest into the database.
 */
export async function upsertContest(gaContest: GAContest): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rarityRestriction = classifyRarityRestriction(gaContest);
  const isStarCap = gaContest.name.toLowerCase().includes("star cap");
  const isOneOfEach = gaContest.name.toLowerCase().includes("one-of-each");

  const values: InsertContest = {
    gaContestId: gaContest._id,
    name: gaContest.name,
    description: gaContest.description ?? null,
    contestStatus: gaContest.contestStatus,
    format: gaContest.format,
    entryFee: gaContest.entryFee ?? 0,
    prizePool: String(gaContest.prizePool ?? 0),
    entries: gaContest.entries ?? 0,
    maxEntries: gaContest.maxEntries ?? 0,
    maxEntriesPerUser: gaContest.maxEntriesPerUser ?? 1,
    scoringMethod: gaContest.scoringMethod ?? "V4",
    rarityRestriction,
    isStarCap,
    isOneOfEach,
    lineupConfig: gaContest.lineupConfig ?? null,
    matchGroups: gaContest.matchGroups ?? null,
    startDate: gaContest.startDate ? new Date(gaContest.startDate) : null,
    endDate: gaContest.endDate ? new Date(gaContest.endDate) : null,
    payoutsProcessed: gaContest.payoutsProcessed ?? false,
    lastScrapedAt: new Date(),
  };

  await db.insert(contests).values(values).onDuplicateKeyUpdate({
    set: {
      contestStatus: values.contestStatus,
      entries: values.entries,
      prizePool: values.prizePool,
      payoutsProcessed: values.payoutsProcessed,
      lastScrapedAt: new Date(),
    },
  });

  // Get the contest ID
  const result = await db.select({ id: contests.id })
    .from(contests)
    .where(eq(contests.gaContestId, gaContest._id))
    .limit(1);

  return result[0]?.id ?? 0;
}

/**
 * Upsert leaderboard entries for a contest.
 */
export async function upsertLeaderboardEntries(
  contestDbId: number,
  entries: GALeaderboardEntry[]
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let count = 0;
  // Process in batches of 50
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const entry of batch) {
      const values: InsertLeaderboardEntry = {
        contestId: contestDbId,
        gaEntryId: entry.entryId,
        gaUserId: entry.userId,
        username: entry.username,
        rank: entry.rank,
        score: entry.score,
        matchesCompleted: entry.matchesCompleted,
        totalMatches: entry.totalMatches,
        estimatedPayout: String(entry.estimatedPayout ?? 0),
        isTied: entry.isTied,
        cardImages: entry.cardImages,
      };

      await db.insert(leaderboardEntries).values(values).onDuplicateKeyUpdate({
        set: {
          rank: values.rank,
          score: values.score,
          estimatedPayout: values.estimatedPayout,
        },
      });
      count++;
    }
  }

  return count;
}

// ─── Full Scrape Pipeline ───────────────────────────────────────────
/**
 * Run a full scrape of all completed contests and their leaderboards.
 */
export async function runContestScrape(): Promise<{
  contestsProcessed: number;
  entriesProcessed: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Create a scrape job record
  const [jobResult] = await db.insert(scrapeJobs).values({
    jobType: "contests",
    status: "running",
    startedAt: new Date(),
  }).$returningId();
  const jobId = jobResult.id;

  let contestsProcessed = 0;
  let entriesProcessed = 0;
  const errors: string[] = [];

  try {
    // Fetch all contest statuses
    for (const status of ["COMPLETED", "LIVE", "OPEN"]) {
      console.log(`[Scraper] Fetching ${status} contests...`);
      const gaContests = await fetchContests(status);
      console.log(`[Scraper] Found ${gaContests.length} ${status} contests`);

      for (const gaContest of gaContests) {
        try {
          const dbContestId = await upsertContest(gaContest);
          contestsProcessed++;

          // Only fetch leaderboards for completed contests (they have final results)
          if (gaContest.contestStatus === "COMPLETED" && gaContest.completed) {
            console.log(`[Scraper] Fetching leaderboard for: ${gaContest.name}`);
            const leaderboard = await fetchLeaderboard(gaContest._id);
            const count = await upsertLeaderboardEntries(dbContestId, leaderboard);
            entriesProcessed += count;
            console.log(`[Scraper] Stored ${count} entries for ${gaContest.name}`);
          }
        } catch (err) {
          const msg = `Error processing contest ${gaContest.name}: ${err}`;
          console.error(`[Scraper] ${msg}`);
          errors.push(msg);
        }
      }
    }

    // Also fetch DRAFT contests (upcoming)
    try {
      console.log("[Scraper] Fetching DRAFT contests...");
      const allContests = await fetchJSON<GAContestsResponse>(
        `${GA_API_BASE}/contests?status=ENDED&limit=100`
      );
      const drafts = allContests.contests.filter(c => c.contestStatus === "DRAFT");
      console.log(`[Scraper] Found ${drafts.length} DRAFT contests`);
      for (const draft of drafts) {
        await upsertContest(draft);
        contestsProcessed++;
      }
    } catch (err) {
      errors.push(`Error fetching DRAFT contests: ${err}`);
    }

    // Update job status
    await db.update(scrapeJobs)
      .set({
        status: "completed",
        contestsProcessed,
        entriesProcessed,
        completedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, jobId));

  } catch (err) {
    await db.update(scrapeJobs)
      .set({
        status: "failed",
        errorMessage: String(err),
        completedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, jobId));
    throw err;
  }

  return { contestsProcessed, entriesProcessed, errors };
}

/**
 * Fetch only LIVE, OPEN, and DRAFT contests (for real-time display).
 */
export async function refreshActiveContests(): Promise<number> {
  let count = 0;
  
  for (const status of ["LIVE", "OPEN"]) {
    const gaContests = await fetchContests(status);
    for (const c of gaContests) {
      await upsertContest(c);
      count++;
    }
  }

  // Fetch DRAFT contests
  try {
    const allContests = await fetchJSON<GAContestsResponse>(
      `${GA_API_BASE}/contests?status=ENDED&limit=100`
    );
    const drafts = allContests.contests.filter(c => c.contestStatus === "DRAFT");
    for (const draft of drafts) {
      await upsertContest(draft);
      count++;
    }
  } catch (err) {
    console.error("[Scraper] Error fetching DRAFT contests:", err);
  }

  return count;
}
