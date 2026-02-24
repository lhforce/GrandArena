/**
 * Ronin Marketplace GraphQL Client — Fetches floor prices, listings,
 * and exchange rates from the Ronin Marketplace API.
 *
 * Key features:
 * - Outlier detection: listings >3x median are flagged and excluded
 * - Exchange rate caching (RON/WETH → USD)
 * - Batch floor price fetching for all champions × rarities
 * - Returns "X buyable / Y total" listing counts
 *
 * Ported from grand-arena-tracker bot's collector.ts
 */

const GRAPHQL_URL = "https://marketplace-graphql.skymavis.com/graphql";
const GA_CARDS_CONTRACT = "0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b";

// Payment token addresses on Ronin
const PAYMENT_TOKENS = {
  RON: "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4",
  WETH: "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5",
} as const;

// ─── Types ──────────────────────────────────────────────────────────

export interface ExchangeRates {
  ronUsd: number;
  wethUsd: number;
  fetchedAt: number;
}

export interface ListingInfo {
  tokenId: string;
  priceRon: number;
  priceUsd: number;
  paymentToken: string;
  isOutlier: boolean;
}

export interface MarketplacePriceData {
  championName: string;
  rarity: string;
  floorPriceRon: number | null;
  floorPriceUsd: number | null;
  medianPriceRon: number | null;
  buyoutCostRon: number | null;
  buyoutCostUsd: number | null;
  buyableListings: number;
  totalListings: number;
  outlierCount: number;
  listings: ListingInfo[];
}

// ─── GraphQL Client ─────────────────────────────────────────────────

async function gqlFetch(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  const resp = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);
  const data = (await resp.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (data.errors) throw new Error(data.errors[0]?.message ?? "GraphQL error");
  return data.data;
}

// ─── Exchange Rates ─────────────────────────────────────────────────

let cachedRates: ExchangeRates | null = null;
const RATE_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch RON and WETH → USD exchange rates.
 *
 * NOTE: The Ronin Marketplace GraphQL `exchangeRate.ron.usd` field returns the price
 * of the Ronin ERC-20 token on Ethereum mainnet (~$0.91), NOT the Ronin sidechain
 * native RON token (~$0.096). We use CoinGecko as the primary source for accuracy.
 * The Ronin GraphQL API is only used for WETH price.
 */
export async function getExchangeRates(): Promise<ExchangeRates> {
  if (cachedRates && Date.now() - cachedRates.fetchedAt < RATE_CACHE_MS) {
    return cachedRates;
  }

  let ronUsd = 0;
  let wethUsd = 0;

  // Primary: CoinGecko for RON (axie-infinity-ronin-sidechain native token)
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ronin,ethereum&vs_currencies=usd",
      { headers: { Accept: "application/json" } }
    );
    const data = (await resp.json()) as { ronin?: { usd: number }; ethereum?: { usd: number } };
    ronUsd = data?.ronin?.usd || 0;
    wethUsd = data?.ethereum?.usd || 0;
    if (ronUsd > 0 && wethUsd > 0) {
      cachedRates = { ronUsd, wethUsd, fetchedAt: Date.now() };
      console.log(`[Marketplace] CoinGecko rates: RON=$${ronUsd.toFixed(6)}, WETH=$${wethUsd.toFixed(2)}`);
      return cachedRates;
    }
  } catch (err) {
    console.warn("[Marketplace] CoinGecko failed:", (err as Error).message);
  }

  // Fallback: Ronin Marketplace GraphQL for WETH only (RON value from this API is wrong)
  try {
    const data = (await gqlFetch(`
      query GetExchangeRate {
        exchangeRate {
          eth { usd }
        }
      }
    `)) as { exchangeRate: { eth: { usd: string } } };

    if (data?.exchangeRate) {
      const gqlWethUsd = parseFloat(data.exchangeRate.eth?.usd || "0");
      if (gqlWethUsd > 0) {
        wethUsd = gqlWethUsd;
      }
    }
  } catch (err) {
    console.warn("[Marketplace] Ronin GraphQL WETH rate failed:", (err as Error).message);
  }

  // If we got at least WETH, use known-good RON fallback
  if (wethUsd > 0) {
    cachedRates = { ronUsd: ronUsd || 0.096603, wethUsd, fetchedAt: Date.now() };
    console.log(`[Marketplace] Partial rates: RON=$${cachedRates.ronUsd.toFixed(6)}, WETH=$${wethUsd.toFixed(2)}`);
    return cachedRates;
  }

  // Last resort: hardcoded fallback (user-confirmed correct rate)
  cachedRates = { ronUsd: 0.096603, wethUsd: 2187, fetchedAt: Date.now() };
  console.warn(`[Marketplace] Using hardcoded fallback rates: RON=$0.096603, WETH=$2187`);
  return cachedRates;
}

