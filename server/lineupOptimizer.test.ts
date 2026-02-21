/**
 * Tests for the lineup optimizer engine.
 */

import { describe, it, expect } from "vitest";
import {
  scoreChampion,
  filterByRarity,
  selectBestScheme,
  optimizeLineups,
  categorizeScheme,
  type ChampionCard,
  type SchemeCardData,
  type ContestRules,
} from "./lineupOptimizer";

// ─── Test Data ─────────────────────────────────────────────────────

const makeChampion = (
  name: string,
  rarity: string,
  tokenId: string,
  stats?: Partial<ChampionCard>
): ChampionCard => ({
  tokenId,
  championTokenId: `ct-${tokenId}`,
  name,
  rarity,
  avgKills: 2,
  avgBalls: 1,
  avgWartDistance: 50,
  winRate: 0.3,
  ...stats,
});

const makeScheme = (
  name: string,
  category: string,
  hasTraitFilter = false,
  qualifyingIds: string[] = []
): SchemeCardData => ({
  tokenId: `scheme-${name}`,
  name,
  description: "",
  hasTraitFilter,
  qualifyingChampionIds: qualifyingIds,
  category: category as any,
});

// ─── Tests ─────────────────────────────────────────────────────────

describe("categorizeScheme", () => {
  it("categorizes kill-focused schemes", () => {
    expect(categorizeScheme("Eliminations get 1.5x points. No points for delivering.")).toBe("kills");
  });

  it("categorizes mixed kill+ball as combo", () => {
    expect(categorizeScheme("Eliminations get 1.5x points. No points for delivering Gacha Balls")).toBe("combo");
  });

  it("categorizes ball-focused schemes", () => {
    expect(categorizeScheme("+200 points when winning Gacha Ball delivered to base")).toBe("balls");
  });

  it("categorizes wart-focused schemes", () => {
    expect(categorizeScheme("+150 points for riding Wart into the trap")).toBe("wart");
  });

  it("categorizes trait-based schemes", () => {
    expect(categorizeScheme("+25 points for EACH Shadow Fur trait in lineup")).toBe("trait");
  });

  it("categorizes combo schemes", () => {
    expect(categorizeScheme("+35 points Per Moki Elimination, +10 points per Gacha Ball delivered")).toBe("combo");
  });

  it("categorizes win-based schemes", () => {
    expect(categorizeScheme("+200 bonus when team wins the match")).toBe("win");
  });
});

describe("scoreChampion", () => {
  it("scores a Basic champion with no scheme", () => {
    const champ = makeChampion("TestMoki", "Basic", "1");
    const score = scoreChampion(champ, null);
    // Base: (2*85 + 1*40 + 50*0.5 + 0.3*200) * 1.0 = 170+40+25+60 = 295
    expect(score).toBe(295);
  });

  it("applies rarity multiplier for Legendary", () => {
    const basic = makeChampion("BasicMoki", "Basic", "1");
    const legendary = makeChampion("LegendMoki", "Legendary", "2");
    const basicScore = scoreChampion(basic, null);
    const legendaryScore = scoreChampion(legendary, null);
    // Legendary should be 1.75x the Basic score
    expect(legendaryScore).toBe(Math.round(295 * 1.75));
  });

  it("applies rarity multiplier for Rare", () => {
    const champ = makeChampion("RareMoki", "Rare", "3");
    const score = scoreChampion(champ, null);
    expect(score).toBe(Math.round(295 * 1.25));
  });

  it("applies rarity multiplier for Epic", () => {
    const champ = makeChampion("EpicMoki", "Epic", "4");
    const score = scoreChampion(champ, null);
    expect(score).toBe(Math.round(295 * 1.5));
  });

  it("adds scheme bonus for kills category", () => {
    const champ = makeChampion("Killer", "Basic", "5", { avgKills: 5 });
    const scheme = makeScheme("Aggressive", "kills");
    const withScheme = scoreChampion(champ, scheme);
    const withoutScheme = scoreChampion(champ, null);
    expect(withScheme).toBeGreaterThan(withoutScheme);
  });

  it("adds trait bonus for qualifying champions", () => {
    const champ = makeChampion("ShadowMoki", "Basic", "6");
    const scheme = makeScheme("Shadow", "trait", true, ["ct-6"]);
    const withScheme = scoreChampion(champ, scheme);
    const withoutScheme = scoreChampion(champ, null);
    expect(withScheme).toBeGreaterThan(withoutScheme);
  });

  it("does not add trait bonus for non-qualifying champions", () => {
    const champ = makeChampion("RainbowMoki", "Basic", "7");
    const scheme = makeScheme("Shadow", "trait", true, ["ct-999"]); // Different ID
    const withScheme = scoreChampion(champ, scheme);
    const withoutScheme = scoreChampion(champ, null);
    expect(withScheme).toBe(withoutScheme);
  });
});

