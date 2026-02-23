/**
 * Card Identifier — Uses AI vision to identify champions and scheme cards
 * from the thumbnail images returned by the GA leaderboard API.
 * 
 * Each leaderboard entry has 5 cardImages:
 *   - 4 champion card thumbnails
 *   - 1 scheme card thumbnail (or empty if no scheme)
 * 
 * We use the built-in LLM with vision capabilities to match thumbnails
 * against our known champion database (180 champions + 35 schemes).
 */

import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { leaderboardEntries, scrapeJobs } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import type { Message, ImageContent, TextContent } from "./_core/llm";

// ─── Concurrency Guard ─────────────────────────────────────────────
let identificationRunning = false;

export function isIdentificationRunning(): boolean {
  return identificationRunning;
}

/**
 * Clean up stale "running" AI identification jobs on server startup.
 * If the server restarts while a job is running, the in-memory flag resets
 * but the DB record stays "running" forever. This marks them as failed.
 */
export async function cleanupStaleIdentificationJobs(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.update(scrapeJobs)
    .set({
      status: "failed",
      errorMessage: "Stale job: server restarted while running",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(scrapeJobs.status, "running"),
        eq(scrapeJobs.jobType, "ai_identification")
      )
    );
  
  const cleaned = (result as any)[0]?.affectedRows ?? 0;
  if (cleaned > 0) {
    console.log(`[CardIdentifier] Cleaned up ${cleaned} stale AI identification job(s) from previous server session`);
  }
  return cleaned;
}

// ─── Types ──────────────────────────────────────────────────────────
interface IdentifiedCard {
  name: string;
  championTokenId?: string;
  rarity?: string;
  confidence: number;
}

interface IdentificationResult {
  champions: IdentifiedCard[];
  scheme: string | null;
  overallConfidence: number;
}

// ─── Champion/Scheme Reference Data ─────────────────────────────────
let championReference: string = "";
let schemeReference: string = "";

/**
 * Build reference text from game-data.json for the AI to match against.
 */
async function loadReferenceData(): Promise<void> {
  if (championReference) return; // Already loaded

  try {
    // Read game-data.json from the public folder
    const fs = await import("fs/promises");
    const path = await import("path");
    const dataPath = path.resolve(process.cwd(), "client/public/game-data.json");
    const raw = await fs.readFile(dataPath, "utf-8");
    const data = JSON.parse(raw);

    // Build champion reference
    const champLines: string[] = [];
    for (const c of data.champions) {
      const rarity = c.attributes?.Rarity?.[0] ?? "Unknown";
      const fur = c.mokiAttributes?.Fur?.[0] ?? "Unknown";
      const is1of1 = c.mokiAttributes?.["1 of 1"] ? "1-of-1" : "";
      champLines.push(`${c.name} (ID:${c.championTokenId}, ${rarity}, Fur:${fur} ${is1of1})`);
    }
    championReference = champLines.join("\n");

    // Build scheme reference
    const schemeLines: string[] = [];
    for (const s of data.schemes) {
      schemeLines.push(`${s.name} (TokenID:${s.tokenId})`);
    }
    schemeReference = schemeLines.join("\n");

    console.log(`[CardIdentifier] Loaded ${data.champions.length} champions and ${data.schemes.length} schemes as reference`);
  } catch (err) {
    console.error("[CardIdentifier] Failed to load reference data:", err);
  }
}

// ─── AI Identification ──────────────────────────────────────────────
/**
 * Use AI vision to identify champions and scheme from card thumbnail URLs.
 */
export async function identifyCardsFromImages(
  cardImages: string[]
): Promise<IdentificationResult> {
  await loadReferenceData();

  if (!cardImages || cardImages.length === 0) {
    return { champions: [], scheme: null, overallConfidence: 0 };
  }

  // Build the message with all card images
  const imageContents: (ImageContent | TextContent)[] = [
    {
      type: "text" as const,
      text: `You are an expert at identifying Grand Arena Moki champion cards and scheme cards from their thumbnail images.

I will show you ${cardImages.length} card thumbnail images from a Grand Arena Fantasy contest lineup. The first 4 are champion cards and the 5th (if present) is a scheme card.

CHAMPION CARDS DATABASE (match against these):
${championReference}

SCHEME CARDS DATABASE (match against these):
${schemeReference}

For each image, identify which champion or scheme card it is. Look at the artwork, colors, character features, and any visible text. Champion cards show a Moki character, while scheme cards show an ability/effect illustration.

Respond in this exact JSON format:
{
  "champions": [
    {"name": "ChampionName", "championTokenId": "1234", "rarity": "Basic|Rare|Epic|Legendary", "confidence": 0.85},
    {"name": "ChampionName", "championTokenId": "5678", "rarity": "Basic|Rare|Epic|Legendary", "confidence": 0.85},
    {"name": "ChampionName", "championTokenId": "9012", "rarity": "Basic|Rare|Epic|Legendary", "confidence": 0.85},
    {"name": "ChampionName", "championTokenId": "3456", "rarity": "Basic|Rare|Epic|Legendary", "confidence": 0.85}
  ],
  "scheme": "SchemeName or null",
  "overallConfidence": 0.85
}

Important:
- Match each image to the CLOSEST champion/scheme from the database
- The rarity can be determined by the card border color: grey=Basic, blue=Rare, purple=Epic, gold/orange=Legendary, pink=FA/Series
- If you cannot identify a card, use "Unknown" as the name with low confidence
- Confidence should be 0.0-1.0 based on how sure you are of the match`
    },
  ];

  // Add each card image
  for (const url of cardImages) {
    imageContents.push({
      type: "image_url" as const,
      image_url: { url, detail: "low" },
    });
  }

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "user",
          content: imageContents,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "card_identification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              champions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    championTokenId: { type: "string" },
                    rarity: { type: "string" },
                    confidence: { type: "number" },
                  },
                  required: ["name", "championTokenId", "rarity", "confidence"],
                  additionalProperties: false,
                },
              },
              scheme: { type: ["string", "null"] },
              overallConfidence: { type: "number" },
            },
            required: ["champions", "scheme", "overallConfidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = result.choices[0]?.message?.content;
    if (typeof content === "string") {
      return JSON.parse(content) as IdentificationResult;
    }
    
    return { champions: [], scheme: null, overallConfidence: 0 };
  } catch (err) {
    console.error("[CardIdentifier] AI identification failed:", err);
    return { champions: [], scheme: null, overallConfidence: 0 };
  }
}

