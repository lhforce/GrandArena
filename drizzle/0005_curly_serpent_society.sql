ALTER TABLE `arbitrage_opportunities` ADD `signalScore` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `arbitrage_opportunities` ADD `signalLabel` varchar(16) DEFAULT 'Cold';--> statement-breakpoint
ALTER TABLE `arbitrage_opportunities` ADD `lastSoldPriceRon` decimal(18,8);--> statement-breakpoint
ALTER TABLE `arbitrage_opportunities` ADD `lastSoldPriceUsd` decimal(12,4);--> statement-breakpoint
ALTER TABLE `arbitrage_opportunities` ADD `lastSoldAt` bigint;--> statement-breakpoint
ALTER TABLE `arbitrage_opportunities` ADD `salesLast24h` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `arbitrage_opportunities` ADD `salesLast7d` int DEFAULT 0;