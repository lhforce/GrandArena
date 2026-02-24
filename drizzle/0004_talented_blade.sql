CREATE TABLE `arbitrage_opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`championName` varchar(128) NOT NULL,
	`targetRarity` varchar(32) NOT NULL,
	`sourceRarity` varchar(32),
	`sourceFloorUsd` decimal(12,4),
	`cardsNeeded` int,
	`totalCraftCostUsd` decimal(12,4),
	`sellPriceUsd` decimal(12,4),
	`profitUsd` decimal(12,4),
	`profitPercent` decimal(8,2),
	`hotSignal` varchar(256),
	`hotScore` int DEFAULT 0,
	`buyableListings` int DEFAULT 0,
	`totalListings` int DEFAULT 0,
	`calculatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `arbitrage_opportunities_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_arb_champ_rarity` UNIQUE(`championName`,`targetRarity`)
);
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(10) NOT NULL,
	`usdRate` decimal(18,8) NOT NULL,
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `exchange_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `exchange_rates_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `marketplace_price_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`championName` varchar(128) NOT NULL,
	`rarity` varchar(32) NOT NULL,
	`floorPriceRon` decimal(18,8),
	`floorPriceUsd` decimal(12,4),
	`snapshotAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplace_price_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketplace_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`championName` varchar(128) NOT NULL,
	`rarity` varchar(32) NOT NULL,
	`floorPriceRon` decimal(18,8),
	`floorPriceUsd` decimal(12,4),
	`medianPriceRon` decimal(18,8),
	`buyoutCostRon` decimal(18,8),
	`buyoutCostUsd` decimal(12,4),
	`paymentToken` varchar(10) DEFAULT 'RON',
	`buyableListings` int DEFAULT 0,
	`totalListings` int DEFAULT 0,
	`outlierCount` int DEFAULT 0,
	`allPricesJson` text,
	`fetchedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplace_prices_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_mp_champ_rarity` UNIQUE(`championName`,`rarity`)
);
--> statement-breakpoint
CREATE INDEX `idx_arb_champion` ON `arbitrage_opportunities` (`championName`);--> statement-breakpoint
CREATE INDEX `idx_arb_target` ON `arbitrage_opportunities` (`targetRarity`);--> statement-breakpoint
CREATE INDEX `idx_arb_profit` ON `arbitrage_opportunities` (`profitPercent`);--> statement-breakpoint
CREATE INDEX `idx_arb_hot` ON `arbitrage_opportunities` (`hotScore`);--> statement-breakpoint
CREATE INDEX `idx_mph_champion` ON `marketplace_price_history` (`championName`,`rarity`);--> statement-breakpoint
CREATE INDEX `idx_mph_snapshot` ON `marketplace_price_history` (`snapshotAt`);--> statement-breakpoint
CREATE INDEX `idx_mp_champion` ON `marketplace_prices` (`championName`);--> statement-breakpoint
CREATE INDEX `idx_mp_rarity` ON `marketplace_prices` (`rarity`);--> statement-breakpoint
CREATE INDEX `idx_mp_fetched` ON `marketplace_prices` (`fetchedAt`);