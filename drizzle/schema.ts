import {
  bigint,
  boolean,
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ─── Users ──────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  walletAddress: varchar("walletAddress", { length: 64 }),
  dailyGemBudget: int("dailyGemBudget").default(5000),
  telegramChatId: varchar("telegramChatId", { length: 64 }),
  telegramAlertsEnabled: boolean("telegramAlertsEnabled").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Contests (scraped from GA API) ─────────────────────────────────
export const contests = mysqlTable("contests", {
  id: int("id").autoincrement().primaryKey(),
  gaContestId: varchar("gaContestId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  contestStatus: varchar("contestStatus", { length: 32 }).notNull(),
  format: varchar("format", { length: 32 }).notNull(), // FIFTY_FIFTY, TOP_20_PCT, FREE_ENTRY
  entryFee: int("entryFee").default(0),
  prizePool: decimal("prizePool", { precision: 12, scale: 2 }).default("0"),
  entries: int("entries").default(0),
  maxEntries: int("maxEntries").default(0),
  maxEntriesPerUser: int("maxEntriesPerUser").default(1),
  scoringMethod: varchar("scoringMethod", { length: 32 }).default("V4"),
  // Rarity restriction info
  rarityRestriction: varchar("rarityRestriction", { length: 64 }), // OPEN, COMMON_ONLY, RARE_ONLY, EPIC_ONLY, LEGENDARY_ONLY, NO_LEGENDARY, BASIC_OR_RARE, ONE_OF_EACH
  isStarCap: boolean("isStarCap").default(false),
  isOneOfEach: boolean("isOneOfEach").default(false),
  // Lineup config stored as JSON
  lineupConfig: json("lineupConfig"),
  matchGroups: json("matchGroups"),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  payoutsProcessed: boolean("payoutsProcessed").default(false),
  lastScrapedAt: timestamp("lastScrapedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_contests_status").on(table.contestStatus),
  index("idx_contests_format").on(table.format),
]);

export type Contest = typeof contests.$inferSelect;
export type InsertContest = typeof contests.$inferInsert;

// ─── Leaderboard Entries (scraped from contest leaderboards) ────────
export const leaderboardEntries = mysqlTable("leaderboard_entries", {
  id: int("id").autoincrement().primaryKey(),
  contestId: int("contestId").notNull(),
  gaEntryId: varchar("gaEntryId", { length: 64 }).notNull(),
  gaUserId: varchar("gaUserId", { length: 64 }),
  username: varchar("username", { length: 128 }),
  rank: int("rank").notNull(),
  score: int("score").notNull(),
  matchesCompleted: int("matchesCompleted").default(0),
  totalMatches: int("totalMatches").default(0),
  estimatedPayout: decimal("estimatedPayout", { precision: 12, scale: 2 }).default("0"),
  isTied: boolean("isTied").default(false),
  // Card images (5 thumbnails from API)
  cardImages: json("cardImages"),
  // AI-identified cards (populated by image recognition)
  identifiedChampions: json("identifiedChampions"), // [{name, championTokenId, rarity}]
  identifiedScheme: varchar("identifiedScheme", { length: 128 }),
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 2 }),
  aiProcessedAt: timestamp("aiProcessedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_lb_contest").on(table.contestId),
  index("idx_lb_rank").on(table.rank),
  uniqueIndex("idx_lb_entry").on(table.contestId, table.gaEntryId),
]);

export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type InsertLeaderboardEntry = typeof leaderboardEntries.$inferInsert;

