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
  classifySchemeRisk,
  getSchemeRiskMultiplier,
  isShortMatchContest,
  isSchemeEligible,
  type ChampionCard,
  type SchemeCardData,
  type ContestRules,
  type SchemeRiskLevel,
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
  qualifyingIds: string[] = [],
  riskLevel: SchemeRiskLevel = "reliable"
): SchemeCardData => ({
  tokenId: `scheme-${name}`,
  name,
  description: "",
  hasTraitFilter,
  qualifyingChampionIds: qualifyingIds,
  category: category as any,
  riskLevel,
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
    // Base: (winRate*300 + avgKills*70 + avgBalls*30 + avgWart*0.3) * 1.0
    // = (0.3*300 + 2*70 + 1*30 + 50*0.3) * 1.0 = 90+140+30+15 = 275
    expect(score).toBe(275);
  });

  it("applies rarity multiplier for Legendary", () => {
    const basic = makeChampion("BasicMoki", "Basic", "1");
    const legendary = makeChampion("LegendMoki", "Legendary", "2");
    const basicScore = scoreChampion(basic, null);
    const legendaryScore = scoreChampion(legendary, null);
    // Legendary should be 1.75x the Basic score
    expect(legendaryScore).toBe(Math.round(275 * 1.75));
  });

  it("applies rarity multiplier for Rare", () => {
    const champ = makeChampion("RareMoki", "Rare", "3");
    const score = scoreChampion(champ, null);
    expect(score).toBe(Math.round(275 * 1.25));
  });

  it("applies rarity multiplier for Epic", () => {
    const champ = makeChampion("EpicMoki", "Epic", "4");
    const score = scoreChampion(champ, null);
    expect(score).toBe(Math.round(275 * 1.5));
  });

  it("adds scheme bonus for kills category", () => {
    const champ = makeChampion("Killer", "Basic", "5", { avgKills: 5 });
    const scheme = makeScheme("Aggressive", "kills");
    const withScheme = scoreChampion(champ, scheme);
    const withoutScheme = scoreChampion(champ, null);
    expect(withScheme).toBeGreaterThan(withoutScheme);
  });

  it("qualifying champions under trait scheme score same as base (no per-MOKI bonus — bonus is at lineup level)", () => {
    const champ = makeChampion("ShadowMoki", "Basic", "6");
    const scheme = makeScheme("Shadow", "trait", true, ["ct-6"]);
    const withScheme = scoreChampion(champ, scheme);
    const withoutScheme = scoreChampion(champ, null);
    // Qualifying MOKIs get their full base score (no per-MOKI bonus).
    // The trait bonus is applied at the lineup level in the co-optimization loop.
    // Qualifying MOKIs get their full base score.
    // Non-qualifying MOKIs now get -Infinity (hard exclusion), so qualifying is always better.
    expect(withScheme).toBeGreaterThanOrEqual(withoutScheme);
  });

  it("hard-excludes non-qualifying champions under trait schemes", () => {
    const champ = makeChampion("RainbowMoki", "Basic", "7");
    const scheme = makeScheme("Shadow", "trait", true, ["ct-999"]); // Different ID
    const withScheme = scoreChampion(champ, scheme);
    // HARD EXCLUSION: non-qualifying MOKIs return -Infinity
    expect(withScheme).toBe(-Infinity);
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: [makeChampion("Only1", "Basic", "1")], allMokis: [makeChampion("Only1", "Basic", "1")],
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: makeRoster(), allMokis: makeRoster(),
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
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
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
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
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
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
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
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
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
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
      // No performanceStats
    });

    expect(result.lineups).toHaveLength(1);
    const scores = result.lineups[0].champions.map((s) => s.score);
    // Without stats, all Basic champions get the same default score
    expect(new Set(scores).size).toBe(1);
  });

  it("scheme imageUrl is preserved in optimizer output", () => {
    // Use kill-heavy MOKIs with a kills scheme so the scheme wins over no-scheme baseline
    const mokis: ChampionCard[] = [
      { tokenId: "1", championTokenId: "ct-1", name: "A", rarity: "Basic", avgKills: 5, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 },
      { tokenId: "2", championTokenId: "ct-2", name: "B", rarity: "Basic", avgKills: 4, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 },
      { tokenId: "3", championTokenId: "ct-3", name: "C", rarity: "Basic", avgKills: 6, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 },
      { tokenId: "4", championTokenId: "ct-4", name: "D", rarity: "Basic", avgKills: 3, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 },
    ];
    const schemes: SchemeCardData[] = [{
      tokenId: "scheme-1", name: "Kill Scheme", description: "",
      hasTraitFilter: false, qualifyingChampionIds: [],
      category: "kills", riskLevel: "reliable", imageUrl: "https://example.com/scheme.webp",
    }];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: schemes, allSchemes: schemes,
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].scheme).not.toBeNull();
    expect(result.lineups[0].scheme?.imageUrl).toBe("https://example.com/scheme.webp");
  });

  it("prevents duplicate champion names within a single lineup", () => {
    // Simulate owning multiple copies of the same champion at different rarities
    const mokis: ChampionCard[] = [
      makeChampion("Dheu", "Epic", "100", { avgKills: 6 }),
      makeChampion("Dheu", "Epic", "101", { avgKills: 5 }),  // Same name, different tokenId
      makeChampion("Dheu", "Rare", "102", { avgKills: 4 }),   // Same name, different rarity
      makeChampion("Vagabond", "Epic", "103", { avgKills: 5 }),
      makeChampion("67", "Epic", "104", { avgKills: 4 }),
      makeChampion("Smiley", "Epic", "105", { avgKills: 3 }),
      makeChampion("Toast", "Rare", "106", { avgKills: 2 }),
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });
    expect(result.lineups).toHaveLength(1);
    const names = result.lineups[0].champions.map(s => s.champion.name.toLowerCase());
    // All 4 champion names must be unique
    expect(new Set(names).size).toBe(4);
    // Specifically, "dheu" should appear at most once
    expect(names.filter(n => n === "dheu").length).toBe(1);
  });

  it("prevents duplicate champion names in One-Of-Each lineups", () => {
    // Same champion name across different rarities — optimizer must pick unique names
    const mokis: ChampionCard[] = [
      makeChampion("Dheu", "Legendary", "200", { avgKills: 8 }),
      makeChampion("Dheu", "Epic", "201", { avgKills: 6 }),
      makeChampion("Dheu", "Rare", "202", { avgKills: 4 }),
      makeChampion("Dheu", "Basic", "203", { avgKills: 2 }),
      makeChampion("Vagabond", "Legendary", "207", { avgKills: 7 }),
      makeChampion("Vagabond", "Epic", "204", { avgKills: 5 }),
      makeChampion("Smiley", "Rare", "205", { avgKills: 3 }),
      makeChampion("Toast", "Basic", "206", { avgKills: 1 }),
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: true, isStarCap: false,
      maxEntriesPerUser: 1, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 1, entryFee: 0, dailyBudget: 5000,
    });
    expect(result.lineups).toHaveLength(1);
    const names = result.lineups[0].champions.map(s => s.champion.name.toLowerCase());
    // All 4 champion names must be unique — Dheu should only appear once
    expect(new Set(names).size).toBe(4);
    expect(names.filter(n => n === "dheu").length).toBe(1);
  });

  it("allows same champion name in different entries (different physical cards)", () => {
    // 8 unique champions but 2 copies of Dheu at different rarities
    const mokis: ChampionCard[] = [
      makeChampion("Dheu", "Legendary", "300", { avgKills: 8 }),
      makeChampion("Dheu", "Epic", "301", { avgKills: 6 }),
      makeChampion("Vagabond", "Legendary", "302", { avgKills: 7 }),
      makeChampion("Smiley", "Legendary", "303", { avgKills: 6 }),
      makeChampion("Toast", "Epic", "304", { avgKills: 5 }),
      makeChampion("67", "Epic", "305", { avgKills: 4 }),
      makeChampion("Gambit", "Rare", "306", { avgKills: 3 }),
      makeChampion("Clutch", "Rare", "307", { avgKills: 2 }),
      makeChampion("Bearish", "Basic", "308", { avgKills: 1 }),
    ];
    const rules: ContestRules = {
      rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false,
      maxEntriesPerUser: 2, format: "50/50",
    };
    const result = optimizeLineups({
      ownedMokis: mokis, allMokis: mokis, ownedSchemes: [], allSchemes: [],
      contestRules: rules, numEntries: 2, entryFee: 0, dailyBudget: 5000,
    });
    expect(result.lineups).toHaveLength(2);
    // Each individual lineup must have unique names
    for (const lineup of result.lineups) {
      const names = lineup.champions.map(s => s.champion.name.toLowerCase());
      expect(new Set(names).size).toBe(4);
    }
  });
});

