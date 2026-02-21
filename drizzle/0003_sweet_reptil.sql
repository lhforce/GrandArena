CREATE TABLE `favorite_contests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contestId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `favorite_contests_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_fav_user_contest` UNIQUE(`userId`,`contestId`)
);
--> statement-breakpoint
CREATE INDEX `idx_fav_user` ON `favorite_contests` (`userId`);