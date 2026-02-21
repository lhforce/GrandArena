/**
 * Wallet Sync — Fetches all Grand Arena cards (MOKIs + SCHEMEs) from Ronin Marketplace
 * and syncs them to the user_cards table.
 * 
 * Uses the Ronin Marketplace GraphQL API to get owned NFTs.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { userCards, users } from "../drizzle/schema";
import type { InsertUserCard } from "../drizzle/schema";

const GRAPHQL_URL = "https://marketplace-graphql.skymavis.com/graphql";
const GA_CARDS_CONTRACT = "0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b";

interface RoninNFT {
  tokenId: string;
  name: string;
  attributes: Record<string, string[]>;
}

interface GraphQLResponse {
  data?: {
    erc721Tokens: {
      total: number;
      results: RoninNFT[];
    };
  };
  errors?: Array<{ message: string }>;
}

async function gqlFetch(query: string): Promise<any> {
  const resp = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as GraphQLResponse;
  if (data.errors) throw new Error(data.errors[0]?.message ?? "GraphQL error");
  return data.data;
}

/**
 * Fetch all cards of a given type (MOKI or SCHEME) owned by a wallet.
 */
async function fetchCardsByType(
  walletAddress: string,
  cardType: "MOKI" | "SCHEME"
): Promise<Array<{ tokenId: string; name: string; rarity: string; championTokenId: string | null }>> {
  const results: Array<{ tokenId: string; name: string; rarity: string; championTokenId: string | null }> = [];
  let from = 0;
  const size = 50;

  while (true) {
    const query = `{
      erc721Tokens(
        tokenAddress: "${GA_CARDS_CONTRACT}",
        owner: "${walletAddress.toLowerCase()}",
        from: ${from},
        size: ${size},
        criteria: [{name: "Card Type", values: ["${cardType}"]}]
      ) {
        total
        results {
          tokenId
          name
          attributes
        }
      }
    }`;

    const data = await gqlFetch(query);
    const tokens = data.erc721Tokens.results;
    const total = data.erc721Tokens.total;

    for (const token of tokens) {
      const rarity = token.attributes?.["Rarity"]?.[0] ?? "Unknown";
      const championTokenId = token.attributes?.["Champion Token ID"]?.[0] ?? null;
      results.push({
        tokenId: String(token.tokenId),
        name: token.name ?? "Unknown",
        rarity,
        championTokenId,
      });
    }

    from += size;
    if (from >= total || tokens.length === 0) break;
  }

  return results;
}

/**
 * Count duplicates — group by championTokenId to find how many copies the user has.
 */
function countDuplicates(
  cards: Array<{ tokenId: string; name: string; rarity: string; championTokenId: string | null }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = card.championTokenId ?? card.tokenId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface WalletSyncResult {
  mokiCount: number;
  schemeCount: number;
  totalCards: number;
  duplicateMokis: number; // Number of champions with 2+ copies
}

/**
 * Sync a user's wallet inventory to the database.
 */
export async function syncWalletInventory(
  userId: number,
  walletAddress: string
): Promise<WalletSyncResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  console.log(`[WalletSync] Syncing wallet ${walletAddress} for user ${userId}...`);

  // Fetch MOKIs and SCHEMEs in parallel
  const [mokis, schemes] = await Promise.all([
    fetchCardsByType(walletAddress, "MOKI"),
    fetchCardsByType(walletAddress, "SCHEME"),
  ]);

  console.log(`[WalletSync] Found ${mokis.length} MOKIs and ${schemes.length} SCHEMEs`);

  // Count duplicates for MOKIs
  const mokiDuplicates = countDuplicates(mokis);
  const duplicateCount = Array.from(mokiDuplicates.values()).filter((c) => c > 1).length;

  // Clear old inventory for this user
  await db.delete(userCards).where(eq(userCards.userId, userId));

  // Insert MOKIs
  for (const moki of mokis) {
    const values: InsertUserCard = {
      userId,
      walletAddress: walletAddress.toLowerCase(),
      cardType: "MOKI",
      tokenId: moki.tokenId,
      championTokenId: moki.championTokenId,
      name: moki.name,
      rarity: moki.rarity,
      quantity: 1, // Each NFT is unique, quantity tracked by championTokenId duplicates
      lastSyncedAt: new Date(),
    };
    await db.insert(userCards).values(values).onDuplicateKeyUpdate({
      set: { lastSyncedAt: new Date(), rarity: moki.rarity, name: moki.name },
    });
  }

  // Insert SCHEMEs
  for (const scheme of schemes) {
    const values: InsertUserCard = {
      userId,
      walletAddress: walletAddress.toLowerCase(),
      cardType: "SCHEME",
      tokenId: scheme.tokenId,
      championTokenId: null,
      name: scheme.name,
      rarity: scheme.rarity,
      quantity: 1,
      lastSyncedAt: new Date(),
    };
    await db.insert(userCards).values(values).onDuplicateKeyUpdate({
      set: { lastSyncedAt: new Date(), rarity: scheme.rarity, name: scheme.name },
    });
  }

  // Update user's wallet address
  await db
    .update(users)
    .set({ walletAddress: walletAddress.toLowerCase() })
    .where(eq(users.id, userId));

  console.log(`[WalletSync] Sync complete: ${mokis.length} MOKIs, ${schemes.length} SCHEMEs, ${duplicateCount} duplicates`);

  return {
    mokiCount: mokis.length,
    schemeCount: schemes.length,
    totalCards: mokis.length + schemes.length,
    duplicateMokis: duplicateCount,
  };
}

/**
 * Get the user's card inventory from the database (fast, cached).
 */
export async function getUserInventory(userId: number) {
  const db = await getDb();
  if (!db) return { mokis: [], schemes: [] };

  const cards = await db
    .select()
    .from(userCards)
    .where(eq(userCards.userId, userId));

  const mokis = cards.filter((c) => c.cardType === "MOKI");
  const schemes = cards.filter((c) => c.cardType === "SCHEME");

  return { mokis, schemes };
}

/**
 * Get available (unlocked) cards for a user, excluding cards locked in active contests.
 */
export async function getAvailableCards(userId: number) {
  const db = await getDb();
  if (!db) return { mokis: [], schemes: [] };

  // Get all user cards
  const allCards = await db
    .select()
    .from(userCards)
    .where(eq(userCards.userId, userId));

  // Get locked card tokenIds (from active contests)
  const lockedResult = await db.execute(
    sql`SELECT cl.tokenId FROM card_lockups cl 
        INNER JOIN contests c ON cl.contestId = c.id 
        WHERE cl.userId = ${userId} 
        AND c.contestStatus IN ('LIVE', 'OPEN')
        AND cl.unlockedAt IS NULL`
  );
  const rows = (lockedResult as unknown as [Array<{ tokenId: string }>, unknown])[0];
  const lockedTokenIds = new Set(
    rows.map((r) => r.tokenId)
  );

  const mokis = allCards.filter(
    (c) => c.cardType === "MOKI" && !lockedTokenIds.has(c.tokenId)
  );
  const schemes = allCards.filter(
    (c) => c.cardType === "SCHEME" && !lockedTokenIds.has(c.tokenId)
  );

  return { mokis, schemes, lockedCount: lockedTokenIds.size };
}
