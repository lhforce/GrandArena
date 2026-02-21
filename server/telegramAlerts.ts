/**
 * Telegram Alerts Service — Sends notifications about new contests and filling contests.
 * 
 * Uses the Telegram Bot API to send messages to configured chat IDs.
 * Monitors contests for:
 * 1. New contests going LIVE
 * 2. Contests filling up fast (spots running low)
 * 3. DRAFT contests about to open
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { contests, users } from "../drizzle/schema";

// ─── Telegram Bot API ───────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org";

interface TelegramSendResult {
  ok: boolean;
  description?: string;
  result?: { message_id: number };
}

/**
 * Send a message via Telegram Bot API.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    const data = (await resp.json()) as TelegramSendResult;
    if (!data.ok) {
      console.error(`[Telegram] Failed to send message: ${data.description}`);
      return false;
    }

    console.log(`[Telegram] Message sent to ${chatId}: ${text.substring(0, 50)}...`);
    return true;
  } catch (err) {
    console.error("[Telegram] Error sending message:", err);
    return false;
  }
}

// ─── Alert Formatters ───────────────────────────────────────────────────────

function formatGems(gems: number): string {
  return `${gems.toLocaleString()} gems ($${(gems / 100).toFixed(2)})`;
}

function formatContestAlert(contest: {
  name: string;
  format: string | null;
  entryFee: number | null;
  prizePool: string | null;
  maxEntries: number | null;
  currentEntries: number | null;
  rarityRestriction: string | null;
  contestStatus: string | null;
}): string {
  const spotsLeft = (contest.maxEntries ?? 0) - (contest.currentEntries ?? 0);
  const fillPct = contest.maxEntries
    ? Math.round(((contest.currentEntries ?? 0) / contest.maxEntries) * 100)
    : 0;

  let msg = `🏟️ <b>${contest.name}</b>\n`;
  msg += `📋 Format: ${contest.format ?? "Unknown"}\n`;
  msg += `💎 Entry: ${contest.entryFee ? formatGems(contest.entryFee) : "FREE"}\n`;
  msg += `🏆 Prize: ${contest.prizePool ?? "N/A"}\n`;
  if (contest.rarityRestriction && contest.rarityRestriction !== "OPEN") {
    msg += `⭐ Rarity: ${contest.rarityRestriction}\n`;
  }
  msg += `👥 Spots: ${spotsLeft} remaining (${fillPct}% full)\n`;

  return msg;
}

// ─── Contest Monitoring ─────────────────────────────────────────────────────

/**
 * Check for new LIVE contests and send alerts.
 * Returns the number of alerts sent.
 */
export async function checkNewContests(
  botToken: string,
  chatId: string,
  knownContestIds: Set<string>
): Promise<{ newContests: string[]; alertsSent: number }> {
  const newContests: string[] = [];
  let alertsSent = 0;

  try {
    // Fetch current LIVE contests from GA API
    const resp = await fetch(
      "https://fantasy.grandarena.gg/api/contests?status=LIVE"
    );
    if (!resp.ok) return { newContests, alertsSent };

    const liveContests = (await resp.json()) as Array<{
      _id: string;
      name: string;
      format: string;
      entryFee: number;
      prizePool: string;
      maxEntries: number;
      currentEntries: number;
      rarityRestriction: string;
      status: string;
    }>;

    for (const contest of liveContests) {
      if (!knownContestIds.has(contest._id)) {
        newContests.push(contest._id);

        const msg =
          `🆕 <b>NEW CONTEST LIVE!</b>\n\n` +
          formatContestAlert({
            name: contest.name,
            format: contest.format,
            entryFee: contest.entryFee,
            prizePool: contest.prizePool,
            maxEntries: contest.maxEntries,
            currentEntries: contest.currentEntries,
            rarityRestriction: contest.rarityRestriction,
            contestStatus: "LIVE",
          }) +
          `\n🔗 <a href="https://fantasy.grandarena.gg/contests">Enter Now</a>`;

        const sent = await sendTelegramMessage(botToken, chatId, msg);
        if (sent) alertsSent++;
      }
    }
  } catch (err) {
    console.error("[Telegram] Error checking new contests:", err);
  }

  return { newContests, alertsSent };
}

/**
 * Check for contests that are filling up fast (>75% full).
 */
