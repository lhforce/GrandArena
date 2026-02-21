/**
 * Ronin Marketplace API utilities
 * Uses the Mavis marketplace GraphQL API to fetch wallet holdings and floor prices
 */

const GRAPHQL_URL = 'https://marketplace-graphql.skymavis.com/graphql';
const GA_CARDS_CONTRACT = '0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b';

async function gqlFetch(query: string) {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

/**
 * Fetch all Grand Arena Cards (MOKI type) owned by a wallet address
 * Returns a set of champion token IDs owned by the wallet
 */
export async function fetchWalletChampions(walletAddress: string): Promise<Set<string>> {
  const owned = new Set<string>();
  let from = 0;
  const size = 50;

  while (true) {
    const query = `{
      erc721Tokens(
        tokenAddress: "${GA_CARDS_CONTRACT}",
        owner: "${walletAddress.toLowerCase()}",
        from: ${from},
        size: ${size},
        criteria: [{name: "Card Type", values: ["MOKI"]}]
      ) {
        total
        results {
          tokenId
          attributes
        }
      }
    }`;

    try {
      const data = await gqlFetch(query);
      const results = data.erc721Tokens.results;
      const total = data.erc721Tokens.total;

      for (const r of results) {
        const champId = r.attributes?.['Champion Token ID']?.[0];
        if (champId) owned.add(champId);
      }

      from += size;
      if (from >= total || results.length === 0) break;
    } catch (err) {
      console.error('Error fetching wallet champions:', err);
      break;
    }
  }

  return owned;
}

/**
 * Fetch floor prices for a champion by name across all rarities
 * Returns prices in RON
 */
export async function fetchChampionFloorPrices(
  championName: string
): Promise<Record<string, number | null>> {
  const rarities = ['Basic', 'Rare', 'Epic', 'Legendary'];
  const prices: Record<string, number | null> = {};

  await Promise.all(
    rarities.map(async (rarity) => {
      const query = `{
        erc721Tokens(
          tokenAddress: "${GA_CARDS_CONTRACT}",
          from: 0,
          size: 1,
          sort: {field: PRICE, order: ASC},
          auctionType: Sale,
          criteria: [
            {name: "Card Type", values: ["MOKI"]},
            {name: "Rarity", values: ["${rarity}"]}
          ],
          name: "${championName.replace(/"/g, '\\"')}"
        ) {
          results {
            order {
              currentPrice
              paymentToken {
                symbol
                decimals
              }
            }
          }
        }
      }`;

      try {
        const data = await gqlFetch(query);
        const results = data.erc721Tokens.results;
        if (results.length > 0 && results[0].order) {
          const order = results[0].order;
          const decimals = order.paymentToken?.decimals ?? 18;
          const rawPrice = BigInt(order.currentPrice);
          const price = Number(rawPrice) / Math.pow(10, decimals);
          prices[rarity] = Math.round(price * 100) / 100;
        } else {
          prices[rarity] = null;
        }
      } catch {
        prices[rarity] = null;
      }
    })
  );

  return prices;
}

/**
 * Fetch floor prices for a scheme card
 */
export async function fetchSchemeFloorPrice(schemeName: string): Promise<number | null> {
  const query = `{
    erc721Tokens(
      tokenAddress: "${GA_CARDS_CONTRACT}",
      from: 0,
      size: 1,
      sort: {field: PRICE, order: ASC},
      auctionType: Sale,
      criteria: [
        {name: "Card Type", values: ["SCHEME"]}
      ],
      name: "${schemeName.replace(/"/g, '\\"')}"
    ) {
      results {
        order {
          currentPrice
          paymentToken {
            symbol
            decimals
          }
        }
      }
    }
  }`;

  try {
    const data = await gqlFetch(query);
    const results = data.erc721Tokens.results;
    if (results.length > 0 && results[0].order) {
      const order = results[0].order;
      const decimals = order.paymentToken?.decimals ?? 18;
      const rawPrice = BigInt(order.currentPrice);
      return Math.round(Number(rawPrice) / Math.pow(10, decimals) * 100) / 100;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Batch fetch floor prices for multiple champions
 * Uses a queue with concurrency limit to avoid rate limiting
 */
export async function batchFetchFloorPrices(
  championNames: string[],
  onProgress?: (name: string, prices: Record<string, number | null>) => void,
  concurrency = 3
): Promise<Map<string, Record<string, number | null>>> {
  const results = new Map<string, Record<string, number | null>>();
  const queue = [...championNames];

  async function processNext(): Promise<void> {
    if (queue.length === 0) return;
    const name = queue.shift()!;
    const prices = await fetchChampionFloorPrices(name);
    results.set(name, prices);
    onProgress?.(name, prices);
    return processNext();
  }

  await Promise.all(Array.from({ length: concurrency }, processNext));
  return results;
}
