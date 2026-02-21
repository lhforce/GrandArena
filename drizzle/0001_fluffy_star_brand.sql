CREATE TABLE `card_lockups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contestId` int NOT NULL,
	`tokenId` varchar(32) NOT NULL,
	`entryNumber` int DEFAULT 1,
	`lockedAt` timestamp NOT NULL DEFAULT (now()),
	`unlockedAt` timestamp,
	CONSTRAINT `card_lockups_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_lockup_unique` UNIQUE(`userId`,`contestId`,`tokenId`,`entryNumber`)
);
--> statement-breakpoint
CREATE TABLE `champion_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`championTokenId` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`championClass` varchar(32),
	`fur` varchar(64),
	`winRate` decimal(6,2),
	`avgKills` decimal(8,2),
	`avgBalls` decimal(8,2),
	`avgWartDistance` decimal(10,2),
	`totalKills` int DEFAULT 0,
	`totalBalls` int DEFAULT 0,
	`totalWartDistance` decimal(12,2) DEFAULT '0',
	`totalMatches` int DEFAULT 0,
	`globalRank` int,
	`totalScore` int DEFAULT 0,
	`statPeriod` varchar(32) DEFAULT 'off-season',
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `champion_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_champ_token_period` UNIQUE(`championTokenId`,`statPeriod`)
);
--> statement-breakpoint
CREATE TABLE `contests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gaContestId` varchar(64) NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`contestStatus` varchar(32) NOT NULL,
	`format` varchar(32) NOT NULL,
	`entryFee` int DEFAULT 0,
	`prizePool` decimal(12,2) DEFAULT '0',
	`entries` int DEFAULT 0,
	`maxEntries` int DEFAULT 0,
	`maxEntriesPerUser` int DEFAULT 1,
	`scoringMethod` varchar(32) DEFAULT 'V4',
	`rarityRestriction` varchar(64),
	`isStarCap` boolean DEFAULT false,
	`isOneOfEach` boolean DEFAULT false,
	`lineupConfig` json,
	`matchGroups` json,
	`startDate` timestamp,
	`endDate` timestamp,
	`payoutsProcessed` boolean DEFAULT false,
	`lastScrapedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contests_id` PRIMARY KEY(`id`),
	CONSTRAINT `contests_gaContestId_unique` UNIQUE(`gaContestId`)
);
--> statement-breakpoint
CREATE TABLE `gem_spending_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contestId` int,
	`amount` int NOT NULL,
	`description` varchar(256),
	`spentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gem_spending_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leaderboard_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contestId` int NOT NULL,
	`gaEntryId` varchar(64) NOT NULL,
	`gaUserId` varchar(64),
	`username` varchar(128),
	`rank` int NOT NULL,
	`score` int NOT NULL,
	`matchesCompleted` int DEFAULT 0,
	`totalMatches` int DEFAULT 0,
	`estimatedPayout` decimal(12,2) DEFAULT '0',
	`isTied` boolean DEFAULT false,
	`cardImages` json,
	`identifiedChampions` json,
	`identifiedScheme` varchar(128),
	`aiConfidence` decimal(5,2),
	`aiProcessedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leaderboard_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_lb_entry` UNIQUE(`contestId`,`gaEntryId`)
);
--> statement-breakpoint
CREATE TABLE `saved_lineups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`contestId` int,
	`entryNumber` int DEFAULT 1,
	`champion1TokenId` varchar(32),
	`champion2TokenId` varchar(32),
	`champion3TokenId` varchar(32),
	`champion4TokenId` varchar(32),
	`schemeTokenId` varchar(32),
	`predictedScore` decimal(10,2),
	`actualScore` int,
	`status` varchar(32) DEFAULT 'draft',
	`isWinningLineup` boolean DEFAULT false,
	`source` varchar(32) DEFAULT 'optimizer',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `saved_lineups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scrape_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobType` varchar(32) NOT NULL,
	`status` varchar(16) DEFAULT 'pending',
	`contestsProcessed` int DEFAULT 0,
	`entriesProcessed` int DEFAULT 0,
	`aiProcessed` int DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scrape_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`walletAddress` varchar(64) NOT NULL,
	`cardType` varchar(16) NOT NULL,
	`tokenId` varchar(32) NOT NULL,
	`championTokenId` varchar(32),
	`name` varchar(128),
	`rarity` varchar(32),
	`quantity` int DEFAULT 1,
	`lastSyncedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_uc_user_token` UNIQUE(`userId`,`tokenId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `walletAddress` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `dailyGemBudget` int DEFAULT 5000;--> statement-breakpoint
ALTER TABLE `users` ADD `telegramChatId` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `telegramAlertsEnabled` boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX `idx_lockup_user` ON `card_lockups` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_lockup_contest` ON `card_lockups` (`contestId`);--> statement-breakpoint
CREATE INDEX `idx_champ_kills` ON `champion_stats` (`avgKills`);--> statement-breakpoint
CREATE INDEX `idx_champ_balls` ON `champion_stats` (`avgBalls`);--> statement-breakpoint
CREATE INDEX `idx_champ_wart` ON `champion_stats` (`avgWartDistance`);--> statement-breakpoint
CREATE INDEX `idx_champ_winrate` ON `champion_stats` (`winRate`);--> statement-breakpoint
CREATE INDEX `idx_contests_status` ON `contests` (`contestStatus`);--> statement-breakpoint
CREATE INDEX `idx_contests_format` ON `contests` (`format`);--> statement-breakpoint
CREATE INDEX `idx_gem_user` ON `gem_spending_log` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_gem_date` ON `gem_spending_log` (`spentAt`);--> statement-breakpoint
CREATE INDEX `idx_lb_contest` ON `leaderboard_entries` (`contestId`);--> statement-breakpoint
CREATE INDEX `idx_lb_rank` ON `leaderboard_entries` (`rank`);--> statement-breakpoint
CREATE INDEX `idx_lineup_user` ON `saved_lineups` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_lineup_contest` ON `saved_lineups` (`contestId`);--> statement-breakpoint
CREATE INDEX `idx_uc_user` ON `user_cards` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_uc_wallet` ON `user_cards` (`walletAddress`);