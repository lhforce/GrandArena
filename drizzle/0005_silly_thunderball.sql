ALTER TABLE `match_scrape_progress` ADD `newestMatchId` varchar(64);--> statement-breakpoint
ALTER TABLE `match_scrape_progress` ADD `lastIncrementalAt` timestamp;--> statement-breakpoint
ALTER TABLE `match_scrape_progress` ADD `incrementalMatchesAdded` int DEFAULT 0;