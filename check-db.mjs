import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const queries = [
  ['Total matches', 'SELECT COUNT(*) as c FROM match_history'],
  ['Total player stats', 'SELECT COUNT(*) as c FROM match_player_stats'],
  ['Min match date', 'SELECT MIN(matchDate) as c FROM match_history'],
  ['Max match date', 'SELECT MAX(matchDate) as c FROM match_history'],
  ['Season 1 matches (>=2026-02-19)', 'SELECT COUNT(*) as c FROM match_history WHERE matchDate >= "2026-02-19"'],
  ['Pre-season matches (<2026-02-19)', 'SELECT COUNT(*) as c FROM match_history WHERE matchDate < "2026-02-19"'],
  ['NULL date matches', 'SELECT COUNT(*) as c FROM match_history WHERE matchDate IS NULL'],
  ['Champions completed', 'SELECT COUNT(*) as c FROM match_scrape_progress WHERE status = "completed"'],
  ['Champions in_progress', 'SELECT COUNT(*) as c FROM match_scrape_progress WHERE status = "in_progress"'],
  ['Champions pending', 'SELECT COUNT(*) as c FROM match_scrape_progress WHERE status = "pending"'],
];

for (const [label, q] of queries) {
  const [rows] = await conn.execute(q);
  console.log(`${label}: ${rows[0].c}`);
}

// Top 10 by total kills from match_player_stats
console.log('\n--- Top 10 Total Kills (from match_player_stats, ALL data) ---');
const [killRows] = await conn.execute(`
  SELECT championName, championTokenId, SUM(kills) as totalKills, COUNT(*) as totalMatches, 
         ROUND(SUM(kills)/COUNT(*), 2) as avgKills
  FROM match_player_stats 
  GROUP BY championTokenId, championName
  ORDER BY totalKills DESC 
  LIMIT 10
`);
for (const row of killRows) {
  console.log(`  ${row.championName} (#${row.championTokenId}): ${row.totalKills} kills in ${row.totalMatches} matches (avg ${row.avgKills})`);
}

// Top 10 by total kills from Season 1 only
console.log('\n--- Top 10 Total Kills (Season 1 only, >=2026-02-19) ---');
const [s1KillRows] = await conn.execute(`
  SELECT championName, championTokenId, SUM(kills) as totalKills, COUNT(*) as totalMatches, 
         ROUND(SUM(kills)/COUNT(*), 2) as avgKills
  FROM match_player_stats 
  WHERE matchDate >= '2026-02-19'
  GROUP BY championTokenId, championName
  ORDER BY totalKills DESC 
  LIMIT 10
`);
for (const row of s1KillRows) {
  console.log(`  ${row.championName} (#${row.championTokenId}): ${row.totalKills} kills in ${row.totalMatches} matches (avg ${row.avgKills})`);
}

await conn.end();