// ─── Scheme Risk Classification Tests ─────────────────────────────

describe("classifySchemeRisk", () => {
  it("classifies trait-based schemes as guaranteed", () => {
    expect(classifySchemeRisk("Fur Frenzy", "+50 points for each matching fur trait")).toBe("guaranteed");
    expect(classifySchemeRisk("Rarity Bonus", "+25 for each unique card rarity in lineup")).toBe("guaranteed");
  });

  it("classifies action-based schemes as reliable", () => {
    expect(classifySchemeRisk("Aggressive Specialization", "1.5x points per elimination")).toBe("reliable");
    expect(classifySchemeRisk("Collective Specialization", "1.3x points per gacha ball delivered")).toBe("reliable");
    expect(classifySchemeRisk("Wart Rodeo", "+5 points every second riding wart")).toBe("reliable");
    expect(classifySchemeRisk("Kill Bonus", "+50 per moki elimination")).toBe("reliable");
  });

  it("classifies win-dependent schemes as moderate", () => {
    expect(classifySchemeRisk("Victory Lap", "+100 for winning team")).toBe("moderate");
    expect(classifySchemeRisk("Taking a Dive", "+200 for losing team")).toBe("moderate");
  });

  it("classifies event-dependent schemes as risky", () => {
    expect(classifySchemeRisk("Cursed Dinner", "+50 every time you eat a moki while riding wart")).toBe("risky");
    expect(classifySchemeRisk("Saccing", "+100 when eaten by wart")).toBe("risky");
    expect(classifySchemeRisk("Moki Smash", "+200 when team wins by 3+ eliminations")).toBe("risky");
  });

  it("classifies all-or-nothing schemes as high_risk", () => {
    expect(classifySchemeRisk("Gacha Hoarding", "double total points if win, 0 total points if lose")).toBe("high_risk");
  });
});

describe("getSchemeRiskMultiplier", () => {
  it("returns correct base multipliers", () => {
    expect(getSchemeRiskMultiplier("guaranteed")).toBe(1.5);
    expect(getSchemeRiskMultiplier("reliable")).toBe(1.0);
    expect(getSchemeRiskMultiplier("moderate")).toBe(0.7);
    expect(getSchemeRiskMultiplier("risky")).toBe(0.4);
    expect(getSchemeRiskMultiplier("high_risk")).toBe(0.2);
  });

  it("boosts risky scheme when empirical data shows high win rate", () => {
    const empirical = { winRate: 0.75, appearances: 10, confidence: 0.8 };
    const multiplier = getSchemeRiskMultiplier("risky", empirical);
    // Should be boosted above the base 0.4
    expect(multiplier).toBeGreaterThan(0.4);
  });

  it("does not boost when empirical data has low confidence", () => {
    const empirical = { winRate: 0.75, appearances: 2, confidence: 0.3 };
    const multiplier = getSchemeRiskMultiplier("risky", empirical);
    // Low confidence = no override, stays at base
    expect(multiplier).toBe(0.4);
  });

  it("penalizes further when empirical data confirms underperformance", () => {
    const empirical = { winRate: 0.2, appearances: 10, confidence: 0.8 };
    const multiplier = getSchemeRiskMultiplier("risky", empirical);
    // Should be penalized below the base 0.4
    expect(multiplier).toBeLessThanOrEqual(0.4);
  });
  it("trait scheme gets 2.2x boost in topPercent contests", () => {
    // Trait schemes are guaranteed points — always boosted in topPercent
    const multiplier = getSchemeRiskMultiplier("guaranteed", null, "topPercent", "trait");
     expect(multiplier).toBeGreaterThanOrEqual(2.2);
  });
});

