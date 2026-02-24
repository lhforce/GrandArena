import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { contestRouter } from "./contestRouter";
import { lineupRouter } from "./lineupRouter";
import { statsRouter } from "./statsRouter";
import { telegramRouter } from "./telegramRouter";
import { matchupRouter } from "./matchupRouter";
import { arbitrageRouter } from "./arbitrageRouter";
import { z } from "zod";

const GRAPHQL_URL = 'https://marketplace-graphql.skymavis.com/graphql';
const GA_CARDS_CONTRACT = '0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b';

async function gqlFetch(query: string) {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (data.errors) throw new Error(data.errors[0]?.message ?? 'GraphQL error');
  return data.data;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Contest optimizer routes
  contests: contestRouter,

  // Lineup builder routes
  lineup: lineupRouter,

  // Champion stats routes
  stats: statsRouter,

  // Telegram alerts routes
  telegram: telegramRouter,

  // Matchup intelligence routes
  matchup: matchupRouter,

  // Card Arbitrage routes
  arbitrage: arbitrageRouter,

  /**
   * Proxy: Fetch all Grand Arena MOKI cards owned by a wallet address
   */
  getWalletChampions: publicProcedure
    .input(z.object({ walletAddress: z.string() }))
    .query(async ({ input }) => {
      const owned: string[] = [];
      let from = 0;
      const size = 50;

      while (true) {
        const query = `{
          erc721Tokens(
            tokenAddress: "${GA_CARDS_CONTRACT}",
            owner: "${input.walletAddress.toLowerCase()}",
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

        const data = await gqlFetch(query) as {
          erc721Tokens: {
            total: number;
            results: Array<{ tokenId: number; attributes: Record<string, string[]> }>;
          };
        };

        const results = data.erc721Tokens.results;
        const total = data.erc721Tokens.total;

        for (const r of results) {
          const champId = r.attributes?.['Champion Token ID']?.[0];
          if (champId) owned.push(champId);
        }

        from += size;
        if (from >= total || results.length === 0) break;
      }

      return { ownedChampionIds: owned };
    }),

  /**
   * Proxy: Fetch floor prices for multiple champions at once (batched)
   */
  getBatchFloorPrices: publicProcedure
    .input(z.object({ championNames: z.array(z.string()) }))
    .query(async ({ input }) => {
      const allPrices: Record<string, Record<string, number | null>> = {};

      await Promise.all(
        input.championNames.map(async (name) => {
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
                  name: "${name.replace(/"/g, '\\"')}"
                ) {
                  results {
                    order {
                      currentPrice
                      paymentToken { symbol decimals }
                    }
                  }
                }
              }`;
              try {
                const data = await gqlFetch(query) as {
                  erc721Tokens: {
                    results: Array<{
                      order: { currentPrice: string; paymentToken: { decimals: number } } | null;
                    }>;
                  };
                };
                const r = data.erc721Tokens.results;
                if (r.length > 0 && r[0]?.order) {
                  const decimals = r[0].order.paymentToken?.decimals ?? 18;
                  const price = Number(BigInt(r[0].order.currentPrice)) / Math.pow(10, decimals);
                  prices[rarity] = Math.round(price * 100) / 100;
                } else {
                  prices[rarity] = null;
                }
              } catch {
                prices[rarity] = null;
              }
            })
          );

          allPrices[name] = prices;
        })
      );

      return { prices: allPrices };
    }),
});

export type AppRouter = typeof appRouter;
