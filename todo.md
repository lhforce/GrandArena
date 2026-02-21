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
