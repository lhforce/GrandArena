/**
 * Tests for Champion Stats service and Telegram alerts.
 */

import { describe, it, expect } from "vitest";
import {
  estimatePerformance,
  calculateV4Score,
  calculateSchemeScore,
  rankAllChampions,
  parseGameDataChampions,
  getBestChampionsForScheme,
  filterByRarity,
  filterByClass,
  CLASS_PERFORMANCE,
  SCHEME_CATEGORY_WEIGHTS,
  FUR_MULTIPLIER,
  type ChampionData,
} from "./championStats";

// ─── Test Data ──────────────────────────────────────────────────────────────

const mockChampion: ChampionData = {
  name: "Test Moki",
  championTokenId: "1234",
  tokenId: "5678",
  image: "https://example.com/test.webp",
  rarity: "Rare",
  fur: "Spirit",
  is1of1: false,
  traits: { Fur: ["Spirit"], Eye: ["Frown"] },
};

const mockChampionBasic: ChampionData = {
  name: "Basic Moki",
  championTokenId: "2345",
  tokenId: "6789",
  image: "https://example.com/basic.webp",
  rarity: "Basic",
  fur: "Light Brown",
  is1of1: false,
  traits: { Fur: ["Light Brown"] },
};

const mockChampionLegendary: ChampionData = {
  name: "Dheu",
  championTokenId: "3456",
  tokenId: "7890",
  image: "https://example.com/legendary.webp",
  rarity: "Legendary",
  fur: "Shadow",
  is1of1: false,
  traits: { Fur: ["Shadow"] },
};

const mockChampion1of1: ChampionData = {
  name: "Artist Moki",
  championTokenId: "4567",
  tokenId: "8901",
  image: "https://example.com/1of1.webp",
  rarity: "Epic",
  fur: "Rainbow",
  is1of1: true,
  traits: { Fur: ["Rainbow"], "1 of 1": ["true"] },
};

// ─── Performance Estimation Tests ───────────────────────────────────────────

describe("estimatePerformance", () => {
  it("should return estimated stats for a known class", () => {
    const perf = estimatePerformance(mockChampionLegendary, "Bruiser");
    expect(perf.estKills).toBeGreaterThan(0);
    expect(perf.estBalls).toBeGreaterThan(0);
    expect(perf.estWartDistance).toBeGreaterThan(0);
    expect(perf.estWinRate).toBeGreaterThan(0);
  });

  it("should apply fur multiplier for Spirit fur", () => {
    const spiritPerf = estimatePerformance(mockChampion, "Defender");
    const basicPerf = estimatePerformance(mockChampionBasic, "Defender");

    // Spirit (1.15x) should be higher than Light Brown (1.0x)
    expect(spiritPerf.estKills).toBeGreaterThan(basicPerf.estKills);
    expect(spiritPerf.furMultiplier).toBe(1.15);
    expect(basicPerf.furMultiplier).toBe(1.0);
  });

  it("should apply 1-of-1 bonus", () => {
    const normalPerf = estimatePerformance(
      { ...mockChampion1of1, is1of1: false },
      "Defender"
    );
    const oneOfOnePerf = estimatePerformance(mockChampion1of1, "Defender");

    expect(oneOfOnePerf.estKills).toBeGreaterThan(normalPerf.estKills);
  });

  it("should default to Defender class for unknown champions", () => {
    const perf = estimatePerformance(mockChampionBasic); // Unknown class
    const defenderStats = CLASS_PERFORMANCE["Defender"];
    // Should use Defender stats (default)
    expect(perf.estKills).toBeCloseTo(defenderStats.avgKills * 1.0, 1);
  });

  it("should use known class for recognized champions", () => {
    const dheuPerf = estimatePerformance(mockChampionLegendary); // "Dheu" is known as Bruiser
    const bruiserStats = CLASS_PERFORMANCE["Bruiser"];
    const shadowMult = FUR_MULTIPLIER["Shadow"];
    expect(dheuPerf.estKills).toBeCloseTo(bruiserStats.avgKills * shadowMult, 1);
  });
});

// ─── V4 Score Calculation Tests ─────────────────────────────────────────────

describe("calculateV4Score", () => {
  it("should calculate base score correctly", () => {
    const { baseScore } = calculateV4Score(2.0, 1.0, 50, 0.5, "Basic");
    // 2.0 * 85 + 1.0 * 40 + 50 * 1.257 + 0.5 * 200 = 170 + 40 + 62.85 + 100 = 372.85
    expect(baseScore).toBeCloseTo(372.85, 0);
  });

  it("should apply rarity multiplier", () => {
    const { baseScore, rarityScore } = calculateV4Score(2.0, 1.0, 50, 0.5, "Rare");
    expect(rarityScore).toBeCloseTo(baseScore * 1.25, 0);
  });

  it("should apply Legendary multiplier (1.75x)", () => {
    const { baseScore, rarityScore } = calculateV4Score(2.0, 1.0, 50, 0.5, "Legendary");
    expect(rarityScore).toBeCloseTo(baseScore * 1.75, 0);
  });

  it("should apply Epic multiplier (1.5x)", () => {
    const { baseScore, rarityScore } = calculateV4Score(2.0, 1.0, 50, 0.5, "Epic");
    expect(rarityScore).toBeCloseTo(baseScore * 1.5, 0);
  });

  it("should handle zero stats", () => {
    const { baseScore } = calculateV4Score(0, 0, 0, 0, "Basic");
    expect(baseScore).toBe(0);
  });
});

