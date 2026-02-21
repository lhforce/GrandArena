import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Helper: create a mock context ─────────────────────────────────
function createMockContext(): TrpcContext {
  return {
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
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("contests.list", () => {
  it("returns an object with contests array and total count", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.list({
      limit: 10,
      offset: 0,
    });

    expect(result).toHaveProperty("contests");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.contests)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("respects limit parameter", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.list({
      limit: 5,
      offset: 0,
    });

    expect(result.contests.length).toBeLessThanOrEqual(5);
  });

  it("filters by status when provided", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.list({
      status: "LIVE",
      limit: 50,
      offset: 0,
    });

    // All returned contests should have LIVE status (or empty if none)
    for (const contest of result.contests) {
      expect(contest.contestStatus).toBe("LIVE");
    }
  });
});

describe("contests.stats", () => {
  it("returns dashboard statistics object", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.stats();

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toHaveProperty("totalContests");
      expect(result).toHaveProperty("completedContests");
      expect(result).toHaveProperty("liveContests");
      expect(result).toHaveProperty("openContests");
      expect(result).toHaveProperty("draftContests");
      expect(result).toHaveProperty("totalLeaderboardEntries");
      expect(result).toHaveProperty("identifiedEntries");
      expect(typeof result.totalContests).toBe("number");
      expect(typeof result.completedContests).toBe("number");
    }
  });
});

describe("contests.winningLineups", () => {
  it("returns an array of winning lineup entries", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.winningLineups({
      limit: 10,
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it("filters by rarity restriction", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.winningLineups({
      rarityRestriction: "OPEN",
      limit: 10,
    });

    expect(Array.isArray(result)).toBe(true);
    for (const entry of result) {
      expect(entry.rarityRestriction).toBe("OPEN");
    }
  });
});

describe("contests.scrapeJobs", () => {
  it("returns an array of scrape job records", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.scrapeJobs({ limit: 5 });

    expect(Array.isArray(result)).toBe(true);
    for (const job of result) {
      expect(job).toHaveProperty("id");
      expect(job).toHaveProperty("jobType");
      expect(job).toHaveProperty("status");
    }
  });
});

describe("contests.rarityDistribution", () => {
  it("returns an array of rarity distribution entries", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.rarityDistribution();

    expect(Array.isArray(result)).toBe(true);
    for (const entry of result) {
      expect(entry).toHaveProperty("rarityRestriction");
      expect(entry).toHaveProperty("count");
    }
  });
});

describe("contests.getWithLeaderboard", () => {
  it("returns null for non-existent contest", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.contests.getWithLeaderboard({
      contestId: 999999,
      leaderboardLimit: 10,
    });

    expect(result).toBeNull();
  });
});
