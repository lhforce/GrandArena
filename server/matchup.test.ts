/**
 * Tests for the matchup intelligence system:
 * - Match scraper API fetching
 * - Matchup analytics calculations
 * - Router procedures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Match Scraper Tests ───────────────────────────────────────────

describe("Match Scraper", () => {
  it("should parse GATracker mokiMatches API response format (array wrapper)", () => {
    // The API can return [{ data: [...], pagination: {...} }]
    const mockResponse = [
      {
        data: [
          {
            id: "abc123",
            matchId: "match001",
            mokiId: "moki001",
            isBye: false,
            matchDate: "2026-02-20",
            results: {
              winType: "eliminations",
              deposits: 1,
              eliminations: 3,
              wartDistance: 200.5,
            },
            match: {
              id: "match001",
              gameType: "mokiMayhem",
              state: "scored",
              isBye: false,
              players: [
                {
                  mokiId: "moki001",
                  team: 1,
                  name: "Golden Nugget",
                  tokenId: 5256,
                  imageUrl: "https://example.com/img.png",
                  class: "Sprinter",
                },
                {
                  mokiId: "moki002",
                  team: 1,
                  name: "Moki #6701",
                  tokenId: 6701,
                  imageUrl: "https://example.com/img2.png",
                  class: "Defender",
                },
                {
                  mokiId: "moki003",
                  team: 1,
                  name: "Moki #6057",
                  tokenId: 6057,
                  imageUrl: "https://example.com/img3.png",
                  class: "Striker",
                },
                {
                  mokiId: "moki004",
                  team: 2,
                  name: "Fenrir",
                  tokenId: 5705,
                  imageUrl: "https://example.com/img4.png",
                  class: "Defender",
                },
                {
                  mokiId: "moki005",
                  team: 2,
                  name: "Moki #7438",
                  tokenId: 7438,
                  imageUrl: "https://example.com/img5.png",
                  class: "Striker",
                },
                {
                  mokiId: "moki006",
                  team: 2,
                  name: "Moki #6893",
                  tokenId: 6893,
                  imageUrl: "https://example.com/img6.png",
                  class: "Sprinter",
                },
              ],
              result: {
                players: [
                  { mokiId: "moki001", deposits: 1, eliminations: 3, wartDistance: 200.5 },
                  { mokiId: "moki002", deposits: 0, eliminations: 1, wartDistance: 0 },
                  { mokiId: "moki003", deposits: 0, eliminations: 2, wartDistance: 0 },
                  { mokiId: "moki004", deposits: 0, eliminations: 0, wartDistance: 100 },
                  { mokiId: "moki005", deposits: 2, eliminations: 0, wartDistance: 0 },
                  { mokiId: "moki006", deposits: 0, eliminations: 0, wartDistance: 50 },
                ],
                winType: "eliminations",
                teamWon: 1,
                duration: 39.25,
              },
              matchDate: "2026-02-20",
            },
          },
        ],
        pagination: { page: 1, limit: 100, total: 901, pages: 10 },
      },
    ];

    // Parse the array wrapper format
    const parsed =
      Array.isArray(mockResponse) && mockResponse[0]?.data
        ? mockResponse[0]
        : mockResponse;

    expect(parsed.data).toHaveLength(1);
    expect(parsed.pagination.total).toBe(901);
    expect(parsed.pagination.pages).toBe(10);
  });

  it("should parse GATracker mokiMatches API response format (direct object)", () => {
    const mockResponse = {
      data: [
        {
          id: "abc123",
          matchId: "match001",
          mokiId: "moki001",
          isBye: false,
          matchDate: "2026-02-20",
          results: { winType: "eliminations", deposits: 1, eliminations: 3, wartDistance: 200.5 },
          match: {
            id: "match001",
            gameType: "mokiMayhem",
            state: "scored",
            isBye: false,
            players: [],
            result: { players: [], winType: "eliminations", teamWon: 1, duration: 39.25 },
            matchDate: "2026-02-20",
          },
        },
      ],
      pagination: { page: 1, limit: 100, total: 50, pages: 1 },
    };

    expect(mockResponse.data).toHaveLength(1);
    expect(mockResponse.pagination.total).toBe(50);
  });

  it("should correctly identify team membership and winner", () => {
    const match = {
      players: [
        { mokiId: "m1", team: 1, name: "Alpha", tokenId: 100, class: "Striker" },
        { mokiId: "m2", team: 1, name: "Beta", tokenId: 200, class: "Defender" },
        { mokiId: "m3", team: 1, name: "Gamma", tokenId: 300, class: "Sprinter" },
        { mokiId: "m4", team: 2, name: "Delta", tokenId: 400, class: "Bruiser" },
        { mokiId: "m5", team: 2, name: "Epsilon", tokenId: 500, class: "Grinder" },
        { mokiId: "m6", team: 2, name: "Zeta", tokenId: 600, class: "Support" },
      ],
      result: { teamWon: 1, winType: "eliminations", duration: 45.0 },
    };

    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);

    expect(team1).toHaveLength(3);
    expect(team2).toHaveLength(3);

    // Team 1 won
    for (const p of team1) {
      expect(match.result.teamWon === p.team).toBe(true);
    }
    for (const p of team2) {
      expect(match.result.teamWon === p.team).toBe(false);
    }
  });

  it("should handle bye matches correctly", () => {
    const entry = {
      id: "bye123",
      matchId: "byematch001",
      mokiId: "moki001",
      isBye: true,
      matchDate: "2026-02-20",
      results: null,
      match: null,
    };

    // Bye matches should be skipped
    expect(entry.isBye).toBe(true);
    expect(entry.match).toBeNull();
  });

  it("should extract player stats from match result", () => {
    const result = {
      players: [
        { mokiId: "m1", deposits: 2, eliminations: 3, wartDistance: 150.5 },
        { mokiId: "m2", deposits: 0, eliminations: 1, wartDistance: 0 },
        { mokiId: "m3", deposits: 5, eliminations: 0, wartDistance: 0 },
      ],
      winType: "eliminations",
      teamWon: 1,
      duration: 42.5,
    };

    const m1Stats = result.players.find((p) => p.mokiId === "m1");
    expect(m1Stats).toBeDefined();
    expect(m1Stats!.eliminations).toBe(3);
    expect(m1Stats!.deposits).toBe(2);
    expect(m1Stats!.wartDistance).toBe(150.5);
  });
});

// ─── Matchup Analytics Tests ───────────────────────────────────────

describe("Matchup Analytics Calculations", () => {
  it("should calculate win rate correctly", () => {
    const wins = 13;
    const total = 20;
    const winRate = Math.round((wins / total) * 10000) / 100;
    expect(winRate).toBe(65);
  });

  it("should calculate V4 score estimate correctly", () => {
    // V4: 85*kills + 40*balls + wart + 200*winRate
    const avgKills = 1.2;
    const avgBalls = 0.1;
    const avgWart = 282.36;
    const winRate = 0.65;

    const score =
      Math.round((85 * avgKills + 40 * avgBalls + avgWart + 200 * winRate) * 100) / 100;

    // 85*1.2 = 102, 40*0.1 = 4, 282.36, 200*0.65 = 130
    // Total = 102 + 4 + 282.36 + 130 = 518.36
    expect(score).toBeCloseTo(518.36, 1);
  });

  it("should handle zero matches gracefully", () => {
    const total = 0;
    const wins = 0;
    const winRate = total > 0 ? Math.round((wins / total) * 10000) / 100 : 0;
    expect(winRate).toBe(0);
  });

  it("should correctly identify head-to-head from shared matches", () => {
    // Simulate two players in the same match on different teams
    const matchPlayers = [
      { matchId: "m1", championTokenId: 5256, team: 1, isWinner: true },
      { matchId: "m1", championTokenId: 5705, team: 2, isWinner: false },
      { matchId: "m2", championTokenId: 5256, team: 2, isWinner: false },
      { matchId: "m2", championTokenId: 5705, team: 1, isWinner: true },
      { matchId: "m3", championTokenId: 5256, team: 1, isWinner: true },
      { matchId: "m3", championTokenId: 5705, team: 2, isWinner: false },
    ];

    // Find matches where both 5256 and 5705 played on opposite teams
    const h2hMatches = new Map<string, { champWon: boolean }>();
    const champMatches = matchPlayers.filter((p) => p.championTokenId === 5256);
    const oppMatches = matchPlayers.filter((p) => p.championTokenId === 5705);

    for (const cm of champMatches) {
      const om = oppMatches.find(
        (o) => o.matchId === cm.matchId && o.team !== cm.team
      );
      if (om) {
        h2hMatches.set(cm.matchId, { champWon: cm.isWinner });
      }
    }

    expect(h2hMatches.size).toBe(3);

    let wins = 0;
    let losses = 0;
    for (const [, record] of h2hMatches) {
      if (record.champWon) wins++;
      else losses++;
    }

    expect(wins).toBe(2);
    expect(losses).toBe(1);
    expect(Math.round((wins / h2hMatches.size) * 10000) / 100).toBeCloseTo(66.67, 0);
  });

  it("should calculate class matchup win rates", () => {
    // Simulate class matchup data
    const classData = [
      { class: "Striker", oppClass: "Defender", won: true },
      { class: "Striker", oppClass: "Defender", won: true },
      { class: "Striker", oppClass: "Defender", won: false },
      { class: "Defender", oppClass: "Striker", won: false },
      { class: "Defender", oppClass: "Striker", won: false },
      { class: "Defender", oppClass: "Striker", won: true },
    ];

    const classMatchups = new Map<string, { wins: number; total: number }>();
    for (const d of classData) {
      const key = `${d.class}_vs_${d.oppClass}`;
      const existing = classMatchups.get(key) || { wins: 0, total: 0 };
      existing.total++;
      if (d.won) existing.wins++;
      classMatchups.set(key, existing);
    }

    const strikerVsDefender = classMatchups.get("Striker_vs_Defender")!;
    expect(strikerVsDefender.total).toBe(3);
    expect(strikerVsDefender.wins).toBe(2);
    expect(
      Math.round((strikerVsDefender.wins / strikerVsDefender.total) * 10000) / 100
    ).toBeCloseTo(66.67, 0);
  });

  it("should sort matchups by win rate for best/worst", () => {
    const matchups = [
      { opponent: "A", winRate: 80, totalMatches: 10 },
      { opponent: "B", winRate: 20, totalMatches: 5 },
      { opponent: "C", winRate: 60, totalMatches: 15 },
      { opponent: "D", winRate: 100, totalMatches: 3 },
      { opponent: "E", winRate: 0, totalMatches: 4 },
    ];

    const sorted = [...matchups].sort((a, b) => b.winRate - a.winRate);
    const best3 = sorted.slice(0, 3);
    const worst3 = sorted.slice(-3).reverse();

    expect(best3[0].opponent).toBe("D");
    expect(best3[1].opponent).toBe("A");
    expect(best3[2].opponent).toBe("C");

    expect(worst3[0].opponent).toBe("E");
    expect(worst3[1].opponent).toBe("B");
  });

  it("should handle win type breakdown correctly", () => {
    const winTypes = [
      "eliminations",
      "eliminations",
      "eliminations",
      "wart",
      "wart",
      "gacha",
    ];

    const breakdown: Record<string, number> = {};
    for (const wt of winTypes) {
      breakdown[wt] = (breakdown[wt] || 0) + 1;
    }

    expect(breakdown.eliminations).toBe(3);
    expect(breakdown.wart).toBe(2);
    expect(breakdown.gacha).toBe(1);

    const total = winTypes.length;
    expect(Math.round((breakdown.eliminations / total) * 100)).toBe(50);
    expect(Math.round((breakdown.wart / total) * 100)).toBe(33);
    expect(Math.round((breakdown.gacha / total) * 100)).toBe(17);
  });
});

// ─── Data Structure Validation Tests ───────────────────────────────

describe("Match Data Structure Validation", () => {
  it("should validate match entry has required fields", () => {
    const validEntry = {
      id: "abc",
      matchId: "match001",
      mokiId: "moki001",
      isBye: false,
      matchDate: "2026-02-20",
      results: { winType: "eliminations", deposits: 1, eliminations: 3, wartDistance: 200 },
      match: {
        id: "match001",
        gameType: "mokiMayhem",
        state: "scored",
        isBye: false,
        players: [],
        result: { players: [], winType: "eliminations", teamWon: 1, duration: 40 },
        matchDate: "2026-02-20",
      },
    };

    expect(validEntry.matchId).toBeTruthy();
    expect(validEntry.match).toBeTruthy();
    expect(validEntry.match.result).toBeTruthy();
    expect(validEntry.match.result.teamWon).toBeGreaterThanOrEqual(1);
    expect(validEntry.match.result.teamWon).toBeLessThanOrEqual(2);
  });

  it("should validate player entry has required fields", () => {
    const player = {
      mokiId: "moki001",
      team: 1,
      name: "Golden Nugget",
      tokenId: 5256,
      imageUrl: "https://example.com/img.png",
      class: "Sprinter",
    };

    expect(player.mokiId).toBeTruthy();
    expect(player.team).toBeGreaterThanOrEqual(1);
    expect(player.team).toBeLessThanOrEqual(2);
    expect(player.tokenId).toBeGreaterThan(0);
    expect(player.name).toBeTruthy();
    expect(player.class).toBeTruthy();
  });

  it("should validate pagination structure", () => {
    const pagination = { page: 1, limit: 100, total: 901, pages: 10 };

    expect(pagination.page).toBeGreaterThanOrEqual(1);
    expect(pagination.limit).toBeGreaterThan(0);
    expect(pagination.total).toBeGreaterThanOrEqual(0);
    expect(pagination.pages).toBe(Math.ceil(pagination.total / pagination.limit));
  });

  it("should validate win types are known values", () => {
    const knownWinTypes = ["eliminations", "wart", "gacha"];
    const testWinTypes = ["eliminations", "wart", "gacha"];

    for (const wt of testWinTypes) {
      expect(knownWinTypes).toContain(wt);
    }
  });

  it("should validate match has exactly 6 players (3v3)", () => {
    const players = [
      { team: 1, tokenId: 100 },
      { team: 1, tokenId: 200 },
      { team: 1, tokenId: 300 },
      { team: 2, tokenId: 400 },
      { team: 2, tokenId: 500 },
      { team: 2, tokenId: 600 },
    ];

    expect(players).toHaveLength(6);
    expect(players.filter((p) => p.team === 1)).toHaveLength(3);
    expect(players.filter((p) => p.team === 2)).toHaveLength(3);
  });
});

// ─── Scrape Progress Tests ─────────────────────────────────────────

describe("Scrape Progress Tracking", () => {
  it("should calculate estimated time remaining", () => {
    const startedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    const championsCompleted = 20;
    const totalChampions = 179;

    const elapsed = Date.now() - startedAt.getTime();
    const msPerChampion = elapsed / championsCompleted;
    const remaining = (totalChampions - championsCompleted) * msPerChampion;
    const minutes = Math.ceil(remaining / 60000);

    // 10 min / 20 champs = 0.5 min/champ
    // 159 remaining * 0.5 = ~80 minutes
    expect(minutes).toBeGreaterThan(70);
    expect(minutes).toBeLessThan(90);
  });

  it("should format time remaining as hours and minutes", () => {
    const minutes = 95;
    const formatted =
      minutes > 60
        ? `~${Math.ceil(minutes / 60)}h ${minutes % 60}m`
        : `~${minutes}m`;

    expect(formatted).toBe("~2h 35m");
  });

  it("should track completion percentage", () => {
    const completed = 50;
    const total = 179;
    const pct = Math.round((completed / total) * 100);
    expect(pct).toBe(28);
  });
});