// ─── Scheme Score Calculation Tests ─────────────────────────────────────────

describe("calculateSchemeScore", () => {
  it("should weight kills heavily for kills schemes", () => {
    const killsScore = calculateSchemeScore(2.0, 1.0, 50, 0.5, "Basic", "kills");
    const ballsScore = calculateSchemeScore(2.0, 1.0, 50, 0.5, "Basic", "balls");

    // Kills scheme should value kills more
    // For kills: 2.0 * 85 * 3.0 + 1.0 * 40 * 0.0 + 50 * 0.5 * 0.0 + 0.5 * 200 * 0.5 = 510 + 0 + 0 + 50 = 560
    // For balls: 2.0 * 85 * 0.0 + 1.0 * 40 * 3.0 + 50 * 0.5 * 0.0 + 0.5 * 200 * 0.5 = 0 + 120 + 0 + 50 = 170
    expect(killsScore).toBeGreaterThan(ballsScore);
  });

  it("should weight balls heavily for balls schemes", () => {
    const ballsScore = calculateSchemeScore(0.5, 2.0, 30, 0.5, "Basic", "balls");
    const killsScore = calculateSchemeScore(0.5, 2.0, 30, 0.5, "Basic", "kills");

    expect(ballsScore).toBeGreaterThan(killsScore);
  });

  it("should weight wart heavily for wart schemes", () => {
    // Use a champion with high wart distance (like Striker class ~80 distance)
    // Wart scheme: 0.5*85*0 + 0.5*40*0 + 200*1.257*3.0 + 0.5*200*0.5 = 0 + 0 + 754.2 + 50 = 804.2
    // Kills scheme: 0.5*85*3.0 + 0.5*40*0 + 200*1.257*0 + 0.5*200*0.5 = 127.5 + 0 + 0 + 50 = 177.5
    const wartScore = calculateSchemeScore(0.5, 0.5, 200, 0.5, "Basic", "wart");
    const killsScore = calculateSchemeScore(0.5, 0.5, 200, 0.5, "Basic", "kills");

    expect(wartScore).toBeGreaterThan(killsScore);
  });

  it("should apply rarity multiplier to scheme scores", () => {
    const basicScore = calculateSchemeScore(1.0, 1.0, 50, 0.5, "Basic", "kills");
    const epicScore = calculateSchemeScore(1.0, 1.0, 50, 0.5, "Epic", "kills");

    expect(epicScore).toBeCloseTo(basicScore * 1.5, 0);
  });

  it("should have balanced weights for combo schemes", () => {
    const comboWeights = SCHEME_CATEGORY_WEIGHTS["combo"];
    expect(comboWeights.killWeight).toBe(1.5);
    expect(comboWeights.ballWeight).toBe(1.5);
  });
});

// ─── Champion Ranking Tests ─────────────────────────────────────────────────

describe("rankAllChampions", () => {
  const testChampions: ChampionData[] = [
    mockChampion,
    mockChampionBasic,
    mockChampionLegendary,
    mockChampion1of1,
  ];

  it("should rank all champions", () => {
    const rankings = rankAllChampions(testChampions);
    expect(rankings).toHaveLength(4);
  });

  it("should assign sequential ranks", () => {
    const rankings = rankAllChampions(testChampions);
    const ranks = rankings.map((r) => r.overallRank);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it("should sort by V4 rarity score descending", () => {
    const rankings = rankAllChampions(testChampions);
    for (let i = 1; i < rankings.length; i++) {
      expect(rankings[i - 1].v4RarityScore).toBeGreaterThanOrEqual(
        rankings[i].v4RarityScore
      );
    }
  });

  it("should include scheme scores for all categories", () => {
    const rankings = rankAllChampions(testChampions);
    const first = rankings[0];
    expect(first.schemeScores).toBeDefined();
    expect(Object.keys(first.schemeScores).length).toBeGreaterThan(5);
    expect(first.schemeScores["kills"]).toBeGreaterThan(0);
    expect(first.schemeScores["balls"]).toBeGreaterThan(0);
  });

  it("should preserve champion metadata", () => {
    const rankings = rankAllChampions(testChampions);
    const spirit = rankings.find((r) => r.name === "Test Moki");
    expect(spirit).toBeDefined();
    expect(spirit!.fur).toBe("Spirit");
    expect(spirit!.rarity).toBe("Rare");
  });
});

// ─── Filtering Tests ────────────────────────────────────────────────────────

describe("filterByRarity", () => {
  const rankings = rankAllChampions([
    mockChampion,
    mockChampionBasic,
    mockChampionLegendary,
    mockChampion1of1,
  ]);

  it("should return all when filter is ALL", () => {
    const result = filterByRarity(rankings, "ALL");
    expect(result).toHaveLength(4);
  });

  it("should filter by specific rarity", () => {
    const rare = filterByRarity(rankings, "Rare");
    expect(rare.every((r) => r.rarity === "Rare")).toBe(true);
  });

  it("should return empty for non-existent rarity", () => {
    const result = filterByRarity(rankings, "Mythic");
    expect(result).toHaveLength(0);
  });
});

describe("filterByClass", () => {
  const rankings = rankAllChampions([
    mockChampion,
    mockChampionBasic,
    mockChampionLegendary,
  ]);

  it("should return all when filter is ALL", () => {
    const result = filterByClass(rankings, "ALL");
    expect(result).toHaveLength(3);
  });

  it("should filter by specific class", () => {
    // Dheu is known as Bruiser
    const bruisers = filterByClass(rankings, "Bruiser");
    expect(bruisers.every((r) => r.championClass === "Bruiser")).toBe(true);
  });
});

describe("getBestChampionsForScheme", () => {
  const rankings = rankAllChampions([
    mockChampion,
    mockChampionBasic,
    mockChampionLegendary,
    mockChampion1of1,
  ]);

  it("should return top N champions for a scheme category", () => {
    const top2 = getBestChampionsForScheme(rankings, "kills", 2);
    expect(top2).toHaveLength(2);
  });

  it("should sort by scheme score descending", () => {
    const top = getBestChampionsForScheme(rankings, "kills", 4);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].schemeScores["kills"]).toBeGreaterThanOrEqual(
        top[i].schemeScores["kills"]
      );
    }
  });
});