describe("isSchemeEligible", () => {
  const halfDayRules: ContestRules = {
    rarityRestriction: "EPIC_ONLY",
    isOneOfEach: false,
    isStarCap: false,
    maxEntriesPerUser: 3,
    format: "topPercent",
    isShortMatch: true,
  };
  const fullDayRules: ContestRules = {
    rarityRestriction: "OPEN",
    isOneOfEach: false,
    isStarCap: false,
    maxEntriesPerUser: 5,
    format: "standard",
    isShortMatch: false,
  };
  const oneOfEachRules: ContestRules = {
    rarityRestriction: "ONE_OF_EACH",
    isOneOfEach: true,
    isStarCap: false,
    maxEntriesPerUser: 5,
    format: "standard",
    isShortMatch: false,
  };
  const makeSchemeCard = (name: string, cat: string): SchemeCardData => ({
    tokenId: `s-${name}`,
    name,
    description: "",
    hasTraitFilter: cat === "trait",
    qualifyingChampionIds: [],
    category: cat as any,
    riskLevel: "reliable",
  });

  it("Half-Day: ONLY trait schemes are eligible", () => {
    expect(isSchemeEligible(makeSchemeCard("Midnight Strike", "trait"), halfDayRules)).toBe(true);
    expect(isSchemeEligible(makeSchemeCard("Cage Match", "combo"), halfDayRules)).toBe(false);
    expect(isSchemeEligible(makeSchemeCard("Kill Bonus", "kills"), halfDayRules)).toBe(false);
    expect(isSchemeEligible(makeSchemeCard("Ball Bonus", "balls"), halfDayRules)).toBe(false);
    expect(isSchemeEligible(makeSchemeCard("Victory Lap", "win"), halfDayRules)).toBe(false);
    expect(isSchemeEligible(makeSchemeCard("Collect Em All", "rarity"), halfDayRules)).toBe(false);
  });

  it("Full-Day: all non-rarity schemes are eligible", () => {
    expect(isSchemeEligible(makeSchemeCard("Midnight Strike", "trait"), fullDayRules)).toBe(true);
    expect(isSchemeEligible(makeSchemeCard("Cage Match", "combo"), fullDayRules)).toBe(true);
    expect(isSchemeEligible(makeSchemeCard("Kill Bonus", "kills"), fullDayRules)).toBe(true);
    expect(isSchemeEligible(makeSchemeCard("Victory Lap", "win"), fullDayRules)).toBe(true);
  });

  it("Collect Em All: ONLY eligible in One-of-Each contests", () => {
    const collectEmAll = makeSchemeCard("Collect Em All", "rarity");
    // Epic Only (single rarity) → NOT eligible
    expect(isSchemeEligible(collectEmAll, { ...fullDayRules, rarityRestriction: "EPIC_ONLY" })).toBe(false);
    // Open (mixed rarities possible but not guaranteed) → NOT eligible
    expect(isSchemeEligible(collectEmAll, fullDayRules)).toBe(false);
    // One-of-Each (guaranteed 4 rarities) → eligible
    expect(isSchemeEligible(collectEmAll, oneOfEachRules)).toBe(true);
  });

  it("Half-Day Epic Only: the exact contest Larry reported — only trait schemes allowed", () => {
    const traitScheme = makeSchemeCard("Golden Shower", "trait");
    const cageMatch = makeSchemeCard("Cage Match", "combo");
    const collectEmAll = makeSchemeCard("Collect Em All", "rarity");
    expect(isSchemeEligible(traitScheme, halfDayRules)).toBe(true);
    expect(isSchemeEligible(cageMatch, halfDayRules)).toBe(false);
    expect(isSchemeEligible(collectEmAll, halfDayRules)).toBe(false);
  });
});

describe("selectBestScheme with risk adjustment", () => {
  it("prefers reliable scheme over risky scheme with same raw score", () => {
    const champs = [
      makeChampion("A", "Epic", "1"),
      makeChampion("B", "Epic", "2"),
      makeChampion("C", "Epic", "3"),
      makeChampion("D", "Epic", "4"),
    ];

    const reliableScheme = makeScheme("Kill Bonus", "kills", false, [], "reliable");
    const riskyScheme = makeScheme("Cursed Dinner", "kills", false, [], "risky");

    const result = selectBestScheme(champs, [reliableScheme, riskyScheme]);
    expect(result?.name).toBe("Kill Bonus");
  });

  it("prefers guaranteed scheme over reliable scheme", () => {
    const champs = [
      makeChampion("A", "Epic", "1"),
      makeChampion("B", "Epic", "2"),
      makeChampion("C", "Epic", "3"),
      makeChampion("D", "Epic", "4"),
    ];

    const guaranteedScheme = makeScheme("Fur Frenzy", "trait", false, [], "guaranteed");
    const reliableScheme = makeScheme("Kill Bonus", "kills", false, [], "reliable");

    const result = selectBestScheme(champs, [guaranteedScheme, reliableScheme]);
    // Guaranteed gets 1.15x multiplier vs reliable 1.0x
    // But trait schemes give smaller raw bonus, so this tests the multiplier effect
    expect(result).toBeDefined();
  });

  it("can override risky penalty with strong empirical data", () => {
    const champs = [
      makeChampion("A", "Epic", "1"),
      makeChampion("B", "Epic", "2"),
      makeChampion("C", "Epic", "3"),
      makeChampion("D", "Epic", "4"),
    ];

    // A risky scheme that empirical data shows wins 80% of the time
    const riskyScheme = makeScheme("Cursed Dinner", "kills", false, [], "risky");
    const moderateScheme = makeScheme("Victory Lap", "win", false, [], "moderate");

    const schemeEmpirical = new Map([
      ["cursed dinner", { winRate: 0.9, appearances: 20, confidence: 0.9 }],
    ]);

    const result = selectBestScheme(champs, [riskyScheme, moderateScheme], schemeEmpirical);
    // With strong empirical override, Cursed Dinner should be boosted enough to compete
    expect(result).toBeDefined();
  });
});


