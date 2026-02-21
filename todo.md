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