describe("filterByRarity", () => {
  const champions = [
    makeChampion("Basic1", "Basic", "1"),
    makeChampion("Basic2", "Basic", "2"),
    makeChampion("Rare1", "Rare", "3"),
    makeChampion("Rare2", "Rare", "4"),
    makeChampion("Epic1", "Epic", "5"),
    makeChampion("Legend1", "Legendary", "6"),
  ];

  it("returns all for OPEN restriction", () => {
    expect(filterByRarity(champions, "OPEN")).toHaveLength(6);
  });

  it("filters COMMON_ONLY", () => {
    const result = filterByRarity(champions, "COMMON_ONLY");
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.rarity === "Basic")).toBe(true);
  });

  it("filters RARE_ONLY", () => {
    const result = filterByRarity(champions, "RARE_ONLY");
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.rarity === "Rare")).toBe(true);
  });

  it("filters EPIC_ONLY", () => {
    const result = filterByRarity(champions, "EPIC_ONLY");
    expect(result).toHaveLength(1);
    expect(result[0].rarity).toBe("Epic");
  });

  it("filters LEGENDARY_ONLY", () => {
    const result = filterByRarity(champions, "LEGENDARY_ONLY");
    expect(result).toHaveLength(1);
    expect(result[0].rarity).toBe("Legendary");
  });

  it("filters NO_LEGENDARY", () => {
    const result = filterByRarity(champions, "NO_LEGENDARY");
    expect(result).toHaveLength(5);
    expect(result.every((c) => c.rarity !== "Legendary")).toBe(true);
  });

  it("filters BASIC_OR_RARE", () => {
    const result = filterByRarity(champions, "BASIC_OR_RARE");
    expect(result).toHaveLength(4);
    expect(result.every((c) => c.rarity === "Basic" || c.rarity === "Rare")).toBe(true);
  });
});

describe("selectBestScheme", () => {
  it("returns null when no schemes available", () => {
    const champs = [makeChampion("A", "Basic", "1")];
    expect(selectBestScheme(champs, [])).toBeNull();
  });

  it("selects the scheme that gives highest total score", () => {
    const champs = [
      makeChampion("Killer", "Basic", "1", { avgKills: 10, avgBalls: 0 }),
      makeChampion("Killer2", "Basic", "2", { avgKills: 8, avgBalls: 0 }),
    ];
    const killScheme = makeScheme("Kills", "kills");
    const ballScheme = makeScheme("Balls", "balls");
    const result = selectBestScheme(champs, [killScheme, ballScheme]);
    expect(result?.name).toBe("Kills");
  });
});