// ─── Champion Performance Stats (scraped from GATracker) ────────────
export const championStats = mysqlTable("champion_stats", {
  id: int("id").autoincrement().primaryKey(),
  championTokenId: varchar("championTokenId", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  championClass: varchar("championClass", { length: 32 }),
  fur: varchar("fur", { length: 64 }),
  // Performance stats
  winRate: decimal("winRate", { precision: 6, scale: 2 }),
  avgKills: decimal("avgKills", { precision: 8, scale: 2 }),
  avgBalls: decimal("avgBalls", { precision: 8, scale: 2 }),
  avgWartDistance: decimal("avgWartDistance", { precision: 10, scale: 2 }),
  totalKills: int("totalKills").default(0),
  totalBalls: int("totalBalls").default(0),
  totalWartDistance: decimal("totalWartDistance", { precision: 12, scale: 2 }).default("0"),
  totalMatches: int("totalMatches").default(0),
  globalRank: int("globalRank"),
  totalScore: int("totalScore").default(0),
  // Metadata
  statPeriod: varchar("statPeriod", { length: 32 }).default("off-season"), // off-season, pre-season
  lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_champ_token_period").on(table.championTokenId, table.statPeriod),
  index("idx_champ_kills").on(table.avgKills),
  index("idx_champ_balls").on(table.avgBalls),
  index("idx_champ_wart").on(table.avgWartDistance),
  index("idx_champ_winrate").on(table.winRate),
]);

export type ChampionStat = typeof championStats.$inferSelect;
export type InsertChampionStat = typeof championStats.$inferInsert;

// ─── User Card Inventory (from wallet scan) ─────────────────────────
export const userCards = mysqlTable("user_cards", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  walletAddress: varchar("walletAddress", { length: 64 }).notNull(),
  cardType: varchar("cardType", { length: 16 }).notNull(), // MOKI, SCHEME
  tokenId: varchar("tokenId", { length: 32 }).notNull(),
  championTokenId: varchar("championTokenId", { length: 32 }),
  name: varchar("name", { length: 128 }),
  rarity: varchar("rarity", { length: 32 }),
  imageUrl: text("imageUrl"),
  quantity: int("quantity").default(1),
  lastSyncedAt: timestamp("lastSyncedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_uc_user").on(table.userId),
  index("idx_uc_wallet").on(table.walletAddress),
  uniqueIndex("idx_uc_user_token").on(table.userId, table.tokenId),
]);

export type UserCard = typeof userCards.$inferSelect;
export type InsertUserCard = typeof userCards.$inferInsert;

// ─── Card Lockups (tracking card usage across contests) ─────────────
export const cardLockups = mysqlTable("card_lockups", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  contestId: int("contestId").notNull(),
  tokenId: varchar("tokenId", { length: 32 }).notNull(),
  entryNumber: int("entryNumber").default(1),
  lockedAt: timestamp("lockedAt").defaultNow().notNull(),
  unlockedAt: timestamp("unlockedAt"),
}, (table) => [
  index("idx_lockup_user").on(table.userId),
  index("idx_lockup_contest").on(table.contestId),
  uniqueIndex("idx_lockup_unique").on(table.userId, table.contestId, table.tokenId, table.entryNumber),
]);

export type CardLockup = typeof cardLockups.$inferSelect;
export type InsertCardLockup = typeof cardLockups.$inferInsert;

// ─── Saved Lineups ──────────────────────────────────────────────────
export const savedLineups = mysqlTable("saved_lineups", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  contestId: int("contestId"),
  entryNumber: int("entryNumber").default(1),
  // Lineup composition
  champion1TokenId: varchar("champion1TokenId", { length: 32 }),
  champion2TokenId: varchar("champion2TokenId", { length: 32 }),
  champion3TokenId: varchar("champion3TokenId", { length: 32 }),
  champion4TokenId: varchar("champion4TokenId", { length: 32 }),
  schemeTokenId: varchar("schemeTokenId", { length: 32 }),
  // Score prediction
  predictedScore: decimal("predictedScore", { precision: 10, scale: 2 }),
  actualScore: int("actualScore"),
  // Status
  status: varchar("status", { length: 32 }).default("draft"), // draft, submitted, completed
  isWinningLineup: boolean("isWinningLineup").default(false),
  source: varchar("source", { length: 32 }).default("optimizer"), // optimizer, manual, scraped
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_lineup_user").on(table.userId),
  index("idx_lineup_contest").on(table.contestId),
]);

