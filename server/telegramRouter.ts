/**
 * Telegram Router — tRPC procedures for Telegram alert configuration,
 * testing, and contest monitoring control.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import {
  sendTestMessage,
  startContestMonitor,
  stopContestMonitor,
  getMonitorStatus,
  sendDraftContestSummary,
  sendTelegramMessage,
} from "./telegramAlerts";

// Default bot token and chat ID from user's spec
const DEFAULT_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

export const telegramRouter = router({
  /**
   * Get current Telegram configuration and monitor status.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { configured: false, monitorStatus: getMonitorStatus() };

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    return {
      configured: !!(user?.telegramChatId || DEFAULT_CHAT_ID),
      chatId: user?.telegramChatId ?? DEFAULT_CHAT_ID ?? "",
      alertsEnabled: user?.telegramAlertsEnabled ?? false,
      monitorStatus: getMonitorStatus(),
    };
  }),

  /**
   * Send a test message to verify configuration.
   */
  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    const chatId = user?.telegramChatId ?? DEFAULT_CHAT_ID;
    const botToken = DEFAULT_BOT_TOKEN;

    if (!botToken || !chatId) {
      throw new Error("Telegram bot token or chat ID not configured. Set them in Settings.");
    }

    const success = await sendTestMessage(botToken, chatId);
    return { success, chatId };
  }),

  /**
   * Start the contest monitoring loop.
   */
  startMonitor: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    const chatId = user?.telegramChatId ?? DEFAULT_CHAT_ID;
    const botToken = DEFAULT_BOT_TOKEN;

    if (!botToken || !chatId) {
      throw new Error("Telegram bot token or chat ID not configured.");
    }

    startContestMonitor(botToken, chatId, 5 * 60 * 1000); // 5 minute interval

    // Update user preference
    await db
      .update(users)
      .set({ telegramAlertsEnabled: true })
      .where(eq(users.id, ctx.user.id));

    return { started: true, monitorStatus: getMonitorStatus() };
  }),

  /**
   * Stop the contest monitoring loop.
   */
  stopMonitor: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    stopContestMonitor();

    await db
      .update(users)
      .set({ telegramAlertsEnabled: false })
      .where(eq(users.id, ctx.user.id));

    return { stopped: true, monitorStatus: getMonitorStatus() };
  }),

  /**
   * Send a daily summary of upcoming contests.
   */
  sendSummary: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    const chatId = user?.telegramChatId ?? DEFAULT_CHAT_ID;
    const botToken = DEFAULT_BOT_TOKEN;

    if (!botToken || !chatId) {
      throw new Error("Telegram bot token or chat ID not configured.");
    }

    const success = await sendDraftContestSummary(botToken, chatId);
    return { success };
  }),

  /**
   * Send a custom alert message.
   */
  sendCustom: protectedProcedure
    .input(z.object({ message: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      const chatId = user?.telegramChatId ?? DEFAULT_CHAT_ID;
      const botToken = DEFAULT_BOT_TOKEN;

      if (!botToken || !chatId) {
        throw new Error("Telegram bot token or chat ID not configured.");
      }

      const success = await sendTelegramMessage(botToken, chatId, input.message);
      return { success };
    }),
});