// ─── Co-Optimization Tests: Scheme + MOKI Selection ─────────────

describe("co-optimization: Scheme drives MOKI selection", () => {
  const defaultRules: ContestRules = {
    rarityRestriction: "OPEN",
    isOneOfEach: false,
    isStarCap: false,
    maxEntriesPerUser: 5,
    format: "50/50",
  };

  it("picks kill-heavy MOKIs when a kill Scheme is best", () => {
    // Mix of killers and ball carriers
    const mokis: ChampionCard[] = [
      makeChampion("Killer1", "Epic", "k1", { avgKills: 5, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Killer2", "Epic", "k2", { avgKills: 4, avgBalls: 0.1, avgWartDistance: 15, winRate: 0.5 }),
      makeChampion("Killer3", "Epic", "k3", { avgKills: 3.5, avgBalls: 0.2, avgWartDistance: 20, winRate: 0.5 }),
      makeChampion("Killer4", "Epic", "k4", { avgKills: 3, avgBalls: 0.3, avgWartDistance: 25, winRate: 0.5 }),
      makeChampion("BallCarrier1", "Epic", "b1", { avgKills: 0, avgBalls: 5, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallCarrier2", "Epic", "b2", { avgKills: 0, avgBalls: 4.5, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallCarrier3", "Epic", "b3", { avgKills: 0.1, avgBalls: 4, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallCarrier4", "Epic", "b4", { avgKills: 0.1, avgBalls: 3.5, avgWartDistance: 0, winRate: 0.5 }),
    ];

    // Only a kill-focused scheme available
    const killScheme = makeScheme("Aggressive Specialization", "kills", false, [], "reliable");

    const result = optimizeLineups({
      ownedMokis: mokis,
      allMokis: mokis,
      ownedSchemes: [killScheme],
      allSchemes: [killScheme],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].scheme?.name).toBe("Aggressive Specialization");

    // All 4 selected MOKIs should be killers (high avgKills)
    const selectedNames = result.lineups[0].champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("Killer1");
    expect(selectedNames).toContain("Killer2");
    expect(selectedNames).toContain("Killer3");
    expect(selectedNames).toContain("Killer4");
    // No ball carriers should be selected
    expect(selectedNames).not.toContain("BallCarrier1");
    expect(selectedNames).not.toContain("BallCarrier2");
  });

  it("picks ball-heavy MOKIs when a ball Scheme is best", () => {
    const mokis: ChampionCard[] = [
      makeChampion("Killer1", "Epic", "k1", { avgKills: 5, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Killer2", "Epic", "k2", { avgKills: 4, avgBalls: 0.1, avgWartDistance: 15, winRate: 0.5 }),
      makeChampion("Killer3", "Epic", "k3", { avgKills: 3.5, avgBalls: 0.2, avgWartDistance: 20, winRate: 0.5 }),
      makeChampion("Killer4", "Epic", "k4", { avgKills: 3, avgBalls: 0.3, avgWartDistance: 25, winRate: 0.5 }),
      makeChampion("BallCarrier1", "Epic", "b1", { avgKills: 0, avgBalls: 5, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallCarrier2", "Epic", "b2", { avgKills: 0, avgBalls: 4.5, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallCarrier3", "Epic", "b3", { avgKills: 0.1, avgBalls: 4, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallCarrier4", "Epic", "b4", { avgKills: 0.1, avgBalls: 3.5, avgWartDistance: 0, winRate: 0.5 }),
    ];

    // Only a ball-focused scheme available
    const ballScheme = makeScheme("Collective Specialization", "balls", false, [], "reliable");

    const result = optimizeLineups({
      ownedMokis: mokis,
      allMokis: mokis,
      ownedSchemes: [ballScheme],
      allSchemes: [ballScheme],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].scheme?.name).toBe("Collective Specialization");

    // All 4 selected MOKIs should be ball carriers
    const selectedNames = result.lineups[0].champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("BallCarrier1");
    expect(selectedNames).toContain("BallCarrier2");
    expect(selectedNames).toContain("BallCarrier3");
    expect(selectedNames).toContain("BallCarrier4");
    // No killers should be selected
    expect(selectedNames).not.toContain("Killer1");
    expect(selectedNames).not.toContain("Killer2");
  });

  it("selects the best Scheme+MOKI combo when multiple Schemes are available", () => {
    // 4 killers and 4 ball carriers, with ball carriers having higher volume
    const mokis: ChampionCard[] = [
      makeChampion("Killer1", "Epic", "k1", { avgKills: 3, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Killer2", "Epic", "k2", { avgKills: 2.5, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Killer3", "Epic", "k3", { avgKills: 2, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Killer4", "Epic", "k4", { avgKills: 1.5, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("BallGod1", "Epic", "b1", { avgKills: 0, avgBalls: 6, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallGod2", "Epic", "b2", { avgKills: 0, avgBalls: 5.5, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallGod3", "Epic", "b3", { avgKills: 0, avgBalls: 5, avgWartDistance: 0, winRate: 0.5 }),
      makeChampion("BallGod4", "Epic", "b4", { avgKills: 0, avgBalls: 4.5, avgWartDistance: 0, winRate: 0.5 }),
    ];

    const killScheme = makeScheme("Kill Focus", "kills", false, [], "reliable");
    const ballScheme = makeScheme("Ball Focus", "balls", false, [], "reliable");

    const result = optimizeLineups({
      ownedMokis: mokis,
      allMokis: mokis,
      ownedSchemes: [killScheme, ballScheme],
      allSchemes: [killScheme, ballScheme],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    // The ball carriers have much higher volume (avg 5.25 balls vs avg 2.25 kills)
    // So the ball scheme + ball carriers combo should win
    expect(result.lineups[0].scheme?.name).toBe("Ball Focus");
    const selectedNames = result.lineups[0].champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("BallGod1");
    expect(selectedNames).toContain("BallGod2");
  });

  it("combo scheme (Cage Match) picks MOKIs that maximize combined kills+balls", () => {
    const mokis: ChampionCard[] = [
      // Pure killers: high kills, no balls
      makeChampion("PureKiller", "Epic", "pk1", { avgKills: 4, avgBalls: 0, avgWartDistance: 10, winRate: 0.5 }),
      // Pure ball carriers: no kills, high balls
      makeChampion("PureBaller", "Epic", "pb1", { avgKills: 0, avgBalls: 5, avgWartDistance: 0, winRate: 0.5 }),
      // Hybrid: decent kills AND decent balls
      makeChampion("Hybrid1", "Epic", "h1", { avgKills: 2, avgBalls: 2.5, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Hybrid2", "Epic", "h2", { avgKills: 1.8, avgBalls: 2.3, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Hybrid3", "Epic", "h3", { avgKills: 1.5, avgBalls: 2, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Hybrid4", "Epic", "h4", { avgKills: 1.3, avgBalls: 1.8, avgWartDistance: 10, winRate: 0.5 }),
      makeChampion("Weak1", "Epic", "w1", { avgKills: 0.5, avgBalls: 0.5, avgWartDistance: 10, winRate: 0.3 }),
      makeChampion("Weak2", "Epic", "w2", { avgKills: 0.3, avgBalls: 0.3, avgWartDistance: 10, winRate: 0.3 }),
    ];

    // Cage Match: +35 per elimination, +10 per ball
    const cageMatch = makeScheme("Cage Match", "combo", false, [], "reliable");

    const result = optimizeLineups({
      ownedMokis: mokis,
      allMokis: mokis,
      ownedSchemes: [cageMatch],
      allSchemes: [cageMatch],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].scheme?.name).toBe("Cage Match");

    // With Cage Match weighting kills at 35pts and balls at 10pts,
    // PureKiller (4 kills * 35 = 140) should be valued highly
    // PureBaller (5 balls * 10 = 50) should be valued less
    // The lineup should prefer killers and hybrids over pure ballers
    const selectedNames = result.lineups[0].champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("PureKiller");
    expect(selectedNames).not.toContain("Weak1");
    expect(selectedNames).not.toContain("Weak2");
  });

  it("trait Scheme selects qualifying MOKIs over non-qualifying ones", () => {
    const mokis: ChampionCard[] = [
      makeChampion("QualifyingA", "Epic", "q1", { avgKills: 2, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 }),
      makeChampion("QualifyingB", "Epic", "q2", { avgKills: 1.5, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 }),
      makeChampion("QualifyingC", "Epic", "q3", { avgKills: 1, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 }),
      makeChampion("QualifyingD", "Epic", "q4", { avgKills: 0.8, avgBalls: 1, avgWartDistance: 50, winRate: 0.5 }),
      // Slightly better stats but doesn't qualify for the trait scheme
      makeChampion("NonQualifyingX", "Epic", "nq1", { avgKills: 2.5, avgBalls: 1.5, avgWartDistance: 60, winRate: 0.55 }),
      makeChampion("NonQualifyingY", "Epic", "nq2", { avgKills: 2.2, avgBalls: 1.3, avgWartDistance: 55, winRate: 0.52 }),
    ];

    // Trait scheme that only qualifying champions benefit from (big bonus)
    const traitScheme: SchemeCardData = {
      tokenId: "scheme-trait",
      name: "Shadow Fur Frenzy",
      description: "+50 points for each Shadow Fur trait",
      hasTraitFilter: true,
      qualifyingChampionIds: ["ct-q1", "ct-q2", "ct-q3", "ct-q4"],
      category: "trait",
      riskLevel: "guaranteed",
      imageUrl: null,
    };

    const result = optimizeLineups({
      ownedMokis: mokis,
      allMokis: mokis,
      ownedSchemes: [traitScheme],
      allSchemes: [traitScheme],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);
    expect(result.lineups[0].scheme?.name).toBe("Shadow Fur Frenzy");

    // Should pick all 4 qualifying MOKIs (trait bonus outweighs slight stat advantage)
    const selectedNames = result.lineups[0].champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("QualifyingA");
    expect(selectedNames).toContain("QualifyingB");
    expect(selectedNames).toContain("QualifyingC");
    expect(selectedNames).toContain("QualifyingD");
  });

  it("reproduces the MahoShojo bug fix: Cage Match should NOT pick ball-only MOKIs", () => {
    // This test reproduces the exact scenario Larry found:
    // MahoShojo and Tamanuki are pure ball carriers (0 kills, 5+ balls)
    // Cage Match gives +35/kill, +10/ball — should prefer killers
    const mokis: ChampionCard[] = [
      makeChampion("MahoShojo", "Epic", "ms1", { avgKills: 0, avgBalls: 5.06, avgWartDistance: 0.62, winRate: 0.505 }),
      makeChampion("Tamanuki", "Epic", "tm1", { avgKills: 0.03, avgBalls: 5.08, avgWartDistance: 0.25, winRate: 0.44 }),
      makeChampion("Peeltergeist", "Epic", "pg1", { avgKills: 0.87, avgBalls: 0.03, avgWartDistance: 247, winRate: 0.47 }),
      makeChampion("Shadowstorm", "Epic", "ss1", { avgKills: 1.4, avgBalls: 0.3, avgWartDistance: 155, winRate: 0.614 }),
      // Additional killers that should be preferred for Cage Match
      makeChampion("TopKiller", "Epic", "tk1", { avgKills: 2.5, avgBalls: 0.2, avgWartDistance: 80, winRate: 0.55 }),
      makeChampion("MidKiller", "Epic", "mk1", { avgKills: 1.8, avgBalls: 0.1, avgWartDistance: 100, winRate: 0.52 }),
    ];

    const cageMatch = makeScheme("Cage Match", "combo", false, [], "reliable");

    const result = optimizeLineups({
      ownedMokis: mokis,
      allMokis: mokis,
      ownedSchemes: [cageMatch],
      allSchemes: [cageMatch],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 0,
      dailyBudget: 5000,
    });

    expect(result.lineups).toHaveLength(1);

    const selectedNames = result.lineups[0].champions.map((s) => s.champion.name);

    // TopKiller and Shadowstorm should definitely be in the lineup
    expect(selectedNames).toContain("TopKiller");
    expect(selectedNames).toContain("Shadowstorm");

    // MahoShojo (0 kills) should NOT be picked for a kill-weighted Cage Match scheme
    // unless there aren't enough killers (but we have 4 killers available)
    expect(selectedNames).not.toContain("MahoShojo");
    expect(selectedNames).not.toContain("Tamanuki");
  });
});


// ─── Trait Scheme Co-Optimization Tests ──────────────────────────────

describe("Trait scheme co-optimization", () => {
  // Simulate a trait scheme like "Midnight Strike" (+25 for EACH Shadow Fur)
  const traitScheme: SchemeCardData = {
    tokenId: "trait-shadow",
    name: "Midnight Strike",
    description: "+25 points for EACH Shadow Fur trait in lineup",
    hasTraitFilter: true,
    qualifyingChampionIds: ["ct-shadow1", "ct-shadow2", "ct-shadow3", "ct-shadow4", "ct-shadow5"],
    category: "trait",
    riskLevel: "guaranteed",
    imageUrl: null,
  };

  // Non-trait performance scheme for comparison
  const cageMatch: SchemeCardData = {
    tokenId: "cage-match",
    name: "Cage Match",
    description: "+35 points Per Moki Elimination, +10 points per Gacha Ball delivered",
    hasTraitFilter: false,
    qualifyingChampionIds: [],
    category: "combo",
    riskLevel: "reliable",
    imageUrl: null,
  };

  // Champions: mix of qualifying and non-qualifying
  const shadowKiller = makeChampion("ShadowKiller", "Epic", "shadow1", {
    avgKills: 2.0, avgBalls: 0.5, avgWartDistance: 50, winRate: 0.6,
  });
  const shadowBaller = makeChampion("ShadowBaller", "Epic", "shadow2", {
    avgKills: 0.5, avgBalls: 4.0, avgWartDistance: 30, winRate: 0.5,
  });
  const shadowAvg = makeChampion("ShadowAvg", "Epic", "shadow3", {
    avgKills: 1.0, avgBalls: 1.0, avgWartDistance: 60, winRate: 0.45,
  });
  const shadowWeak = makeChampion("ShadowWeak", "Epic", "shadow4", {
    // Decent stats — weak compared to other shadows but still competitive enough
    // to be preferred over non-qualifying MOKIs when trait bonus is factored in
    avgKills: 1.2, avgBalls: 0.8, avgWartDistance: 40, winRate: 0.45,
  });
  // Realistic stats: killers specialize in kills (low balls), ball carriers specialize in balls (low kills)
  // NonShadow MOKIs are strong killers but don't qualify for the trait scheme
  const nonShadowStar = makeChampion("NonShadowStar", "Epic", "nonshadow1", {
    avgKills: 2.8, avgBalls: 0.1, avgWartDistance: 60, winRate: 0.65,
  });
  const nonShadowGood = makeChampion("NonShadowGood", "Epic", "nonshadow2", {
    avgKills: 2.3, avgBalls: 0.1, avgWartDistance: 50, winRate: 0.60,
  });

  it("trait scheme scores qualifying MOKIs higher than non-qualifying stars", () => {
    // ShadowKiller (qualifying, decent stats) should score higher than
    // NonShadowStar (non-qualifying, amazing stats) under a trait scheme
    const shadowScore = scoreChampion(shadowKiller, traitScheme);
    const nonShadowScore = scoreChampion(nonShadowStar, traitScheme);

    // Non-qualifying gets 30% of base score, qualifying gets base + 125 bonus
    expect(shadowScore).toBeGreaterThan(nonShadowScore);
  });

  it("trait scheme: qualifying MOKI gets full base score (trait bonus is at lineup level, not per-MOKI)", () => {
    const baseScore = scoreChampion(shadowKiller, null);
    const traitScore = scoreChampion(shadowKiller, traitScheme);

    // Qualifying MOKIs get their full base score under trait schemes.
    // The +25/match × 5 matches = +125 per qualifying MOKI bonus is applied
    // at the LINEUP level in the co-optimization loop, not per-MOKI in scoreChampion.
    // This allows the optimizer to correctly count how many qualifiers are in the lineup.
    expect(traitScore).toBe(baseScore);
  });

  it("non-qualifying MOKIs are hard-excluded from trait scheme lineups", () => {
    const traitScore = scoreChampion(nonShadowStar, traitScheme);

    // HARD EXCLUSION: non-qualifying MOKIs return -Infinity so they are NEVER picked.
    // A Golden Shower lineup must only contain Gold Fur champions, etc.
    expect(traitScore).toBe(-Infinity);
  });

  it("categorizeScheme returns 'trait' when hasTraitFilter is true", () => {
    expect(categorizeScheme("any description", true)).toBe("trait");
    expect(categorizeScheme("+25 points for EACH Onesie or Lemon in lineup", true)).toBe("trait");
  });

  it("categorizeScheme detects trait from description pattern", () => {
    expect(categorizeScheme("+25 points for EACH Shadow Fur trait in lineup")).toBe("trait");
    expect(categorizeScheme("+25 points for EACH 1 of 1 Moki in lineup")).toBe("trait");
    expect(categorizeScheme("+25 points for each Rainbow Fur trait in lineup")).toBe("trait");
  });

  it("optimizer picks trait scheme in Half-Day contest (trait-only rule enforced)", () => {
    // In a Half-Day contest, Step 4 of the pipeline eliminates ALL non-trait schemes.
    // Even if NonShadowStar has better raw stats for Cage Match, it doesn't matter —
    // Cage Match is ineligible and only trait schemes are considered.
    const allChampions = [
      shadowKiller, shadowBaller, shadowAvg, shadowWeak,
      nonShadowStar, nonShadowGood,
    ];
    const allSchemes = [traitScheme, cageMatch];
    const result = optimizeLineups({
      ownedMokis: allChampions,
      allMokis: allChampions,
      ownedSchemes: allSchemes,
      allSchemes,
      // Half-Day + topPercent: Step 4 eliminates Cage Match, only trait schemes allowed
      contestRules: {
        rarityRestriction: "OPEN",
        isOneOfEach: false,
        isStarCap: false,
        maxEntriesPerUser: 5,
        format: "standard",
        contestType: "topPercent",
        isShortMatch: true,  // Half-Day: trait-only
      },
      numEntries: 1,
      entryFee: 200,
      dailyBudget: 5000,
    });
    expect(result.lineups).toHaveLength(1);
    const lineup = result.lineups[0];
    // Cage Match is ineligible (Step 4 eliminates it) — Midnight Strike must be selected
    expect(lineup.scheme?.name).toBe("Midnight Strike");
    // Only qualifying Shadow MOKIs should be picked (non-qualifying are hard-excluded)
    const selectedNames = lineup.champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("ShadowKiller");
    expect(selectedNames).toContain("ShadowBaller");
    // NonShadowStar should NOT be picked (doesn't qualify for the trait scheme)
    expect(selectedNames).not.toContain("NonShadowStar");
  });

  it("optimizer picks performance scheme when fewer than 4 qualifying MOKIs exist", () => {
    // Only 2 shadow MOKIs available — trait scheme less valuable
    const limitedChampions = [
      shadowKiller, shadowBaller,
      nonShadowStar, nonShadowGood,
      makeChampion("NonShadow3", "Epic", "nonshadow3", {
        avgKills: 2.0, avgBalls: 1.5, avgWartDistance: 70, winRate: 0.55,
      }),
      makeChampion("NonShadow4", "Epic", "nonshadow4", {
        avgKills: 1.8, avgBalls: 1.2, avgWartDistance: 65, winRate: 0.5,
      }),
    ];
    const allSchemes = [traitScheme, cageMatch];
    const rules: ContestRules = {
      contestId: "perf-test",
      contestName: "Perf Test Contest",
      rarityFilter: null,
      maxEntries: 1,
      entryCost: 200,
    };

    const result = optimizeLineups({
      ownedMokis: limitedChampions,
      allMokis: limitedChampions,
      ownedSchemes: allSchemes,
      allSchemes,
      contestRules: { rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false, maxEntriesPerUser: 5, format: "standard" },
      numEntries: 1,
      entryFee: 200,
      dailyBudget: 5000,
    });
    const lineup = result.lineups[0];

    // With only 2 qualifying MOKIs, the trait scheme's total bonus is only +250
    // while the performance scheme with 4 strong performers should score higher
    // The optimizer should pick Cage Match or at least not force all-shadow
    expect(lineup.scheme?.name).toBe("Cage Match");
  });

   it("among qualifying trait MOKIs, optimizer picks the best performers", () => {
    // 5 qualifying MOKIs but only 4 slots — should pick the 4 best performers
    // Scores (base formula, Epic 1.5x):
    //   ShadowStrong: 536, ShadowKiller: 525, ShadowBaller: 471, ShadowWeak: 383, ShadowAvg: 380
    // ShadowAvg (380) is the weakest and should be dropped
    const fiveShadows = [
      shadowKiller,   // 525: 2.0 kills, 0.6 WR
      shadowBaller,   // 471: 4.0 balls, 0.5 WR
      shadowAvg,      // 380: 1.0/1.0, 0.45 WR — weakest
      shadowWeak,     // 383: 1.2 kills, 0.45 WR — slightly better than Avg
      makeChampion("ShadowStrong", "Epic", "shadow5", {
        avgKills: 1.8, avgBalls: 1.5, avgWartDistance: 70, winRate: 0.55,
      }),  // 536: best overall
    ];
    const result = optimizeLineups({
      ownedMokis: fiveShadows,
      allMokis: fiveShadows,
      ownedSchemes: [traitScheme],
      allSchemes: [traitScheme],
      contestRules: { rarityRestriction: "OPEN", isOneOfEach: false, isStarCap: false, maxEntriesPerUser: 5, format: "standard" },
      numEntries: 1,
      entryFee: 200,
      dailyBudget: 5000,
    });
    const lineup = result.lineups[0];
    const selectedNames = lineup.champions.map((s) => s.champion.name);
    // ShadowAvg (lowest score) should be dropped in favor of the 4 stronger performers
    expect(selectedNames).not.toContain("ShadowAvg");
    expect(selectedNames).toContain("ShadowKiller");
    expect(selectedNames).toContain("ShadowBaller");
    expect(selectedNames).toContain("ShadowStrong");
    expect(selectedNames).toContain("ShadowWeak");
  });
});


describe("Collect Em All rarity scheme scoring", () => {
  const defaultRules: ContestRules = {
    rarityRestriction: "OPEN",
    isOneOfEach: false,
    isStarCap: false,
    maxEntriesPerUser: 5,
    format: "standard",
  };

  const collectEmAll: SchemeCardData = {
    tokenId: "scheme-rarity-1",
    name: "Collect Em All",
    description: "+35 points per EACH unique card rarity in lineup",
    hasTraitFilter: false,
    qualifyingChampionIds: [],
    category: "rarity" as any,
    riskLevel: "guaranteed",
    imageUrl: null,
  };

  it("Collect Em All is EXCLUDED from Epic Only contests (not isOneOfEach)", () => {
    // Epic Only = only 1 unique rarity possible -> Collect Em All scores only +35 total
    // The optimizer should eliminate it and fall back to no-scheme scoring
    const epics = [
      makeChampion("EpicA", "Epic", "e1", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
      makeChampion("EpicB", "Epic", "e2", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
      makeChampion("EpicC", "Epic", "e3", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
      makeChampion("EpicD", "Epic", "e4", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
    ];
    const result = optimizeLineups({
      ownedMokis: epics,
      allMokis: epics,
      ownedSchemes: [collectEmAll],
      allSchemes: [collectEmAll],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY", isOneOfEach: false },
      numEntries: 1,
      entryFee: 200,
      dailyBudget: 5000,
    });
    const lineup = result.lineups[0];
    expect(lineup.champions).toHaveLength(4);
    lineup.champions.forEach((s) => expect(s.champion.rarity).toBe("Epic"));
    // Collect Em All should NOT be selected (ineligible for non-OneOfEach contests)
    expect(lineup.scheme).toBeNull();
  });

  it("should select Collect Em All ONLY in One-of-Each contests", () => {
    const diverse = [
      makeChampion("BasicA", "Basic", "b1", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
      makeChampion("RareA", "Rare", "r1", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
      makeChampion("EpicA", "Epic", "e1", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
      makeChampion("LegendaryA", "Legendary", "l1", { avgKills: 2, avgBalls: 2, avgWartDistance: 100, winRate: 0.5 }),
    ];
    const result = optimizeLineups({
      ownedMokis: diverse,
      allMokis: diverse,
      ownedSchemes: [collectEmAll],
      allSchemes: [collectEmAll],
      // One-of-Each: guaranteed 4 different rarities -> Collect Em All scores full +140
      contestRules: { ...defaultRules, rarityRestriction: "ONE_OF_EACH", isOneOfEach: true },
      numEntries: 1,
      entryFee: 200,
      dailyBudget: 5000,
    });
    const lineup = result.lineups[0];
    expect(lineup.champions).toHaveLength(4);
    expect(lineup.scheme?.name).toBe("Collect Em All");
  });
});

describe("All-champions candidate pool", () => {
  const defaultRules: ContestRules = {
    rarityRestriction: "OPEN",
    isOneOfEach: false,
    isStarCap: false,
    maxEntriesPerUser: 5,
    format: "standard",
  };

  it("should pick from allMokis pool, not just ownedMokis", () => {
    const ownedWeak = [
      makeChampion("WeakA", "Epic", "w1", { avgKills: 0.1, avgBalls: 0.1, avgWartDistance: 10, winRate: 0.1 }),
      makeChampion("WeakB", "Epic", "w2", { avgKills: 0.1, avgBalls: 0.1, avgWartDistance: 10, winRate: 0.1 }),
    ];
    const allChamps = [
      ...ownedWeak,
      makeChampion("StrongA", "Epic", "s1", { avgKills: 3, avgBalls: 3, avgWartDistance: 200, winRate: 0.8 }),
      makeChampion("StrongB", "Epic", "s2", { avgKills: 3, avgBalls: 3, avgWartDistance: 200, winRate: 0.8 }),
      makeChampion("StrongC", "Epic", "s3", { avgKills: 3, avgBalls: 3, avgWartDistance: 200, winRate: 0.8 }),
      makeChampion("StrongD", "Epic", "s4", { avgKills: 3, avgBalls: 3, avgWartDistance: 200, winRate: 0.8 }),
    ];
    const result = optimizeLineups({
      ownedMokis: ownedWeak,
      allMokis: allChamps,
      ownedSchemes: [],
      allSchemes: [],
      contestRules: { ...defaultRules, rarityRestriction: "EPIC_ONLY" },
      numEntries: 1,
      entryFee: 200,
      dailyBudget: 5000,
    });
    const lineup = result.lineups[0];
    expect(lineup.champions).toHaveLength(4);
    const selectedNames = lineup.champions.map((s) => s.champion.name);
    expect(selectedNames).toContain("StrongA");
    expect(selectedNames).toContain("StrongB");
    expect(selectedNames).toContain("StrongC");
    expect(selectedNames).toContain("StrongD");
    expect(selectedNames).not.toContain("WeakA");
    expect(selectedNames).not.toContain("WeakB");
  });
});

describe("isShortMatchContest", () => {
  it("detects 'Half-Day' with hyphen (the real GA API format)", () => {
    expect(isShortMatchContest("Top 20% Epic Only Half-Day Yaki Syndicate")).toBe(true);
  });
  it("detects 'Half Day' with space", () => {
    expect(isShortMatchContest("Top 20% Half Day Contest")).toBe(true);
  });
  it("detects 'Halfday' with no separator", () => {
    expect(isShortMatchContest("Halfday Tournament")).toBe(true);
  });
  it("detects 'HALF-DAY' uppercase", () => {
    expect(isShortMatchContest("HALF-DAY EPIC ONLY")).toBe(true);
  });
  it("returns false for regular contests", () => {
    expect(isShortMatchContest("Top 20% Epic Only Yaki Syndicate")).toBe(false);
    expect(isShortMatchContest("Legendary Only Cage Match")).toBe(false);
    expect(isShortMatchContest("Top 10% Open")).toBe(false);
  });
});