/**
 * Convert wei price to RON amount.
 */
function weiToRon(priceWei: string): number {
  return Number(BigInt(priceWei)) / 1e18;
}

/**
 * Convert wei price to USD using payment token.
 */
function weiToUsd(priceWei: string, paymentToken: string, rates: ExchangeRates): number {
  const amount = weiToRon(priceWei);
  if (paymentToken.toLowerCase() === PAYMENT_TOKENS.WETH.toLowerCase()) {
    return amount * rates.wethUsd;
  }
  return amount * rates.ronUsd;
}

// ─── Outlier Detection ──────────────────────────────────────────────

/**
 * Calculate median of a sorted array of numbers.
 */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Flag outlier listings (>3x median price).
 * Returns listings with isOutlier flag set.
 */
export function detectOutliers(listings: ListingInfo[]): ListingInfo[] {
  if (listings.length <= 1) return listings;

  const sortedPrices = listings.map((l) => l.priceRon).sort((a, b) => a - b);
  const med = median(sortedPrices);
  const outlierThreshold = med * 3;

  return listings.map((l) => ({
    ...l,
    isOutlier: l.priceRon > outlierThreshold,
  }));
}

// ─── Listing Fetcher ────────────────────────────────────────────────

/**
 * Fetch all active listings for a champion at a specific rarity.
 * Returns up to `maxListings` sorted by price ascending.
 */
