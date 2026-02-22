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

      // Rate limit: wait 500ms between API calls
      await new Promise(resolve => setTimeout(resolve, 500));
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
    // Process in batches
    let hasMore = true;
    while (hasMore) {
      const { processed, errors } = await processUnidentifiedEntries({ limit: 20, topN });
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

  return { processed: totalProcessed, errors: totalErrors };
}
