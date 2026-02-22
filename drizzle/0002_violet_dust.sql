CREATE TABLE `favorite_contests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contestId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `favorite_contests_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_fav_user_contest` UNIQUE(`userId`,`contestId`)
);
--> statement-breakpoint
CREATE TABLE `match_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(64) NOT NULL,
	`gameType` varchar(32) DEFAULT 'mokiMayhem',
	`winType` varchar(32),
	`teamWon` int,
	`duration` decimal(8,2),
	`matchDate` varchar(16),
	`isBye` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_history_matchId_unique` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE TABLE `match_player_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(64) NOT NULL,
	`championTokenId` int NOT NULL,
	`championName` varchar(128),
	`championClass` varchar(32),
	`team` int NOT NULL,
	`kills` int DEFAULT 0,
	`balls` int DEFAULT 0,
	`wartDistance` decimal(10,2) DEFAULT '0',
	`isWinner` boolean DEFAULT false,
	`matchDate` varchar(16),
	CONSTRAINT `match_player_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_mps_match_champ` UNIQUE(`matchId`,`championTokenId`)
);
--> statement-breakpoint
CREATE TABLE `match_scrape_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`championTokenId` int NOT NULL,
	`championName` varchar(128),
	`totalMatchesAvailable` int DEFAULT 0,
	`matchesScraped` int DEFAULT 0,
	`pagesScraped` int DEFAULT 0,
	`totalPages` int DEFAULT 0,
	`status` varchar(16) DEFAULT 'pending',
	`lastScrapedAt` timestamp,
	`newestMatchId` varchar(64),
	`lastIncrementalAt` timestamp,
	`incrementalMatchesAdded` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_scrape_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_scrape_progress_championTokenId_unique` UNIQUE(`championTokenId`)
);
--> statement-breakpoint
ALTER TABLE `user_cards` ADD `imageUrl` text;--> statement-breakpoint
CREATE INDEX `idx_fav_user` ON `favorite_contests` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_mh_date` ON `match_history` (`matchDate`);--> statement-breakpoint
CREATE INDEX `idx_mh_wintype` ON `match_history` (`winType`);--> statement-breakpoint
CREATE INDEX `idx_mps_match` ON `match_player_stats` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_mps_champion` ON `match_player_stats` (`championTokenId`);--> statement-breakpoint
CREATE INDEX `idx_mps_date` ON `match_player_stats` (`matchDate`);