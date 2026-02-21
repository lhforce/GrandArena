/**
 * Tests for Ronin Marketplace API proxy routes
 * These tests verify the tRPC procedures work correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("getWalletChampions", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns empty array for wallet with no champions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          erc721Tokens: {
            total: 0,
            results: [],
          },
        },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getWalletChampions({
      walletAddress: "0x0000000000000000000000000000000000000000",
    });

    expect(result.ownedChampionIds).toEqual([]);
  });

  it("returns champion IDs from wallet", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          erc721Tokens: {
            total: 2,
            results: [
              {
                tokenId: 12345,
                attributes: { "Champion Token ID": ["8509"] },
              },
              {
                tokenId: 67890,
                attributes: { "Champion Token ID": ["8510"] },
              },
            ],
          },
        },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getWalletChampions({
      walletAddress: "0x55c26Db6b037eF38179d75Ed3bbCB07b06fFC1e7",
    });

    expect(result.ownedChampionIds).toContain("8509");
    expect(result.ownedChampionIds).toContain("8510");
    expect(result.ownedChampionIds).toHaveLength(2);
  });

  it("handles tokens without Champion Token ID gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          erc721Tokens: {
            total: 1,
            results: [
              {
                tokenId: 99999,
                attributes: {}, // No Champion Token ID
              },
            ],
          },
        },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getWalletChampions({
      walletAddress: "0x55c26Db6b037eF38179d75Ed3bbCB07b06fFC1e7",
    });

    expect(result.ownedChampionIds).toHaveLength(0);
  });

  it("converts wallet address to lowercase for query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          erc721Tokens: { total: 0, results: [] },
        },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    await caller.getWalletChampions({
      walletAddress: "0x55C26DB6B037EF38179D75ED3BBCB07B06FFC1E7",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain("0x55c26db6b037ef38179d75ed3bbcb07b06ffc1e7");
  });
});

describe("getBatchFloorPrices", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns null prices when no listings exist", async () => {
    // Mock 4 calls (one per rarity) returning no results
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          erc721Tokens: { results: [] },
        },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getBatchFloorPrices({
      championNames: ["Kuroshi"],
    });

    expect(result.prices["Kuroshi"]).toBeDefined();
    expect(result.prices["Kuroshi"]["Basic"]).toBeNull();
    expect(result.prices["Kuroshi"]["Rare"]).toBeNull();
    expect(result.prices["Kuroshi"]["Epic"]).toBeNull();
    expect(result.prices["Kuroshi"]["Legendary"]).toBeNull();
  });

  it("converts raw price with decimals correctly", async () => {
    // Only the first call (Basic) returns a price
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Basic rarity - 5.5 RON = 5500000000000000000 wei (18 decimals)
        return {
          ok: true,
          json: async () => ({
            data: {
              erc721Tokens: {
                results: [
                  {
                    order: {
                      currentPrice: "5500000000000000000",
                      paymentToken: { symbol: "RON", decimals: 18 },
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: { erc721Tokens: { results: [] } },
        }),
      };
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getBatchFloorPrices({
      championNames: ["Kuroshi"],
    });

    // The price for Basic should be 5.5 RON
    expect(result.prices["Kuroshi"]["Basic"]).toBe(5.5);
  });

  it("handles multiple champions in one batch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { erc721Tokens: { results: [] } },
      }),
    });

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getBatchFloorPrices({
      championNames: ["Kuroshi", "Ronin Spirit", "Smiley"],
    });

    expect(result.prices["Kuroshi"]).toBeDefined();
    expect(result.prices["Ronin Spirit"]).toBeDefined();
    expect(result.prices["Smiley"]).toBeDefined();
  });

  it("handles fetch errors gracefully without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.getBatchFloorPrices({
      championNames: ["Kuroshi"],
    });

    // Should return null prices instead of throwing
    expect(result.prices["Kuroshi"]).toBeDefined();
    expect(result.prices["Kuroshi"]["Basic"]).toBeNull();
  });
});

describe("auth.logout", () => {
  it("clears session cookie on logout", async () => {
    const clearedCookies: Array<{ name: string; options: Record<string, unknown> }> = [];
    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCookies.push({ name, options });
        },
      } as unknown as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result.success).toBe(true);
    expect(clearedCookies).toHaveLength(1);
  });
});