describe("optimizeLineups", () => {
  const makeRoster = () => [
    makeChampion("Basic1", "Basic", "1", { avgKills: 3 }),
    makeChampion("Basic2", "Basic", "2", { avgKills: 2 }),
    makeChampion("Rare1", "Rare", "3", { avgKills: 4 }),
    makeChampion("Rare2", "Rare", "4", { avgKills: 3 }),
    makeChampion("Epic1", "Epic", "5", { avgKills: 5 }),
    makeChampion("Epic2", "Epic", "6", { avgKills: 4 }),
    makeChampion("Legend1", "Legendary", "7", { avgKills: 6 }),
    makeChampion("Legend2", "Legendary", "8", { avgKills: 5 }),
  ];

  const defaultRules: ContestRules = {
    rarityRestriction: "OPEN",
    isOneOfEach: false,
    isStarCap: false,
    maxEntriesPerUser: 5,
    format: "50/50",
  };

  it("builds a single lineup with 4 champions", () => {
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: defaultRules,
      numEntries: 1,
      entryFee: 100,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].champions).toHaveLength(4);
    expect(result.gemCost).toBe(100);
  });

  it("builds multiple lineups without reusing cards", () => {
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: defaultRules,
      numEntries: 2,
      entryFee: 100,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(2);
    
    // Check no card reuse
    const allTokenIds = result.lineups.flatMap((l) =>
      l.champions.map((c) => c.champion.tokenId)
    );
    const uniqueIds = new Set(allTokenIds);
    expect(uniqueIds.size).toBe(allTokenIds.length);
  });

  it("builds all requested lineups even when budget is exceeded", () => {
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: defaultRules,
      numEntries: 2,
      entryFee: 2000,
      dailyBudget: 1000, // budget only covers 0.5 entries, but should build both
    });

    // Budget no longer limits lineup generation — both entries should be built
    // (8 champions = max 2 lineups of 4 unique cards each)
    expect(result.lineups).toHaveLength(2);
    expect(result.gemCost).toBe(4000); // 2 entries * 2000 gems
    // Should have an informational warning about exceeding budget
    expect(result.warnings.some(w => w.includes("exceeds remaining budget"))).toBe(true);
  });

  it("respects max entries per user", () => {
    const rules: ContestRules = { ...defaultRules, maxEntriesPerUser: 2 };
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: rules,
      numEntries: 5,
      entryFee: 100,
      dailyBudget: 50000,
    });

    expect(result.lineups).toHaveLength(2);
  });

  it("prioritizes legendary champions in OPEN contests", () => {
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: defaultRules,
      numEntries: 1,
      entryFee: 100,
      dailyBudget: 5000,
    });

    // The top 4 should include legendary champions (highest multiplier)
    const rarities = result.lineups[0].champions.map((c) => c.champion.rarity);
    expect(rarities).toContain("Legendary");
  });

  it("warns when not enough cards", () => {
    const result = optimizeLineups({
      ownedMokis: [makeChampion("Only1", "Basic", "1")],
      ownedSchemes: [],
      allSchemes: [],
      contestRules: defaultRules,
      numEntries: 1,
      entryFee: 100,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("respects rarity restriction filters", () => {
    const rules: ContestRules = { ...defaultRules, rarityRestriction: "RARE_ONLY" };
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: rules,
      numEntries: 1,
      entryFee: 100,
      dailyBudget: 5000,
    });

    if (result.lineups.length > 0) {
      const rarities = result.lineups[0].champions.map((c) => c.champion.rarity);
      expect(rarities.every((r) => r === "Rare")).toBe(true);
    }
  });

  it("handles free entry contests", () => {
    const result = optimizeLineups({
      ownedMokis: makeRoster(),
      ownedSchemes: [],
      allSchemes: [],
      contestRules: defaultRules,
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 0,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.gemCost).toBe(0);
  });
});

// ─── Bug Fix Tests: Image URLs and Performance Stats ──────────────

describe("imageUrl passthrough", () => {
  it("preserves imageUrl on ChampionCard through optimizer", () => {
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "A", rarity: "Legendary", imageUrl: "https://example.com/a.webp", avgKills: 3, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "2", championTokenId: "ct-2", name: "B", rarity: "Legendary", imageUrl: "https://example.com/b.webp", avgKills: 2, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "3", championTokenId: "ct-3", name: "C", rarity: "Legendary", imageUrl: "https://example.com/c.webp", avgKills: 4, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "4", championTokenId: "ct-4", name: "D", rarity: "Legendary", imageUrl: "https://example.com/d.webp", avgKills: 1, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    for (const slot of result.lineups[0].champions) {
      expect(slot.champion.imageUrl).toBeDefined();
      expect(slot.champion.imageUrl).toMatch(/^https:\/\/example\.com\//);
    }
  });

  it("handles null imageUrl gracefully", () => {
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "A", rarity: "Basic", imageUrl: null, avgKills: 3, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "2", championTokenId: "ct-2", name: "B", rarity: "Basic", imageUrl: undefined, avgKills: 2, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "3", championTokenId: "ct-3", name: "C", rarity: "Basic", avgKills: 4, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "4", championTokenId: "ct-4", name: "D", rarity: "Basic", avgKills: 1, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    // Should not throw even with null/undefined imageUrl
    expect(result.lineups[0].champions).toHaveLength(4);
  });
});

describe("performance stats differentiation", () => {
  it("produces different scores when champions have different stats", () => {
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "TopKiller", rarity: "Basic", avgKills: 5, avgBalls: 2, avgWartDistance: 80, winRate: 0.7 },
      { tokenId: "2", championTokenId: "ct-2", name: "Average", rarity: "Basic", avgKills: 2, avgBalls: 1, avgWartDistance: 50, winRate: 0.3 },
      { tokenId: "3", championTokenId: "ct-3", name: "BallHog", rarity: "Basic", avgKills: 1, avgBalls: 4, avgWartDistance: 30, winRate: 0.4 },
      { tokenId: "4", championTokenId: "ct-4", name: "WartRunner", rarity: "Basic", avgKills: 0.5, avgBalls: 0.5, avgWartDistance: 120, winRate: 0.5 },
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    const scores = result.lineups[0].champions.map((s) => s.score);
    // Scores should NOT all be the same
    const uniqueScores = new Set(scores);
    expect(uniqueScores.size).toBeGreaterThan(1);
  });

  it("enriches champions with performanceStats from map", () => {
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "A", rarity: "Basic" },
      { tokenId: "2", championTokenId: "ct-2", name: "B", rarity: "Basic" },
      { tokenId: "3", championTokenId: "ct-3", name: "C", rarity: "Basic" },
      { tokenId: "4", championTokenId: "ct-4", name: "D", rarity: "Basic" },
    ];
    const performanceStats = new Map<string, { avgKills: number; avgBalls: number; avgWartDistance: number; winRate: number }>();
    performanceStats.set("ct-1", { avgKills: 5, avgBalls: 2, avgWartDistance: 80, winRate: 0.7 });
    performanceStats.set("ct-2", { avgKills: 1, avgBalls: 0.5, avgWartDistance: 20, winRate: 0.2 });
    performanceStats.set("ct-3", { avgKills: 3, avgBalls: 1.5, avgWartDistance: 60, winRate: 0.5 });
    performanceStats.set("ct-4", { avgKills: 0.5, avgBalls: 3, avgWartDistance: 40, winRate: 0.4 });

    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
      performanceStats,
    });

    expect(result.lineups).toHaveLength(1);
    const scores = result.lineups[0].champions.map((s) => s.score);
    const uniqueScores = new Set(scores);
    // With different performance stats, scores should be different
    expect(uniqueScores.size).toBeGreaterThan(1);

    // The first champion (highest score) should be the one with best stats (ct-1)
    expect(result.lineups[0].champions[0].champion.name).toBe("A");
  });

  it("falls back to defaults when no performanceStats provided", () => {
    // All champions with no stats should get the same default score per rarity
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "A", rarity: "Basic" },
      { tokenId: "2", championTokenId: "ct-2", name: "B", rarity: "Basic" },
      { tokenId: "3", championTokenId: "ct-3", name: "C", rarity: "Basic" },
      { tokenId: "4", championTokenId: "ct-4", name: "D", rarity: "Basic" },
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
      // No performanceStats
    });

    expect(result.lineups).toHaveLength(1);
    const scores = result.lineups[0].champions.map((s) => s.score);
    // Without stats, all Basic champions get the same default score
    expect(new Set(scores).size).toBe(1);
  });

  it("scheme imageUrl is preserved in optimizer output", () => {
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "A", rarity: "Basic", avgKills: 3, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "2", championTokenId: "ct-2", name: "B", rarity: "Basic", avgKills: 2, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "3", championTokenId: "ct-3", name: "C", rarity: "Basic", avgKills: 4, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
      { tokenId: "4", championTokenId: "ct-4", name: "D", rarity: "Basic", avgKills: 1, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 },
    ];
    const schemes: SchemeCardData[] = [{
      tokenId: "scheme-1", name: "Test Scheme", description: "",
      hasTraitFilter: false, qualifyingChampionIds: [],
      category: "other", imageUrl: "https://example.com/scheme.webp",
    }];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, ownedSchemes: schemes, allSchemes: schemes,
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].scheme).not.toBeNull();
    expect(result.lineups[0].scheme?.imageUrl).toBe("https://example.com/scheme.webp");
  });
});