// ─── Batch Processing ───────────────────────────────────────────────
/**
 * Process unidentified leaderboard entries (top N per contest).
 * Only processes entries that haven't been AI-processed yet.
 */
export async function processUnidentifiedEntries(
  options: { limit?: number; topN?: number } = {}
): Promise<{ processed: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { limit = 50, topN = 10 } = options;

  // Get unprocessed entries (top entries from completed contests)
  const unprocessed = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        isNull(leaderboardEntries.aiProcessedAt),
        sql`${leaderboardEntries.rank} <= ${topN}`
      )
    )
    .limit(limit);

  console.log(`[CardIdentifier] Found ${unprocessed.length} unprocessed entries to identify`);

  let processed = 0;
  let errors = 0;

  for (const entry of unprocessed) {
    try {
      const images = (entry.cardImages as string[]) ?? [];
      if (images.length === 0) {
        // Mark as processed with no results
        await db.update(leaderboardEntries)
          .set({ aiProcessedAt: new Date(), aiConfidence: "0" })
          .where(eq(leaderboardEntries.id, entry.id));
        processed++;
        continue;
      }

      console.log(`[CardIdentifier] Processing entry rank #${entry.rank} (ID: ${entry.gaEntryId})`);
      const result = await identifyCardsFromImages(images);

      await db.update(leaderboardEntries)
        .set({
          identifiedChampions: result.champions,
          identifiedScheme: result.scheme,
          aiConfidence: String(result.overallConfidence),
          aiProcessedAt: new Date(),
        })
        .where(eq(leaderboardEntries.id, entry.id));

      processed++;
      console.log(`[CardIdentifier] Identified: ${result.champions.map(c => c.name).join(", ")} | Scheme: ${result.scheme} | Confidence: ${result.overallConfidence}`);

      // Rate limit: wait 200ms between API calls to avoid overwhelming the LLM
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      console.error(`[CardIdentifier] Error processing entry ${entry.id}:`, err);
      errors++;
    }
  }

  return { processed, errors };
}

/**
 * Run the full AI identification pipeline for all unprocessed entries.
 */
export async function runIdentificationPipeline(topN: number = 10): Promise<{
  processed: number;
  errors: number;
}> {
  if (identificationRunning) {
    console.log("[CardIdentifier] AI identification already running, skipping duplicate request");
    return { processed: 0, errors: 0 };
  }
  identificationRunning = true;

  const db = await getDb();
  if (!db) {
    identificationRunning = false;
    throw new Error("Database not available");
  }

  // Create a scrape job record
  const [jobResult] = await db.insert(scrapeJobs).values({
    jobType: "ai_identification",
    status: "running",
    startedAt: new Date(),
  }).$returningId();
  const jobId = jobResult.id;

  let totalProcessed = 0;
  let totalErrors = 0;

  try {
    // Process in batches of 50 entries at a time
    let hasMore = true;
    while (hasMore) {
      const { processed, errors } = await processUnidentifiedEntries({ limit: 50, topN });
      totalProcessed += processed;
      totalErrors += errors;
      
      if (processed === 0) hasMore = false;

      // Update job progress
      await db.update(scrapeJobs)
        .set({ aiProcessed: totalProcessed })
        .where(eq(scrapeJobs.id, jobId));
    }

    await db.update(scrapeJobs)
      .set({
        status: "completed",
        aiProcessed: totalProcessed,
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
  }

  identificationRunning = false;
  return { processed: totalProcessed, errors: totalErrors };
}

/**
 * Auto-resume identification on server startup.
 * Checks if there are any unprocessed entries and starts the pipeline silently.
 * This ensures identification continues after server restarts.
 */
export async function autoResumeIdentification(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    // Check if there are unprocessed entries (top 10 per contest)
    const unprocessed = await db
      .select({ id: leaderboardEntries.id })
      .from(leaderboardEntries)
      .where(
        and(
          isNull(leaderboardEntries.aiProcessedAt),
          sql`${leaderboardEntries.rank} <= 10`
        )
      )
      .limit(1);

    if (unprocessed.length === 0) {
      console.log("[CardIdentifier] Auto-resume: all entries already identified, nothing to do.");
      return;
    }

    console.log("[CardIdentifier] Auto-resume: unprocessed entries found, starting identification pipeline...");
    // Fire and forget — runs in background
    runIdentificationPipeline(10).then(result => {
      console.log(`[CardIdentifier] Auto-resume complete: ${result.processed} processed, ${result.errors} errors`);
    }).catch(err => {
      console.error("[CardIdentifier] Auto-resume failed:", err);
    });
  } catch (err) {
    console.error("[CardIdentifier] Auto-resume check failed:", err);
  }
}