export async function fetchListings(
  championName: string,
  rarity: string,
  maxListings: number = 20
): Promise<ListingInfo[]> {
  const rates = await getExchangeRates();

  // GraphQL API requires name search to be at least 3 characters.
  // For very short names, skip the name filter and filter results client-side.
  const safeName = championName.replace(/"/g, '\\"');
  const useNameFilter = safeName.length >= 3;

  const query = `{
    erc721Tokens(
      tokenAddress: "${GA_CARDS_CONTRACT}",
      from: 0,
      size: ${maxListings},
      sort: PriceAsc,
      auctionType: Sale,
      criteria: [
        {name: "Card Type", values: ["MOKI"]},
        {name: "Rarity", values: ["${rarity}"]}
      ]${useNameFilter ? `,
      name: "${safeName}"` : ''}
    ) {
      total
      results {
        tokenId
        name
        order {
          currentPrice
          paymentToken
        }
      }
    }
  }`;

  const data = (await gqlFetch(query)) as {
    erc721Tokens: {
      total: number;
      results: Array<{
        tokenId: string;
        name?: string;
        order: { currentPrice: string; paymentToken: string } | null;
      }>;
    };
  };

  const listings: ListingInfo[] = [];
  // For short names (< 3 chars), filter results client-side since we couldn't use name filter
  const nameFilteredResults = useNameFilter
    ? data.erc721Tokens.results
    : data.erc721Tokens.results.filter(
        (t) => t.name?.toLowerCase() === championName.toLowerCase()
      );
  for (const token of nameFilteredResults) {
    if (!token.order?.currentPrice) continue;
    const priceRon = weiToRon(token.order.currentPrice);
    const paymentAddr = (token.order.paymentToken || "").toLowerCase();
    const isWeth = paymentAddr === PAYMENT_TOKENS.WETH.toLowerCase();
    const priceUsd = isWeth
      ? priceRon * rates.wethUsd
      : priceRon * rates.ronUsd;

    listings.push({
      tokenId: token.tokenId,
      priceRon,
      priceUsd,
      paymentToken: isWeth ? "WETH" : "RON",
      isOutlier: false,
    });
  }

  // Apply outlier detection
  return detectOutliers(listings);
}

/**
 * Fetch comprehensive marketplace price data for a champion at a rarity.
 * Includes floor price, median, buyout cost, outlier detection.
 */
export async function fetchMarketplacePrice(
  championName: string,
  rarity: string
): Promise<MarketplacePriceData> {
  const listings = await fetchListings(championName, rarity, 20);
  const rates = await getExchangeRates();

  const buyable = listings.filter((l) => !l.isOutlier);
  const outliers = listings.filter((l) => l.isOutlier);

  const floorPriceRon = buyable.length > 0 ? buyable[0].priceRon : null;
  const floorPriceUsd = buyable.length > 0 ? buyable[0].priceUsd : null;

  const sortedBuyable = buyable.map((l) => l.priceRon).sort((a, b) => a - b);
  const medianPriceRon = sortedBuyable.length > 0 ? median(sortedBuyable) : null;

  const buyoutCostRon = buyable.reduce((sum, l) => sum + l.priceRon, 0) || null;
  const buyoutCostUsd = buyoutCostRon !== null ? buyoutCostRon * rates.ronUsd : null;

  return {
    championName,
    rarity,
    floorPriceRon,
    floorPriceUsd,
    medianPriceRon,
    buyoutCostRon,
    buyoutCostUsd,
    buyableListings: buyable.length,
    totalListings: listings.length,
    outlierCount: outliers.length,
    listings,
  };
}

/**
 * Fetch floor prices for a champion across all rarities.
 */
export async function fetchAllRarityPrices(
  championName: string
): Promise<Record<string, MarketplacePriceData>> {
  const rarities = ["Basic", "Rare", "Epic", "Legendary"];
  const results: Record<string, MarketplacePriceData> = {};

  // Fetch in parallel (4 concurrent requests per champion)
  const promises = rarities.map(async (rarity) => {
    try {
      results[rarity] = await fetchMarketplacePrice(championName, rarity);
    } catch (err) {
      console.warn(`[Marketplace] Failed to fetch ${championName} ${rarity}:`, (err as Error).message);
      results[rarity] = {
        championName,
        rarity,
        floorPriceRon: null,
        floorPriceUsd: null,
        medianPriceRon: null,
        buyoutCostRon: null,
        buyoutCostUsd: null,
        buyableListings: 0,
        totalListings: 0,
        outlierCount: 0,
        listings: [],
      };
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Batch fetch floor prices for multiple champions.
 * Rate-limited to avoid overwhelming the API.
 */
export async function batchFetchPrices(
  championNames: string[],
  rarities: string[] = ["Basic", "Rare", "Epic", "Legendary"],
  concurrency: number = 3,
  delayMs: number = 200
): Promise<Map<string, Record<string, MarketplacePriceData>>> {
  const results = new Map<string, Record<string, MarketplacePriceData>>();

  // Process in batches of `concurrency`
  for (let i = 0; i < championNames.length; i += concurrency) {
    const batch = championNames.slice(i, i + concurrency);
    const promises = batch.map(async (name) => {
      const pricesByRarity: Record<string, MarketplacePriceData> = {};
      for (const rarity of rarities) {
        try {
          pricesByRarity[rarity] = await fetchMarketplacePrice(name, rarity);
        } catch {
          pricesByRarity[rarity] = {
            championName: name,
            rarity,
            floorPriceRon: null,
            floorPriceUsd: null,
            medianPriceRon: null,
            buyoutCostRon: null,
            buyoutCostUsd: null,
            buyableListings: 0,
            totalListings: 0,
            outlierCount: 0,
            listings: [],
          };
        }
        // Small delay between rarities
        await sleep(100);
      }
      results.set(name, pricesByRarity);
    });

    await Promise.all(promises);

    // Delay between batches
    if (i + concurrency < championNames.length) {
      await sleep(delayMs);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
