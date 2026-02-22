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

## Speed Up Match History Scraper
- [x] Add parallel champion fetching (5 concurrent champions instead of serial)
- [x] Reduce inter-page delay from 800ms to 200ms
- [x] Reduce inter-champion delay from 500ms to 100ms
- [x] Batch database inserts instead of row-by-row
- [x] Add progress speed indicator (champions/min, matches/sec)

## Swap Advisor Redesign (4×5 Format)
- [x] Redesign swap advisor engine: each of 4 MOKI slots faces 5 different opponents (20 total matches)
- [x] Update data model: SlotMatchup = { slotIndex, yourMoki, opponents: [5 opponents] }
- [x] Optimize swap scoring across all 5 opponents per slot (not just 1)
- [x] Redesign UI: show 4 MOKI slots with 5 opponent cards each
- [x] Allow inputting 5 opponents per slot (manual mode)
- [x] Auto-populate from contest data if available
- [x] Swap recommendation: "For slot X, swap A for B — improves avg win rate across 5 opponents by Y%"
- [x] Write tests for new 4×5 swap logic

## Bug Fixes Round 10
- [x] Fix duplicate AI identification jobs running concurrently — add concurrency guard
- [x] Fix H2H match scraper stopping after 10-15 seconds instead of completing all 179 champions

## Auto-Detect Opponents from GA Fantasy API
- [ ] Investigate GA Fantasy contest API for matchup/opponent data (which MOKIs face which)
- [ ] Build opponent auto-detection from GA contest API (fetch round matchups)
- [ ] Update Swap Advisor to auto-populate all 20 matchups (4 MOKIs × 5 opponents) from API
- [ ] Eliminate need for manual opponent entry entirely

## Bookmarklet Matchup Extraction
- [ ] Analyze GA Fantasy contest entry page DOM structure for matchup data
- [ ] Build server-side API endpoint to receive bookmarklet matchup data
- [ ] Create bookmarklet JS that extracts 20 matchups (4 MOKIs × 5 opponents) from GA Fantasy DOM
- [ ] Add Bookmarklet Setup section to Swap Advisor UI with drag-to-install instructions
- [ ] Auto-populate Swap Advisor when bookmarklet sends matchup data
- [ ] Write tests for bookmarklet API endpoint and matchup processing

## Scheme-Aware Swap Advisor
- [ ] Analyze Scheme card trait requirements (class, element, etc.) for swap compatibility
- [ ] Add Scheme card context to swap advisor engine (which Scheme is active for the lineup)
- [ ] Check if replacement MOKI satisfies active Scheme card trait requirements
- [ ] Flag swaps that break Scheme card abilities with clear warnings
- [ ] Show tradeoff: "Better matchup but loses Scheme bonus" vs "Keeps Scheme bonus and improves matchup"
- [ ] Prefer swaps that maintain Scheme compatibility; warn clearly about ones that don't
- [ ] Update Swap Advisor UI to display Scheme compatibility status on each recommendation
- [ ] Write tests for Scheme-aware swap logic

## Contest Prep Workflow (Proactive Opponent Scouting)
- [ ] Build Contest Prep engine: analyze opponents per slot, rank user's MOKIs by H2H advantage
- [ ] Optimal MOKI selection: for each of 4 slots, find best MOKI from user's collection vs that slot's 5 opponents
- [ ] Scheme card matching: find best Scheme card whose trait requirements match the selected 4 MOKIs
- [ ] Build server API endpoints for Contest Prep analysis
- [ ] Build Contest Prep UI page with guided flow: input opponents → see best MOKIs → see best Scheme
- [ ] Support paste/manual input of opponent matchups (4 slots × 5 opponents)
- [ ] Build bookmarklet JS to extract matchups from GA Fantasy contest entry page DOM
- [ ] Add bookmarklet setup instructions to Contest Prep page
- [ ] Write tests for Contest Prep engine and endpoints

