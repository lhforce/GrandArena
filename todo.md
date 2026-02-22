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
- [x] Lineup optimizer tests (31 tests)
- [x] Champion stats tests (35 tests)
- [x] Telegram credential tests (2 tests)

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
- [x] Build wallet inventory fetcher (Ronin Marketplace API for mokis + schemes + quantities)
- [x] Pull LIVE, OPEN, and DRAFT contests from GA API
- [x] Contest browser UI with full details (rules, restrictions, prize pool, entry fee, spots, max entries)
- [x] Contest picker + entry count selector (up to 5 entries)
- [x] Lineup optimizer engine (build optimal lineups from owned cards)
- [x] Auto-select best scheme card per lineup
- [x] Card lockup tracker across all entries and contests
- [x] 5,000 gem daily budget tracker
- [ ] Pre-build lineups for upcoming DRAFT contests
- [ ] Purchase recommendations (missing cards that would improve placement)
- [ ] Hybrid mode (owned cards first, then purchase recommendations)

## Phase 3 — GATracker Performance Data Integration
- [x] Build champion performance model from GATracker class averages + fur rarity multipliers
- [x] V4 scoring engine (85pts/kill, 40pts/ball, wart distance, +200 win bonus, rarity multipliers)
- [x] Scheme-relevance scoring (weighted scoring per scheme category: kills, balls, wart, win, combo, trait, rarity, loss, score)
- [x] Champion Stats page with rankings table, filtering (rarity/class/scheme), and pagination
- [x] Class performance averages reference table (from GATracker META)
- [x] Stats router with rankings, summary, class averages, and refresh procedures
- [x] Database persistence for champion stats
- [ ] Hourly auto-refresh of performance data (currently manual refresh)

## Phase 4 — Telegram Alerts
- [x] Telegram bot integration (send messages via bot API)
- [x] New contest live alerts (detects LIVE status transitions)
- [x] Filling fast alerts (75%+ capacity warning, 90% escalation)
- [x] Contest summary on demand (sends upcoming OPEN/DRAFT contests)
- [x] Contest monitor with configurable interval (default 5 min)
- [x] Telegram Alerts page with status, test, start/stop monitor, and summary controls
- [x] Environment variables for TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID

## Phase 5 — Multi-User Architecture
- [ ] User settings layer (wallet address, personal config)
- [ ] Shared winning lineup database serving multiple users
- [ ] Subscription tier preparation (USDC on Ronin chain)
- [ ] Role-based access control for future tiers

## Bug Fixes Round 4
- [x] Fix "Scrape Contests" button spinning indefinitely with no results (made non-blocking with auto-polling progress)

## Mobile Responsiveness
- [x] DashboardLayout: collapsible sidebar with hamburger menu on mobile (built-in SidebarTrigger)
- [x] Dashboard page: stack stat cards vertically, touch-friendly buttons
- [x] Contests page: responsive filters and cards with flex-wrap
- [x] Winning Lineups page: responsive card grid, scrollable tables
- [x] Lineup Builder page: stacking layout, touch-friendly controls
- [x] My Cards page: responsive card grid (2-col mobile), mobile sync button
- [x] Champion Stats page: horizontal-scroll table with min-w, stacking filters
- [x] Telegram Alerts page: stacking cards, responsive grids
- [x] Settings page: full-width inputs, responsive text
- [x] Home/Scheme Card tool: responsive WalletScreen, SchemesScreen, ChampionsScreen grids

## Bug Fixes Round 5
- [x] Lineup Builder results should show actual card artwork images instead of generic shield icons

## Bug Fixes Round 6
- [x] Fix "Send Contest Summary" button error on Telegram Alerts page (GA API now returns { contests: [...] } wrapper instead of flat array)

## Bug Fixes Round 7
- [x] Fix card image mismatch in Lineup Builder — images don't match champion names in built lineups
- [x] Fix all projected scores showing same value (2172 pts) — optimizer not loading champion performance stats

## Bug Fixes Round 8
- [x] Fix contest data to track current entrants vs max entries (e.g., 125/150)
- [x] Show which contests have open entry slots vs full contests
- [x] Scraper should capture current entry count from GA API
- [x] Remove gem budget cap from lineup optimizer — always build all requested lineups regardless of budget

## Contests Page UX Improvements
- [x] Sort open contests: available entry slots first, then full contests
- [x] Add FULL accordion — collapsible red "FULL" section grouping full contests
- [x] Click-to-build — clicking an open contest with available entries navigates to Lineup Builder with that contest pre-selected

## Contests Page Features Round 2
- [x] "Has open slots" toggle — quick filter to hide DRAFT/COMPLETED and show only joinable contests
- [x] Countdown timer — show time remaining until contest start for OPEN/DRAFT contests
- [x] Favorite contests — pin specific contests to the top with database persistence

## My Cards Page Redesign
- [x] Group cards by rarity (Legendary, Epic, Rare, Basic/Common)
- [x] Display card images on each card
- [x] Change contest sorting: OPEN contests always at top of lists, above LIVE