export type SavedLineup = typeof savedLineups.$inferSelect;
export type InsertSavedLineup = typeof savedLineups.$inferInsert;

// ─── Gem Spending Log ───────────────────────────────────────────────
export const gemSpendingLog = mysqlTable("gem_spending_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  contestId: int("contestId"),
  amount: int("amount").notNull(),
  description: varchar("description", { length: 256 }),
  spentAt: timestamp("spentAt").defaultNow().notNull(),
}, (table) => [
  index("idx_gem_user").on(table.userId),
  index("idx_gem_date").on(table.spentAt),
]);

export type GemSpending = typeof gemSpendingLog.$inferSelect;
export type InsertGemSpending = typeof gemSpendingLog.$inferInsert;

// ─── Scrape Jobs (tracking scraper runs) ────────────────────────────
export const scrapeJobs = mysqlTable("scrape_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobType: varchar("jobType", { length: 32 }).notNull(), // contests, leaderboards, gatracker, wallet
  status: varchar("status", { length: 16 }).default("pending"), // pending, running, completed, failed
  contestsProcessed: int("contestsProcessed").default(0),
  entriesProcessed: int("entriesProcessed").default(0),
  aiProcessed: int("aiProcessed").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type InsertScrapeJob = typeof scrapeJobs.$inferInsert;

// ─── Favorite Contests (user-pinned contests) ──────────────────────
export const favoriteContests = mysqlTable("favorite_contests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  contestId: int("contestId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_fav_user_contest").on(table.userId, table.contestId),
  index("idx_fav_user").on(table.userId),
]);

export type FavoriteContest = typeof favoriteContests.$inferSelect;
export type InsertFavoriteContest = typeof favoriteContests.$inferInsert;

// ─── Match History (scraped from GATracker mokiMatches API) ────────
export const matchHistory = mysqlTable("match_history", {
  id: int("id").autoincrement().primaryKey(),
  matchId: varchar("matchId", { length: 64 }).notNull().unique(), // MongoDB ObjectId from GA
  gameType: varchar("gameType", { length: 32 }).default("mokiMayhem"),
  winType: varchar("winType", { length: 32 }), // eliminations, wart, gacha
  teamWon: int("teamWon"), // 1 or 2
  duration: decimal("duration", { precision: 8, scale: 2 }),
  matchDate: varchar("matchDate", { length: 16 }), // YYYY-MM-DD
  isBye: boolean("isBye").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mh_date").on(table.matchDate),
  index("idx_mh_wintype").on(table.winType),
]);

export type MatchHistory = typeof matchHistory.$inferSelect;
export type InsertMatchHistory = typeof matchHistory.$inferInsert;

// ─── Match Player Stats (per-player stats in each match) ──────────
export const matchPlayerStats = mysqlTable("match_player_stats", {
  id: int("id").autoincrement().primaryKey(),
  matchId: varchar("matchId", { length: 64 }).notNull(),
  championTokenId: int("championTokenId").notNull(), // MOKI token ID (e.g., 5256)
  championName: varchar("championName", { length: 128 }),
  championClass: varchar("championClass", { length: 32 }),
  team: int("team").notNull(), // 1 or 2
  kills: int("kills").default(0),
  balls: int("balls").default(0),
  wartDistance: decimal("wartDistance", { precision: 10, scale: 2 }).default("0"),
  isWinner: boolean("isWinner").default(false),
  matchDate: varchar("matchDate", { length: 16 }),
  score: decimal("score", { precision: 10, scale: 2 }).default("0"), // Official formula: kills*80 + balls*50 + wart*0.5625 + win*300
}, (table) => [
  index("idx_mps_match").on(table.matchId),
  index("idx_mps_champion").on(table.championTokenId),
  index("idx_mps_date").on(table.matchDate),
  uniqueIndex("idx_mps_match_champ").on(table.matchId, table.championTokenId),
]);