## Optimizer Fix: Co-optimize Scheme + MOKI Selection
- [x] Redesign optimizer to evaluate all Schemes first, pick best 4 MOKIs per Scheme, select highest combo
- [x] Fix scoreChampion to properly weight Scheme-specific actions (kills for kill schemes, balls for ball schemes)
- [x] Update tests for new co-optimization logic (6 new tests: kill-heavy, ball-heavy, multi-scheme, combo, trait, MahoShojo bug fix)
- [x] Verify end-to-end with TS checks passing (197 tests, 0 TS errors)

## Bug Fixes Round 11
- [x] Fix duplicate AI identification jobs running concurrently — stale DB records from server restart; added startup cleanup in cardIdentifier.ts + _core/index.ts
- [x] Validate Cage Match optimizer picks against GATracker top killers — confirmed our data matches; new optimizer should pick Mokington/Dheu/Mokuna/Low Tier Phenom for Epic Cage Match

## Bug Fixes Round 12
- [x] Fix optimizer still picking MahoShojo/Peeltergeist for Cage Match — root cause: empirical blending inflated stats (MahoShojo kills 0→4.33), fixed by making match history (50+ matches) the primary data source with 80-95% weight, bypassing corrupted empirical estimates

## Scheme Selection Bias Fix
- [ ] Analyze winning lineup data to understand trait vs performance Scheme usage patterns
- [ ] Fix Scheme scoring to properly value trait-based Schemes based on empirical winning data
- [ ] Update optimizer to recommend trait-matched MOKI+Scheme combos (find MOKIs that match trait Schemes)
- [ ] Verify optimizer now recommends trait Schemes when user has qualifying MOKIs

## Variance-Aware Optimizer (DONE) (Trait Scheme Bias Fix)
- [x] Add contestType field (topPercent vs winnerTakeAll) to ContestRules
- [x] Detect contest type from contest name (Top 20%, Top 10%, etc.)
- [x] Boost trait scheme risk multiplier for topPercent contests (consistency advantage, 1.65x)
- [x] Penalize high-variance performance schemes for topPercent contests (0.9x)
- [x] Update tests for variance-aware scoring (205 tests, 0 TS errors)

## Season 1 Data Filter (Feb 19, 2026+)
- [x] Update scraper to only fetch matches from Feb 19, 2026 onwards (Season 1 start)
- [x] Stop scraping when hitting matches older than Feb 19
- [x] Clear old match data from database (before Feb 19)
- [x] Re-run full scrape with date filter for all 179 champions (179/179 complete, 2,474 matches, 14,844 player stats)
- [x] Compare kill rankings against GATracker leaderboard (DHEU confirmed top killer on both)
- [x] Deploy updated version

## Bug Fix: Collect 'Em All Scheme Scoring
- [x] Fix scheme scoring for rarity-diversity schemes (Collect 'Em All: +35 per UNIQUE rarity in lineup)
- [x] All-Epic lineup = 1 unique rarity = only +35 bonus, not +140
- [x] Audit ALL scheme cards for similar misinterpretation of bonus conditions
- [x] Add regression tests for rarity-diversity scheme scoring (208 tests, 0 TS errors)

## Bug Fix: Optimizer Only Considers Owned Cards
- [x] Optimizer should use ALL 180 champions as the candidate pool, not just owned cards
- [x] Owned cards are only relevant for card lockup tracking (already-entered contests)
- [x] Update lineupRouter to pass all champions from game-data.json as the candidate pool
- [x] Keep owned card lockup logic intact (cards in active contests can't be reused)

## Bug Fixes Round 13
- [x] Fix lineup builder: Hard exclude non-qualifying champions from trait scheme lineups (Golden Shower must only contain Gold Fur MOKIs)
- [x] Restore missing pages: Opponent Crusher, Meta Report, Champion Deep Dive, Legendary Advisor — sidebar nav + routes + working backend procedures
