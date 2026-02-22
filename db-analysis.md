# Database Analysis - Before Season 1 Cleanup

## Current State
- Total matches: 14,753
- Total player stats: 88,518
- Date range: 2025-12-28 to 2026-02-22
- Season 1 matches (>=2026-02-19): 2,414 (16.4%)
- Pre-season matches (<2026-02-19): 12,296 (83.3%)
- NULL date matches: 43 (0.3%)
- Champions completed: 179/179

## Top 10 Total Kills (ALL data - includes pre-season)
1. Mokington (#1826): 231 kills in 103 matches (avg 2.24)
2. Dheu (#8180): 214 kills in 102 matches (avg 2.10)
3. Mokuna (#7338): 212 kills in 102 matches (avg 2.08)
4. Mokiwitch (#962): 210 kills in 101 matches (avg 2.08)
5. Sleepy Gary (#5050): 205 kills in 101 matches (avg 2.03)
6. sweet90s (#987): 201 kills in 101 matches (avg 1.99)
7. Zombina (#1444): 196 kills in 101 matches (avg 1.94)
8. Dracumoki (#2755): 192 kills in 102 matches (avg 1.88)
9. Butthole Moki (#6913): 189 kills in 102 matches (avg 1.85)
10. Fishoo (#8316): 186 kills in 101 matches (avg 1.84)

## Top 10 Total Kills (Season 1 only, >=2026-02-19)
1. Ryu Ganken (#6824): 66 kills in 26 matches (avg 2.54)
2. Zombina (#1444): 64 kills in 28 matches (avg 2.29)
3. Mokuna (#7338): 63 kills in 26 matches (avg 2.42)
4. JOEHNINGUS (#5504): 62 kills in 25 matches (avg 2.48)
5. Mokiwitch (#962): 61 kills in 28 matches (avg 2.18)
6. Mokington (#1826): 60 kills in 26 matches (avg 2.31)
7. Scabbers (#3715): 59 kills in 26 matches (avg 2.27)
8. Dheu (#8180): 56 kills in 26 matches (avg 2.15)
9. Dracumoki (#2755): 55 kills in 27 matches (avg 2.04)
10. sweet90s (#987): 50 kills in 26 matches (avg 1.92)

## GATracker Leaderboard (from browser observation)
- DHEU: 1,977 total kills (KILLA KING)
- Need to compare more carefully after re-scrape

## Key Insight
Our Season 1 data only has ~26-28 matches per champion, but GATracker shows
DHEU with 1,977 kills. This is a MASSIVE discrepancy. GATracker likely has
full Season 1 data with many more matches. Our scraper only got ~26 matches
per champion for the Season 1 period, suggesting incomplete scraping.

The scrape shows 2,414 Season 1 matches total across 179 champions.
That's ~13.5 matches per champion average. But GATracker shows champions
with hundreds of matches in Season 1 alone.
