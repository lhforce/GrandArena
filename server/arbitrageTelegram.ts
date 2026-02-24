/**
 * Arbitrage Telegram Alerts — Sends notifications for profitable opportunities.
 *
 * Triggers:
 * - Craft arbitrage with >20% profit margin
 * - Supply squeeze with ≤5 listings and >30% estimated profit
 */

import { sendTelegramMessage } from "./telegramAlerts";
import type { CraftArbitrageOpportunity, SupplySqueezeOpportunity } from "./arbitrageCalculator";

const CRAFT_PROFIT_THRESHOLD = 20; // Minimum profit % to alert
const SQUEEZE_PROFIT_THRESHOLD = 30; // Minimum squeeze profit % to alert
const SQUEEZE_MAX_LISTINGS = 5; // Only alert for very low supply

/**
 * Send Telegram alerts for profitable craft arbitrage opportunities.
 */
export async function sendCraftArbitrageAlerts(
  opportunities: CraftArbitrageOpportunity[],
  botToken: string,
  chatId: string
): Promise<number> {
  const alertable = opportunities.filter((o) => o.profitPercent >= CRAFT_PROFIT_THRESHOLD);
  if (alertable.length === 0) return 0;

  // Group by profit tier
  const high = alertable.filter((o) => o.profitPercent >= 50);
  const medium = alertable.filter((o) => o.profitPercent >= 20 && o.profitPercent < 50);

  let message = "🔥 <b>Card Arbitrage Alert</b>\n\n";

  if (high.length > 0) {
    message += "🚀 <b>HIGH PROFIT (50%+)</b>\n";
    for (const o of high.slice(0, 5)) {
      message += formatCraftAlert(o);
    }
    message += "\n";
  }

  if (medium.length > 0) {
    message += "💰 <b>PROFITABLE (20-50%)</b>\n";
    for (const o of medium.slice(0, 10)) {
      message += formatCraftAlert(o);
    }
  }

  message += `\n📊 Total: ${alertable.length} profitable craft paths found`;
  message += `\n⏰ ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET`;

  await sendTelegramMessage(botToken, chatId, message, "HTML");
  return alertable.length;
}

function formatCraftAlert(o: CraftArbitrageOpportunity): string {
  const arrow = o.sourceRarity.charAt(0) + "→" + o.targetRarity.charAt(0);
  return (
    `• <b>${o.championName}</b> [${arrow}] ` +
    `+${o.profitPercent}% ($${o.profitUsd.toFixed(2)}) ` +
    `| Buy ${o.cardsNeeded}× ${o.sourceRarity} @ ${o.sourceFloorRon.toFixed(2)} RON → ` +
    `Sell ${o.targetRarity} @ ${o.sellPriceRon.toFixed(2)} RON\n`
  );
}

/**
 * Send Telegram alerts for supply squeeze opportunities.
 */
export async function sendSqueezeAlerts(
  opportunities: SupplySqueezeOpportunity[],
  botToken: string,
  chatId: string
): Promise<number> {
  const alertable = opportunities.filter(
    (o) => o.estimatedProfitPercent >= SQUEEZE_PROFIT_THRESHOLD && o.buyableListings <= SQUEEZE_MAX_LISTINGS
  );
  if (alertable.length === 0) return 0;

  let message = "🔒 <b>Supply Squeeze Alert</b>\n\n";

  for (const o of alertable.slice(0, 10)) {
    message +=
      `• <b>${o.championName}</b> (${o.rarity}) ` +
      `— Only ${o.buyableListings} listings!\n` +
      `  Buyout: ${o.buyoutCostRon.toFixed(2)} RON ($${o.buyoutCostUsd.toFixed(2)})\n` +
      `  Est. profit: +${o.estimatedProfitPercent}% ($${o.estimatedProfitUsd.toFixed(2)})\n`;
  }

  message += `\n📊 Total: ${alertable.length} squeeze opportunities`;
  message += `\n⏰ ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET`;

  await sendTelegramMessage(botToken, chatId, message, "HTML");
  return alertable.length;
}

/**
 * Send combined arbitrage summary alert.
 */
export async function sendArbitrageSummary(
  craftOpps: CraftArbitrageOpportunity[],
  squeezeOpps: SupplySqueezeOpportunity[],
  scannedChampions: number,
  scanDurationMs: number,
  botToken: string,
  chatId: string
): Promise<void> {
  const profitableCrafts = craftOpps.filter((o) => o.profitPercent >= CRAFT_PROFIT_THRESHOLD);
  const profitableSqueezes = squeezeOpps.filter(
    (o) => o.estimatedProfitPercent >= SQUEEZE_PROFIT_THRESHOLD && o.buyableListings <= SQUEEZE_MAX_LISTINGS
  );

  // Only send if there are opportunities
  if (profitableCrafts.length === 0 && profitableSqueezes.length === 0) {
    console.log("[ArbitrageTelegram] No profitable opportunities to alert");
    return;
  }

  // Send craft alerts
  if (profitableCrafts.length > 0) {
    await sendCraftArbitrageAlerts(craftOpps, botToken, chatId);
  }

  // Send squeeze alerts (separate message to avoid Telegram length limits)
  if (profitableSqueezes.length > 0) {
    await sendSqueezeAlerts(squeezeOpps, botToken, chatId);
  }
}
