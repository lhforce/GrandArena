/**
 * One-time script: fetch Legendary image URLs for specific champions
 * and update marketplace_prices table.
 */
import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const GRAPHQL_URL = "https://marketplace-graphql.skymavis.com/graphql";
const GA_CARDS_CONTRACT = "0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b";

async function fetchLegendaryImage(championName) {
  const safeName = championName.replace(/"/g, '\\"');
  const useNameFilter = safeName.length >= 3;
  const query = `{
    erc721Tokens(
      tokenAddress: "${GA_CARDS_CONTRACT}",
      from: 0,
      size: 5,
      sort: PriceAsc,
      auctionType: Sale,
      criteria: [
        {name: "Card Type", values: ["MOKI"]},
        {name: "Rarity", values: ["Legendary"]}
      ]${useNameFilter ? `,\n      name: "${safeName}"` : ''}
    ) {
      results {
        tokenId
        name
        image
      }
    }
  }`;

  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await resp.json();
  const results = data?.data?.erc721Tokens?.results ?? [];
  const match = results.find(r => r.name?.toLowerCase() === championName.toLowerCase());
  return match?.image ?? results[0]?.image ?? null;
}

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  // Fetch all champions that have Legendary entries in marketplace_prices but no imageUrl
  const [rows] = await conn.query(
    `SELECT id, championName FROM marketplace_prices WHERE rarity = 'Legendary' AND (imageUrl IS NULL OR imageUrl = '') LIMIT 200`
  );

  console.log(`Found ${rows.length} Legendary entries missing imageUrl`);

  let updated = 0;
  for (const row of rows) {
    try {
      const imageUrl = await fetchLegendaryImage(row.championName);
      if (imageUrl) {
        await conn.query(
          `UPDATE marketplace_prices SET imageUrl = ? WHERE id = ?`,
          [imageUrl, row.id]
        );
        console.log(`✓ ${row.championName}: ${imageUrl.slice(-30)}`);
        updated++;
      } else {
        console.log(`✗ ${row.championName}: no image found`);
      }
      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn(`Error for ${row.championName}:`, e.message);
    }
  }

  console.log(`\nUpdated ${updated}/${rows.length} entries`);
  await conn.end();
}

main().catch(console.error);