export type MatchPlayerStat = typeof matchPlayerStats.$inferSelect;
export type InsertMatchPlayerStat = typeof matchPlayerStats.$inferInsert;

// ─── Match Scrape Progress (track which champions have been scraped) ─
export const matchScrapeProgress = mysqlTable("match_scrape_progress", {
  id: int("id").autoincrement().primaryKey(),
  championTokenId: int("championTokenId").notNull().unique(),
  championName: varchar("championName", { length: 128 }),
  totalMatchesAvailable: int("totalMatchesAvailable").default(0),
  matchesScraped: int("matchesScraped").default(0),
  pagesScraped: int("pagesScraped").default(0),
  totalPages: int("totalPages").default(0),
  status: varchar("status", { length: 16 }).default("pending"), // pending, in_progress, completed, failed
  lastScrapedAt: timestamp("lastScrapedAt"),
  newestMatchId: varchar("newestMatchId", { length: 64 }), // most recent matchId seen — used for incremental scraping
  lastIncrementalAt: timestamp("lastIncrementalAt"), // when the last incremental run touched this champion
  incrementalMatchesAdded: int("incrementalMatchesAdded").default(0), // matches added in last incremental run
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MatchScrapeProgress = typeof matchScrapeProgress.$inferSelect;
export type InsertMatchScrapeProgress = typeof matchScrapeProgress.$inferInsert;

// ─── Marketplace Floor Prices (from Ronin Marketplace GraphQL) ──────
export const marketplacePrices = mysqlTable("marketplace_prices", {
  id: int("id").autoincrement().primaryKey(),
  championName: varchar("championName", { length: 128 }).notNull(),
  rarity: varchar("rarity", { length: 32 }).notNull(), // Basic, Rare, Epic, Legendary, Scheme
  floorPriceRon: decimal("floorPriceRon", { precision: 18, scale: 8 }), // Lowest buyable (after outlier removal)
  floorPriceUsd: decimal("floorPriceUsd", { precision: 12, scale: 4 }),
  medianPriceRon: decimal("medianPriceRon", { precision: 18, scale: 8 }), // Median of buyable listings
  buyoutCostRon: decimal("buyoutCostRon", { precision: 18, scale: 8 }), // Sum of all buyable listings
  buyoutCostUsd: decimal("buyoutCostUsd", { precision: 12, scale: 4 }),
  paymentToken: varchar("paymentToken", { length: 10 }).default("RON"), // RON or WETH
  buyableListings: int("buyableListings").default(0), // After outlier removal
  totalListings: int("totalListings").default(0), // Including outliers
  outlierCount: int("outlierCount").default(0), // Listings >3x median
  allPricesJson: text("allPricesJson"), // JSON array of all listing prices with outlier flags
  imageUrl: text("imageUrl"), // Card artwork URL at this rarity (from marketplace listing)
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mp_champion").on(table.championName),
  index("idx_mp_rarity").on(table.rarity),
  index("idx_mp_fetched").on(table.fetchedAt),
  uniqueIndex("idx_mp_champ_rarity").on(table.championName, table.rarity),
]);

export type MarketplacePrice = typeof marketplacePrices.$inferSelect;
export type InsertMarketplacePrice = typeof marketplacePrices.$inferInsert;

// ─── Marketplace Price History (hourly snapshots) ───────────────────
export const marketplacePriceHistory = mysqlTable("marketplace_price_history", {
  id: int("id").autoincrement().primaryKey(),
  championName: varchar("championName", { length: 128 }).notNull(),
  rarity: varchar("rarity", { length: 32 }).notNull(),
  floorPriceRon: decimal("floorPriceRon", { precision: 18, scale: 8 }),
  floorPriceUsd: decimal("floorPriceUsd", { precision: 12, scale: 4 }),
  snapshotAt: timestamp("snapshotAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mph_champion").on(table.championName, table.rarity),
  index("idx_mph_snapshot").on(table.snapshotAt),
]);

export type MarketplacePriceHistory = typeof marketplacePriceHistory.$inferSelect;
export type InsertMarketplacePriceHistory = typeof marketplacePriceHistory.$inferInsert;

// ─── Arbitrage Opportunities (profit-focused: craft low → sell high) ─
export const arbitrageOpportunities = mysqlTable("arbitrage_opportunities", {
  id: int("id").autoincrement().primaryKey(),
  championName: varchar("championName", { length: 128 }).notNull(),
  targetRarity: varchar("targetRarity", { length: 32 }).notNull(), // Rare, Epic, Legendary
  // Craft-up cost (buy lower rarity cards and craft)
  sourceRarity: varchar("sourceRarity", { length: 32 }), // Basic, Rare, or Epic
  sourceFloorUsd: decimal("sourceFloorUsd", { precision: 12, scale: 4 }), // Floor price of source rarity
  cardsNeeded: int("cardsNeeded"), // 3 (Basic→Rare), 10 (Rare→Epic), 8 (Epic→Legendary)
  totalCraftCostUsd: decimal("totalCraftCostUsd", { precision: 12, scale: 4 }), // cardsNeeded × sourceFloorUsd
  // Selling price at target rarity
  sellPriceUsd: decimal("sellPriceUsd", { precision: 12, scale: 4 }), // Floor/avg selling price at target rarity
  // Profit calculation
  profitUsd: decimal("profitUsd", { precision: 12, scale: 4 }), // sellPrice - craftCost
  profitPercent: decimal("profitPercent", { precision: 8, scale: 2 }), // (profit / craftCost) × 100
  // Hot card signals
  hotSignal: varchar("hotSignal", { length: 256 }), // e.g. "Price acceleration +30%, Volume up 200%"
  hotScore: int("hotScore").default(0), // Composite score: higher = hotter card
  // Signal Score (0-100) — composite sell-side liquidity + profit score
  signalScore: int("signalScore").default(0),
  signalLabel: varchar("signalLabel", { length: 16 }).default("Cold"), // Fire, Hot, Warm, Cold
  // Last sold data at target rarity
  lastSoldPriceRon: decimal("lastSoldPriceRon", { precision: 18, scale: 8 }),
  lastSoldPriceUsd: decimal("lastSoldPriceUsd", { precision: 12, scale: 4 }),
  lastSoldAt: bigint("lastSoldAt", { mode: "number" }), // Unix timestamp (seconds)
  salesLast24h: int("salesLast24h").default(0),
  salesLast7d: int("salesLast7d").default(0),
  // Listing details
  buyableListings: int("buyableListings").default(0), // Listings after outlier removal
  totalListings: int("totalListings").default(0), // All listings including outliers
  calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_arb_champion").on(table.championName),
  index("idx_arb_target").on(table.targetRarity),
  index("idx_arb_profit").on(table.profitPercent),
  index("idx_arb_hot").on(table.hotScore),
  uniqueIndex("idx_arb_champ_rarity").on(table.championName, table.targetRarity),
]);

export type ArbitrageOpportunity = typeof arbitrageOpportunities.$inferSelect;
export type InsertArbitrageOpportunity = typeof arbitrageOpportunities.$inferInsert;

// ─── Exchange Rates Cache (RON/WETH to USD) ─────────────────────────
export const exchangeRates = mysqlTable("exchange_rates", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 10 }).notNull().unique(), // RON, WETH
  usdRate: decimal("usdRate", { precision: 18, scale: 8 }).notNull(),
  lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().notNull(),
});

export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type InsertExchangeRate = typeof exchangeRates.$inferInsert;