export async function checkFillingContests(
  botToken: string,
  chatId: string,
  alreadyAlerted: Set<string>,
  fillThreshold: number = 0.75
): Promise<{ fillingContests: string[]; alertsSent: number }> {
  const fillingContests: string[] = [];
  let alertsSent = 0;

  try {
    const resp = await fetch(
      "https://fantasy.grandarena.gg/api/contests?status=LIVE"
    );
    if (!resp.ok) return { fillingContests, alertsSent };

    const liveContests = (await resp.json()) as Array<{
      _id: string;
      name: string;
      format: string;
      entryFee: number;
      prizePool: string;
      maxEntries: number;
      currentEntries: number;
      rarityRestriction: string;
    }>;

    for (const contest of liveContests) {
      if (contest.maxEntries <= 0) continue;

      const fillPct = contest.currentEntries / contest.maxEntries;
      if (fillPct >= fillThreshold && !alreadyAlerted.has(contest._id)) {
        fillingContests.push(contest._id);

        const spotsLeft = contest.maxEntries - contest.currentEntries;
        const emoji = fillPct >= 0.9 ? "🔴" : "🟡";

        const msg =
          `${emoji} <b>CONTEST FILLING FAST!</b>\n\n` +
          formatContestAlert({
            name: contest.name,
            format: contest.format,
            entryFee: contest.entryFee,
            prizePool: contest.prizePool,
            maxEntries: contest.maxEntries,
            currentEntries: contest.currentEntries,
            rarityRestriction: contest.rarityRestriction,
            contestStatus: "LIVE",
          }) +
          `\n⚡ Only <b>${spotsLeft}</b> spots left! Enter now before it fills up!` +
          `\n🔗 <a href="https://fantasy.grandarena.gg/contests">Enter Now</a>`;

        const sent = await sendTelegramMessage(botToken, chatId, msg);
        if (sent) alertsSent++;
      }
    }
  } catch (err) {
    console.error("[Telegram] Error checking filling contests:", err);
  }

  return { fillingContests, alertsSent };
}

/**
 * Send a daily summary of upcoming DRAFT contests.
 */
export async function sendDraftContestSummary(
  botToken: string,
  chatId: string
): Promise<boolean> {
  try {
    const resp = await fetch(
      "https://fantasy.grandarena.gg/api/contests?status=OPEN"
    );
    if (!resp.ok) return false;

    const openContests = (await resp.json()) as Array<{
      name: string;
      format: string;
      entryFee: number;
      prizePool: string;
      maxEntries: number;
      currentEntries: number;
      rarityRestriction: string;
      startDate: string;
    }>;

    if (openContests.length === 0) return true;

    let msg = `📅 <b>UPCOMING CONTESTS</b>\n\n`;
    for (const contest of openContests.slice(0, 10)) {
      const startDate = new Date(contest.startDate);
      msg += `• <b>${contest.name}</b>\n`;
      msg += `  ${contest.format} | ${contest.entryFee ? formatGems(contest.entryFee) : "FREE"} | ${contest.prizePool ?? "N/A"}\n`;
      if (contest.rarityRestriction && contest.rarityRestriction !== "OPEN") {
        msg += `  ⭐ ${contest.rarityRestriction}\n`;
      }
      msg += `  🕐 Starts: ${startDate.toLocaleString()}\n\n`;
    }

    if (openContests.length > 10) {
      msg += `...and ${openContests.length - 10} more\n`;
    }

    msg += `\n🔗 <a href="https://fantasy.grandarena.gg/contests">View All Contests</a>`;

    return sendTelegramMessage(botToken, chatId, msg);
  } catch (err) {
    console.error("[Telegram] Error sending draft summary:", err);
    return false;
  }
}

// ─── Alert Monitor (runs on interval) ───────────────────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let knownLiveContestIds = new Set<string>();
let alertedFillingContests = new Set<string>();

/**
 * Start the contest monitoring loop.
 */
export function startContestMonitor(
  botToken: string,
  chatId: string,
  intervalMs: number = 5 * 60 * 1000 // 5 minutes
): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  console.log(`[Telegram] Starting contest monitor (interval: ${intervalMs / 1000}s)`);

  // Run immediately on start
  runMonitorCycle(botToken, chatId);

  monitorInterval = setInterval(() => {
    runMonitorCycle(botToken, chatId);
  }, intervalMs);
}

/**
 * Stop the contest monitoring loop.
 */
export function stopContestMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[Telegram] Contest monitor stopped");
  }
}

/**
 * Run a single monitoring cycle.
 */
async function runMonitorCycle(botToken: string, chatId: string): Promise<void> {
  try {
    // Check for new contests
    const newResult = await checkNewContests(botToken, chatId, knownLiveContestIds);
    for (const id of newResult.newContests) {
      knownLiveContestIds.add(id);
    }

    // Check for filling contests
    const fillResult = await checkFillingContests(
      botToken,
      chatId,
      alertedFillingContests
    );
    for (const id of fillResult.fillingContests) {
      alertedFillingContests.add(id);
    }

    // Clean up old contest IDs periodically (every hour)
    if (knownLiveContestIds.size > 200) {
      knownLiveContestIds = new Set<string>();
      alertedFillingContests = new Set<string>();
    }
  } catch (err) {
    console.error("[Telegram] Monitor cycle error:", err);
  }
}

/**
 * Get the current monitor status.
 */
export function getMonitorStatus(): {
  running: boolean;
  knownContests: number;
  alertedFilling: number;
} {
  return {
    running: monitorInterval !== null,
    knownContests: knownLiveContestIds.size,
    alertedFilling: alertedFillingContests.size,
  };
}

/**
 * Send a test message to verify bot configuration.
 */
export async function sendTestMessage(
  botToken: string,
  chatId: string
): Promise<boolean> {
  return sendTelegramMessage(
    botToken,
    chatId,
    "✅ <b>Grand Arena Tool</b> — Telegram alerts configured successfully!\n\nYou will receive notifications when:\n• New contests go LIVE\n• Contests are filling up fast (>75% full)\n• Daily summary of upcoming contests"
  );
}
