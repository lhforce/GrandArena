import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn, { mode: 'default' });

// Check table columns first
const cols = await db.execute(sql`SHOW COLUMNS FROM match_scrape_progress`);
console.log('Columns:', cols[0].map(c => c.Field));

const progress = await db.execute(sql`SELECT status, COUNT(*) as cnt FROM match_scrape_progress GROUP BY status`);
console.log('\nScrape progress:', progress[0]);

const mc = await db.execute(sql`SELECT COUNT(*) as cnt FROM match_history`);
console.log('Total matches in DB:', mc[0][0]?.cnt);

const sc = await db.execute(sql`SELECT COUNT(*) as cnt FROM match_player_stats`);
console.log('Total player stats in DB:', sc[0][0]?.cnt);

const recent = await db.execute(sql`SELECT * FROM match_scrape_progress ORDER BY last_scraped_at DESC LIMIT 10`);
console.log('\nRecent scrape progress:');
for (const r of recent[0]) {
  console.log(`  ${r.champion_token_id}: status=${r.status}, pages=${r.pages_scraped}, total=${r.total_matches}, last=${r.last_scraped_at}`);
}

// Check how many unique champions are in match_player_stats
const uniqueChamps = await db.execute(sql`SELECT COUNT(DISTINCT champion_token_id) as cnt FROM match_player_stats`);
console.log('\nUnique champions in match data:', uniqueChamps[0][0]?.cnt);

await conn.end();
