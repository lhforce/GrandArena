/**
 * Arbitrage Cron Job — Hourly marketplace scan + Telegram alerts.
 *
 * Runs alongside the existing match history cron.
 * Scans all champions, calculates arbitrage, sends alerts.
 */

import { runArbitrageScan } from "./arbitrageCalculator";
import { sendArbitrageSummary } from "./arbitrageTelegram";

const CRON_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let cronTimer: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;
let lastRunResult: { craftCount: number; squeezeCount: number; duration: number } | null = null;

/**
 * Run a single arbitrage scan cycle with Telegram alerts.
 */
async function runCycle(): Promise<void> {
  console.log("[ArbitrageCron] Starting hourly scan...");
  const startTime = Date.now();

  try {
    const result = await runArbitrageScan();

    lastRunAt = new Date();
    lastRunResult = {
      craftCount: result.craftOpportunities.length,
      squeezeCount: result.squeezeOpportunities.length,
      duration: result.scanDurationMs,
    };

    // Send Telegram alerts
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      await sendArbitrageSummary(
        result.craftOpportunities,
        result.squeezeOpportunities,
        result.scannedChampions,
        result.scanDurationMs,
        botToken,
        chatId
      );
    }

    console.log(
      `[ArbitrageCron] Scan complete: ${result.craftOpportunities.length} craft, ` +
      `${result.squeezeOpportunities.length} squeeze, ${Math.round(result.scanDurationMs / 1000)}s`
    );
  } catch (err) {
    console.error("[ArbitrageCron] Scan failed:", (err as Error).message);
  }
}

/**
 * Start the hourly arbitrage cron job.
 */
export function startArbitrageCron(): void {
  if (cronTimer) {
    console.log("[ArbitrageCron] Already running");
    return;
  }

  console.log("[ArbitrageCron] Starting hourly cron job");
  cronTimer = setInterval(runCycle, CRON_INTERVAL_MS);

  // Run first scan after 30 seconds (let server finish starting)
  setTimeout(() => {
    runCycle().catch((err) => {
      console.error("[ArbitrageCron] Initial scan failed:", err);
    });
  }, 30_000);
}

/**
 * Stop the hourly arbitrage cron job.
 */
export function stopArbitrageCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    console.log("[ArbitrageCron] Stopped");
  }
}

/**
 * Get cron job status.
 */
export function getArbitrageCronStatus() {
  return {
    running: cronTimer !== null,
    lastRunAt: lastRunAt?.toISOString() || null,
    lastRunResult,
    nextRunAt: cronTimer && lastRunAt
      ? new Date(lastRunAt.getTime() + CRON_INTERVAL_MS).toISOString()
      : null,
  };
}