// ─── parseGameDataChampions Tests ───────────────────────────────────────────

describe("parseGameDataChampions", () => {
  it("should parse game data format correctly", () => {
    const gameData = {
      champions: [
        {
          name: "Chef Maki",
          image: "https://example.com/chef.webp",
          tokenId: "1138545",
          championTokenId: "7008",
          attributes: { Rarity: ["Epic"], "Card Type": ["MOKI"] },
          mokiAttributes: {
            Fur: ["Spirit"],
            Eye: ["Frown"],
            "1 of 1": [],
          },
        },
      ],
    };

    const champions = parseGameDataChampions(gameData);
    expect(champions).toHaveLength(1);
    expect(champions[0].name).toBe("Chef Maki");
    expect(champions[0].rarity).toBe("Epic");
    expect(champions[0].fur).toBe("Spirit");
    expect(champions[0].is1of1).toBe(false);
  });

  it("should detect 1-of-1 champions", () => {
    const gameData = {
      champions: [
        {
          name: "Artist Moki",
          image: "https://example.com/artist.webp",
          tokenId: "999",
          championTokenId: "4567",
          attributes: { Rarity: ["Legendary"] },
          mokiAttributes: {
            Fur: ["Rainbow"],
            "1 of 1": ["true"],
          },
        },
      ],
    };

    const champions = parseGameDataChampions(gameData);
    expect(champions[0].is1of1).toBe(true);
  });

  it("should handle missing attributes gracefully", () => {
    const gameData = {
      champions: [
        {
          name: "Unknown Moki",
          image: "",
          tokenId: "0",
          championTokenId: "0",
          attributes: {},
          mokiAttributes: {},
        },
      ],
    };

    const champions = parseGameDataChampions(gameData);
    expect(champions[0].rarity).toBe("Basic");
    expect(champions[0].fur).toBe("Unknown");
  });
});

// ─── Class Performance Data Tests ───────────────────────────────────────────

describe("CLASS_PERFORMANCE", () => {
  it("should have all 10 classes defined", () => {
    const classes = Object.keys(CLASS_PERFORMANCE);
    expect(classes).toContain("Bruiser");
    expect(classes).toContain("Striker");
    expect(classes).toContain("Defender");
    expect(classes).toContain("Sprinter");
    expect(classes.length).toBe(10);
  });

  it("should have Bruiser as highest kills class", () => {
    const bruiserKills = CLASS_PERFORMANCE["Bruiser"].avgKills;
    for (const [cls, stats] of Object.entries(CLASS_PERFORMANCE)) {
      if (cls !== "Bruiser") {
        expect(bruiserKills).toBeGreaterThanOrEqual(stats.avgKills);
      }
    }
  });

  it("should have all win rates between 0 and 1", () => {
    for (const stats of Object.values(CLASS_PERFORMANCE)) {
      expect(stats.winRate).toBeGreaterThan(0);
      expect(stats.winRate).toBeLessThan(1);
    }
  });
});

// ─── Telegram Alert Tests ───────────────────────────────────────────────────

describe("Telegram alerts", () => {
  it("should have TELEGRAM_BOT_TOKEN env var set", () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("should have TELEGRAM_CHAT_ID env var set", () => {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    expect(chatId).toBeDefined();
    expect(chatId!.length).toBeGreaterThan(0);
  });
});
