import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('=== DATABASE SUMMARY ===');
const [[summary]] = await conn.execute(`
  SELECT 
    COUNT(*) as totalMatches,
    MIN(matchDate) as minDate,
    MAX(matchDate) as maxDate,
    SUM(CASE WHEN matchDate >= '2026-02-19' THEN 1 ELSE 0 END) as season1Matches,
    SUM(CASE WHEN matchDate < '2026-02-19' THEN 1 ELSE 0 END) as preSeasonMatches,
    SUM(CASE WHEN matchDate IS NULL THEN 1 ELSE 0 END) as nullDates
  FROM match_history
`);
console.log(`Total matches: ${summary.totalMatches}`);
console.log(`Date range: ${summary.minDate} → ${summary.maxDate}`);
console.log(`Season 1 (>=Feb 19): ${summary.season1Matches}`);
console.log(`Pre-season (<Feb 19): ${summary.preSeasonMatches}`);
console.log(`NULL dates: ${summary.nullDates}`);

const [[stats]] = await conn.execute(`SELECT COUNT(*) as c FROM match_player_stats`);
console.log(`Total player stats rows: ${stats.c}`);

const [[prog]] = await conn.execute(`
  SELECT 
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as inProgress,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
  FROM match_scrape_progress
`);
console.log(`Scrape progress: ${prog.completed} completed, ${prog.inProgress} in_progress, ${prog.pending} pending`);

console.log('\n=== TOP 20 BY AVG KILLS (Season 1, min 5 matches) ===');
const [avgKillRows] = await conn.execute(`
  SELECT 
    championName, championTokenId,
    COUNT(*) as totalMatches,
    SUM(kills) as totalKills,
    ROUND(SUM(kills)/COUNT(*), 3) as avgKills,
    ROUND(SUM(isWinner)/COUNT(*)*100, 1) as winRate
  FROM match_player_stats 
  WHERE matchDate >= '2026-02-19'
  GROUP BY championTokenId, championName
  HAVING totalMatches >= 5
  ORDER BY avgKills DESC 
  LIMIT 20
`);
for (const [i, row] of avgKillRows.entries()) {
  console.log(`  ${i+1}. ${row.championName} (#${row.championTokenId}): avg ${row.avgKills} kills | ${row.totalKills} total | ${row.totalMatches} matches | ${row.winRate}% WR`);
}

console.log('\n=== TOP 20 BY TOTAL KILLS (Season 1, min 5 matches) ===');
const [totalKillRows] = await conn.execute(`
  SELECT 
    championName, championTokenId,
    COUNT(*) as totalMatches,
    SUM(kills) as totalKills,
    ROUND(SUM(kills)/COUNT(*), 3) as avgKills,
    ROUND(SUM(isWinner)/COUNT(*)*100, 1) as winRate
  FROM match_player_stats 
  WHERE matchDate >= '2026-02-19'
  GROUP BY championTokenId, championName
  HAVING totalMatches >= 5
  ORDER BY totalKills DESC 
  LIMIT 20
`);
for (const [i, row] of totalKillRows.entries()) {
  console.log(`  ${i+1}. ${row.championName} (#${row.championTokenId}): ${row.totalKills} total kills | avg ${row.avgKills} | ${row.totalMatches} matches | ${row.winRate}% WR`);
}

console.log('\n=== MATCH COUNT DISTRIBUTION (Season 1) ===');
const [distRows] = await conn.execute(`
  SELECT 
    CASE 
      WHEN totalMatches < 10 THEN '< 10 matches'
      WHEN totalMatches < 15 THEN '10-14 matches'
      WHEN totalMatches < 20 THEN '15-19 matches'
      WHEN totalMatches < 25 THEN '20-24 matches'
      ELSE '25+ matches'
    END as bucket,
    COUNT(*) as champions
  FROM (
    SELECT championTokenId, COUNT(*) as totalMatches
    FROM match_player_stats
    WHERE matchDate >= '2026-02-19'
    GROUP BY championTokenId
  ) t
  GROUP BY bucket
  ORDER BY MIN(totalMatches)
`);
for (const row of distRows) {
  console.log(`  ${row.bucket}: ${row.champions} champions`);
}

await conn.end();
