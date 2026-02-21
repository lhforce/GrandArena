/**
 * Telegram Alerts Service — Sends notifications about new contests and filling contests.
 * 
 * Uses the Telegram Bot API to send messages to configured chat IDs.
 * Monitors contests for:
 * 1. New contests going LIVE
 * 2. Contests filling up fast (spots running low)
 * 3. DRAFT contests about to open
 */

import { getDb } from "./db";
import { contests } from "../drizzle/schema";

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

// ─── GA API Helper ─────────────────────────────────────────────────────────

interface GAContest {
  _id: string;
  name: string;
  format: string;
  entryFee: number;
  prizePool: number | string;
  maxEntries: number;
  entries: number;
  lineupConfig: {
    slots: Array<{ minRarity: string; maxRarity: string }>;
    schemeSlots?: Array<{ required: boolean }>;
    allowDuplicateChampions?: boolean;
    cardUsageLimitPerContest?: number;
  };
  contestStatus: string;
  startDate: string;
  endDate?: string;
}

/**
 * Fetch contests from the GA Fantasy API.
 * The API returns { contests: [...], total, limit, offset }.
 */
async function fetchGAContests(status: string): Promise<GAContest[]> {
  try {
    const resp = await fetch(
      `https://fantasy.grandarena.gg/api/contests?status=${status}`
    );
    if (!resp.ok) return [];

    const data = await resp.json();

    // Handle both old (flat array) and new ({ contests: [...] }) formats
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.contests)) return data.contests;

    return [];
  } catch (err) {
    console.error(`[Telegram] Error fetching ${status} contests:`, err);
    return [];
  }
}

/**
 * Derive rarity restriction from lineupConfig slots.
 */
function deriveRarityRestriction(contest: GAContest): string {
  const slots = contest.lineupConfig?.slots ?? [];
  if (slots.length === 0) return "OPEN";

  const minRarities = new Set(slots.map((s) => s.minRarity));
  const maxRarities = new Set(slots.map((s) => s.maxRarity));

  // All slots same min and max = single rarity restriction
  if (minRarities.size === 1 && maxRarities.size === 1) {
    const min = Array.from(minRarities)[0];
    const max = Array.from(maxRarities)[0];
    if (min === max) {
      if (min === "COMMON") return "COMMON_ONLY";
      if (min === "RARE") return "RARE_ONLY";
      if (min === "EPIC") return "EPIC_ONLY";
      if (min === "LEGENDARY") return "LEGENDARY_ONLY";
    }
    if (min === "COMMON" && max === "EPIC") return "NO_LEGENDARY";
    if (min === "COMMON" && max === "LEGENDARY") return "OPEN";
  }

  return "OPEN";
}

// ─── Alert Formatters ───────────────────────────────────────────────────────

function formatGems(gems: number): string {
  return `${gems.toLocaleString()} gems ($${(gems / 100).toFixed(2)})`;
}

function formatContestAlert(contest: GAContest): string {
  const currentEntries = contest.entries ?? 0;
  const maxEntries = contest.maxEntries;
  const isUnlimited = maxEntries == null || maxEntries <= 0;
  const spotsLeft = isUnlimited ? Infinity : maxEntries - currentEntries;
  const fillPct = isUnlimited ? 0 : Math.round((currentEntries / maxEntries) * 100);
  const rarity = deriveRarityRestriction(contest);

  let msg = `🏟️ <b>${contest.name}</b>\n`;
  msg += `📋 Format: ${contest.format ?? "Unknown"}\n`;
  msg += `💎 Entry: ${contest.entryFee ? formatGems(contest.entryFee) : "FREE"}\n`;
  msg += `🏆 Prize: ${contest.prizePool ?? "N/A"}\n`;
  if (rarity !== "OPEN") {
    msg += `⭐ Rarity: ${rarity}\n`;
  }
  if (!isUnlimited) {
    msg += `👥 Spots: ${spotsLeft} remaining (${fillPct}% full)\n`;
  } else {
    msg += `👥 Entries: ${currentEntries} (unlimited)\n`;
  }

  return msg;
}

// ─── Contest Monitoring ─────────────────────────────────────────────────────