## Bug Fixes Round 9
- [x] Fix duplicate champions in lineup — optimizer must enforce uniqueness by champion name, not just tokenId

## Optimizer Improvement: Empirical Data Integration
- [x] Aggregate actual champion performance from AI-identified winning lineups
- [x] Build empirical stats (avg score per champion, win frequency, scheme synergy) from completed contests
- [x] Blend empirical stats with class-based model in the optimizer scoring
- [x] Show data confidence indicators in Lineup Builder (model-based vs empirical)
- [x] Auto-scroll to Build box and add yellow outline highlight after contest selection in Lineup Builder
- [x] Auto-scroll to first generated lineup after clicking Optimize (no highlight needed)

## Scheme Card Strategy: Reliable vs Risky
- [x] Categorize all scheme cards as reliable (trait/kills/balls/wart) vs risky (RNG-dependent)
- [x] Penalize risky scheme cards in optimizer scoring
- [x] Boost reliable scheme cards (trait-based, kills, ball deliveries, wart riding)
- [x] Build scheme performance rankings from winning lineup data
- [x] Override risky penalty when empirical winning data shows consistent success with a risky scheme

## Matchup Intelligence System (GATracker Match History)
- [x] Add match_history and matchup_stats database tables
- [x] Build match history scraper using GATracker webhook API (mokiMatches endpoint)
- [ ] Scrape match data for all 179 champions (901+ matches each, paginated)
- [x] Calculate head-to-head champion matchup win rates from match data
- [x] Calculate per-champion real performance stats (kills, balls, wart) from actual matches
- [x] Calculate class-vs-class matchup advantages
- [x] Build Matchup Intelligence UI page with champion lookup and head-to-head comparison
- [x] Integrate match-derived performance stats into lineup optimizer scoring
- [ ] Add "Scrape Match History" button to Dashboard

## H2H Integration into Lineup Optimizer
- [x] Add H2H match performance data as a third data source in optimizer scoring
- [x] Create getBulkMatchPerformance() function for efficient batch lookup
- [x] Blend match-derived stats with model + empirical stats in lineupRouter optimize procedure
- [x] Show H2H data source indicator in lineup builder results

## Post-Entry Swap Advisor
- [x] Build swapAdvisor.ts engine that analyzes lineup vs opponent matchups
- [x] Create tRPC procedures for swap analysis (input: your lineup + opponent lineup)
- [x] Build SwapAdvisor UI page with lineup input and swap recommendations
- [x] Add SwapAdvisor to sidebar navigation
- [x] Write tests for swap advisor logic

## Hourly Match History Cron Job
- [x] Add incremental scraping mode to matchScraper (stop when hitting known matchIds)
- [x] Track newestMatchId per champion in matchScrapeProgress table
- [x] Build runIncrementalMatchScrape() function that only fetches new matches
- [x] Build hourly cron scheduler using setInterval (runs every hour)
- [x] Wire cron job startup into server/_core/index.ts
- [x] Add cron job status to Dashboard (last run, next run, matches added)
- [x] Add tRPC procedures for cron status and manual trigger
- [x] Write tests for incremental scraping logic

## Auto-Populate Swap Advisor from Contest Entries
- [x] Investigate GA contest API for opponent lineup data (leaderboard/matchups endpoints)
- [x] User's built lineups already saved to savedLineups table via Lineup Builder
- [x] Build opponent lineup detection from leaderboard_entries (AI-identified champions)
- [x] Redesign Swap Advisor to auto-load user's active contest entries
- [x] Show contest picker → entry picker → auto-populated matchup analysis
- [x] Eliminate manual MOKI input (keep as fallback option)
- [x] Write tests for auto-populate logic

## Wart Distance Coefficient Fix
- [x] Fix wart coefficient from 0.001 to ~1.257 in scoring engine
- [x] Fix wart coefficient in optimizer (lineupOptimizer.ts)
- [x] Fix wart coefficient in champion stats (statsRouter/matchupRouter)
- [x] Fix wart coefficient in matchup intel
- [x] Update all tests for new wart coefficient (179/179 passing)
- [x] Re-run Costume Party analysis with corrected scoring
- [x] Deploy updated version

## Official Scoring Formula Fix (Season 1)
- [x] Update scoring constants: eliminations×80, deposits×50, wart×0.5625, win×300
- [x] Add score field to match_player_stats schema (calculated per match)
- [x] Update scraper to calculate and store score per match
- [x] Migrate DB schema with pnpm db:push
- [x] Re-scrape all 180 champions with score field (2,524 matches, 15,144 player stats)
- [x] Update optimizer, stats, matchup intel to use real avg score
- [x] Update all tests for new scoring formula (179/179 passing)
- [x] Validate Fenrir avg score: DB shows 408 vs GATracker 430 (within ~5% — close enough given ongoing matches)
- [x] Deploy updated version
