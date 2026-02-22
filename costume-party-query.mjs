import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const champIds = ['7215','4772','1600','298','8530','807','2284','7858','539','939','1454','5705','3015','5232','5168','1133'];
const champNames = {
  '7215': 'Krampy', '4772': 'Milky', '1600': 'Not Nisheep', '298': 'Defrankong',
  '8530': 'Toast', '807': 'Banana Mogger', '2284': '67', '7858': 'Maomao',
  '539': 'Bloodmoon', '939': 'Pengu', '1454': 'Peelbert Grumps', '5705': 'Fenrir',
  '3015': 'Gambit', '5232': 'The Destroyer', '5168': 'Nisheep', '1133': 'Bearish'
};
const champRarity = {
  '7215': 'Basic', '4772': 'Rare', '1600': 'Rare', '298': 'Rare',
  '8530': 'Epic', '807': 'Rare', '2284': 'Rare', '7858': 'Rare',
  '539': 'Rare', '939': 'Epic', '1454': 'Basic', '5705': 'Rare',
  '3015': 'Basic', '5232': 'Rare', '5168': 'Rare', '1133': 'Basic'
};

const conn = await createConnection(process.env.DATABASE_URL);

const placeholders = champIds.map(() => '?').join(',');
const [rows] = await conn.execute(`
  SELECT 
    mps.championTokenId as champion_token_id,
    COUNT(*) as matches,
    SUM(mps.kills) as total_kills,
    AVG(mps.kills) as avg_kills,
    SUM(mps.balls) as total_balls,
    AVG(mps.balls) as avg_balls,
    AVG(mps.wartDistance) as avg_wart,
    SUM(CASE WHEN mps.isWinner = 1 THEN 1 ELSE 0 END) as wins,
    AVG(mps.kills * 85 + mps.balls * 40 + mps.wartDistance * 0.001) as avg_score
  FROM match_player_stats mps
  JOIN match_history mh ON mps.matchId = mh.matchId
  WHERE mps.championTokenId IN (${placeholders})
  AND mh.matchDate >= '2026-02-19'
  GROUP BY mps.championTokenId
  ORDER BY avg_kills DESC
`, champIds);

console.log('\nCostume Party Qualifying Champions — Season 1 Performance:\n');
console.log('Champion'.padEnd(20) + 'Rarity'.padEnd(12) + 'Matches'.padEnd(10) + 'Avg Kills'.padEnd(12) + 'Avg Balls'.padEnd(12) + 'Avg Score'.padEnd(12) + 'Win%');
console.log('-'.repeat(90));

const foundIds = [];
for (const row of rows) {
  const name = champNames[row.champion_token_id] || row.champion_token_id;
  const rarity = champRarity[row.champion_token_id] || '?';
  const winPct = ((Number(row.wins) / Number(row.matches)) * 100).toFixed(1);
  foundIds.push(row.champion_token_id);
  console.log(
    name.padEnd(20) +
    rarity.padEnd(12) +
    String(row.matches).padEnd(10) +
    Number(row.avg_kills).toFixed(3).padEnd(12) +
    Number(row.avg_balls).toFixed(3).padEnd(12) +
    Number(row.avg_score).toFixed(1).padEnd(12) +
    winPct + '%'
  );
}

const missing = champIds.filter(id => !foundIds.includes(id));
if (missing.length > 0) {
  console.log('\nNo Season 1 data for:', missing.map(id => champNames[id]).join(', '));
}

await conn.end();
