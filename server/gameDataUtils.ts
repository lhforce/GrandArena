/**
 * Game Data Utilities — Shared helpers for loading game data and user bench champions.
 * Shared utilities used across
 * multiple features (Opponent Crusher, Contest Prep, Champion Deep Dive, etc.).
 */

import { getDb } from "./db";
import { userCards } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Load game data from game-data.json and return a lookup map by tokenId/championTokenId.
 */
export async function loadGameDataLookup(): Promise<
  Map<number, { name: string; championClass: string; championTokenId?: number; imageUrl?: string | null }>
> {
  const fs = await import("fs");
  const path = await import("path");
  const gameDataPath = path.resolve(
    import.meta.dirname ?? process.cwd(),
    "../client/public/game-data.json"
  );
  const lookup = new Map<
    number,
    { name: string; championClass: string; championTokenId?: number; imageUrl?: string | null }
  >();
  try {
    const raw = fs.readFileSync(gameDataPath, "utf-8");
    const gameData = JSON.parse(raw);
    for (const champ of gameData.champions ?? []) {
      const tokenId = Number(champ.tokenId);
      const champTokenId = Number(
        champ.championTokenId ??
          champ.attributes?.["Champion Token ID"]?.[0]
      );
      if (!isNaN(tokenId)) {
        const entry = {
          name: champ.name ?? `#${tokenId}`,
          championClass: champ.class ?? "Unknown",
          championTokenId: !isNaN(champTokenId) ? champTokenId : undefined,
          imageUrl: champ.imageUrl ?? null,
        };
        lookup.set(tokenId, entry);
        if (!isNaN(champTokenId)) {
          lookup.set(champTokenId, entry);
        }
      }
    }
  } catch (err) {
    console.error("[GameDataUtils] Failed to load game data:", err);
  }
  return lookup;
}

/**
 * Get all available bench champions for a user (MOKIs they own but aren't in the current lineup).
 */
export async function getUserBenchChampions(
  userId: number,
  currentLineupTokenIds: number[]
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const cards = await db
    .select({ championTokenId: userCards.championTokenId })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardType, "MOKI")));
  const currentSet = new Set(currentLineupTokenIds.map(String));
  return cards
    .map((c) => Number(c.championTokenId))
    .filter((id) => !isNaN(id) && !currentSet.has(String(id)));
}
