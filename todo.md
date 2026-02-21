# Grand Arena Scheme Card Tool - TODO

## Core Features
- [x] Screen 1: Wallet address input with validation
- [x] Screen 2: Scheme card gallery with artwork from NFT metadata
- [x] Screen 3: Champion card gallery for selected scheme
- [x] Champion card artwork from Ronin Marketplace NFT metadata
- [x] Ownership filter (All / Owned / Not Owned)
- [x] Marketplace floor prices via tRPC backend proxy (bypasses CORS)
- [x] Rarity filter (All / Basic / Rare / Epic / Legendary)
- [x] Champion search by name
- [x] Sort by rarity / name / price
- [x] Browse without wallet option

## Data
- [x] 35 Scheme cards with artwork and descriptions
- [x] 180 Champions with traits, rarity, and card images
- [x] Scheme-to-champion mappings from gatracker.xyz
- [x] Game data JSON served from public folder

## Backend Proxy
- [x] tRPC proxy for wallet ownership check (getWalletChampions)
- [x] tRPC proxy for batch floor prices (getBatchFloorPrices)
- [x] CORS bypass via server-side GraphQL calls to Ronin Marketplace

## UI/UX
- [x] Dark gaming theme (navy/gold/teal)
- [x] Rajdhani + DM Sans fonts
- [x] Rarity-colored card borders
- [x] Owned badge on champion cards
- [x] Marketplace link overlay on hover
- [x] 1/1 badge for special cards
- [x] Loading states and progress indicators
- [x] Responsive grid layout

## Tests
- [x] Auth logout test (1 test)
- [x] Ronin proxy tests (9 tests)
- [x] Contest router tests (9 tests)

## Bug Fixes
- [x] Fix Whale Watching scheme card showing only 1 champion instead of all qualifying ones (confirmed working - 27 champions display correctly)

## Whale Watching Multi-Rarity Update
- [x] Fetch all rarity variants (Basic/Rare/Epic/Legendary/FA) for all 27 Whale Watching champions from Ronin Marketplace
- [x] Update game-data.json to store per-rarity card images for 1-of-1 champions
- [x] Add FA tab to rarity filter (only visible for Whale Watching scheme)
- [x] Update ChampionsScreen rarity filter logic: for Whale Watching, show all 27 champions under each tab with rarity-specific artwork
- [x] Pull FA card images from marketplace NFT metadata

## Bug Fixes Round 2
- [x] Fix 8 Whale Watching champions (Nomad, Vagabond, Mozy, Gruyere, KingofRatz, Mahoshojo, Butthole Moki, Dracumoki) showing FA art on Legendary tab instead of pink Legendary card
- [x] Fix marketplace card links to go to the correct card listing page (not just the collection)

## Bug Fixes Round 3
- [ ] Fix Dracumoki and Mozy showing Series art instead of pink Legendary card on Legendary tab

## Phase 1 — Contest Data Collection + Winning Lineup Database
- [x] Design database schema (contests, leaderboard_entries, champions, scheme_cards, user_cards, lineups, card_lockups, performance_stats)
- [x] Push database migrations
- [x] Build contest scraper (fetch all COMPLETED contests from GA API)
- [x] Build leaderboard scraper (paginate through all entries per contest)
- [x] Build AI image recognition pipeline (identify champions/schemes from thumbnail URLs)
- [x] Store winning lineups categorized by contest type/rules
- [x] Build tRPC procedures for contest data access
- [x] Build contest data admin/dashboard UI

## Phase 2 — Interactive Contest Optimizer Web App
- [ ] Build wallet inventory fetcher (Ronin Marketplace API for mokis + schemes + quantities)
- [ ] Pull LIVE, OPEN, and DRAFT contests from GA API
- [ ] Contest browser UI with full details (rules, restrictions, prize pool, entry fee, spots, max entries)
- [ ] Contest picker + entry count selector (up to 5 entries)
- [ ] Lineup optimizer engine (build optimal lineups from owned cards)
- [ ] Auto-select best scheme card per lineup
- [ ] Card lockup tracker across all entries and contests
- [ ] 5,000 gem daily budget tracker
- [ ] Pre-build lineups for upcoming DRAFT contests
- [ ] Purchase recommendations (missing cards that would improve placement)
- [ ] Hybrid mode (owned cards first, then purchase recommendations)

## Phase 3 — GATracker Performance Data Integration
- [ ] Scrape champion performance data from GATracker Meta tab
- [ ] Hourly refresh of performance data
- [ ] Rank champions by scheme-relevant stats (kills, balls, wart, combo, trait+winrate)
- [ ] Show raw performance numbers on each card in UI

## Phase 4 — Telegram Alerts
- [ ] Alert when new contests go live
- [ ] Alert when contests are filling up fast (spots running low)
- [ ] Configure Telegram bot integration

## Phase 5 — Multi-User Architecture
- [ ] User settings layer (wallet address, personal config)
- [ ] Shared winning lineup database serving multiple users
- [ ] Subscription tier preparation (USDC on Ronin chain)
- [ ] Role-based access control for future tiers