/**
 * Check for new LIVE contests and send alerts.
 */
export async function checkNewContests(
  botToken: string,
  chatId: string,
  knownContestIds: Set<string>
): Promise<{ newContests: string[]; alertsSent: number }> {
  const newContests: string[] = [];
  let alertsSent = 0;

  try {
    const liveContests = await fetchGAContests("LIVE");

    for (const contest of liveContests) {
      if (!knownContestIds.has(contest._id)) {
        newContests.push(contest._id);

        const msg =
          `🆕 <b>NEW CONTEST LIVE!</b>\n\n` +
          formatContestAlert(contest) +
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
    const liveContests = await fetchGAContests("LIVE");

    for (const contest of liveContests) {
      const maxEntries = contest.maxEntries ?? 0;
      const currentEntries = contest.entries ?? 0;
      if (maxEntries <= 0) continue;

      const fillPct = currentEntries / maxEntries;
      if (fillPct >= fillThreshold && !alreadyAlerted.has(contest._id)) {
        fillingContests.push(contest._id);

        const spotsLeft = maxEntries - currentEntries;
        const emoji = fillPct >= 0.9 ? "🔴" : "🟡";

        const msg =
          `${emoji} <b>CONTEST FILLING FAST!</b>\n\n` +
          formatContestAlert(contest) +
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
 * Send a summary of upcoming OPEN and DRAFT contests.
 */
export async function sendDraftContestSummary(
  botToken: string,
  chatId: string
): Promise<boolean> {
  try {
    // Fetch both OPEN and LIVE contests
    const [openContests, liveContests] = await Promise.all([
      fetchGAContests("OPEN"),
      fetchGAContests("LIVE"),
    ]);

    const allContests = [...liveContests, ...openContests];

    if (allContests.length === 0) {
      return sendTelegramMessage(
        botToken,
        chatId,
        "📅 <b>CONTEST SUMMARY</b>\n\nNo active or upcoming contests at this time."
      );
    }

    let msg = `📅 <b>CONTEST SUMMARY</b>\n\n`;

    // Live contests section
    if (liveContests.length > 0) {
      msg += `🔴 <b>LIVE NOW (${liveContests.length})</b>\n\n`;
      for (const contest of liveContests.slice(0, 8)) {
        const currentEntries = contest.entries ?? 0;
        const maxEntries = contest.maxEntries;
        const rarity = deriveRarityRestriction(contest);
        const spotsInfo = maxEntries != null && maxEntries > 0
          ? `${maxEntries - currentEntries} spots left`
          : `${currentEntries} entries`;

        msg += `• <b>${contest.name}</b>\n`;
        msg += `  ${contest.format} | ${contest.entryFee ? formatGems(contest.entryFee) : "FREE"} | Prize: ${contest.prizePool ?? "N/A"}\n`;
        if (rarity !== "OPEN") msg += `  ⭐ ${rarity}\n`;
        msg += `  👥 ${spotsInfo}\n\n`;
      }
      if (liveContests.length > 8) {
        msg += `  ...and ${liveContests.length - 8} more live\n\n`;
      }
    }

    // Open contests section
    if (openContests.length > 0) {
      msg += `🟢 <b>UPCOMING (${openContests.length})</b>\n\n`;
      for (const contest of openContests.slice(0, 8)) {
        const startDate = new Date(contest.startDate);
        const rarity = deriveRarityRestriction(contest);

        msg += `• <b>${contest.name}</b>\n`;
        msg += `  ${contest.format} | ${contest.entryFee ? formatGems(contest.entryFee) : "FREE"} | Prize: ${contest.prizePool ?? "N/A"}\n`;
        if (rarity !== "OPEN") msg += `  ⭐ ${rarity}\n`;
        msg += `  🕐 Starts: ${startDate.toLocaleString()}\n\n`;
      }
      if (openContests.length > 8) {
        msg += `  ...and ${openContests.length - 8} more upcoming\n\n`;
      }
    }

    msg += `🔗 <a href="https://fantasy.grandarena.gg/contests">View All Contests</a>`;

    return sendTelegramMessage(botToken, chatId, msg);
  } catch (err) {
    console.error("[Telegram] Error sending contest summary:", err);
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
