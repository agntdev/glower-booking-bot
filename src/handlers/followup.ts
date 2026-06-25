// Post-appointment follow-up. The bot runs a lightweight periodic scan (every
// minute) and posts a review-prompt message to the user exactly once, 1 hour
// after the booking's end time. Once sent, the booking's `followUpSent` flag
// is flipped so it never re-fires.
//
// This is a side-effecting long-running concern: it's NOT a handler that
// responds to user input. We export a `startFollowupScheduler(api)` that
// src/index.ts calls at startup, and we still export a default `Composer`
// (required by buildBot's auto-loader) that has no routes.

import { Composer } from "grammy";
import type { Api } from "grammy";
import { listBookings, updateBooking } from "../storage/store.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer();
// Intentionally no routes — this module is a side-effecting scheduler, not a
// user-facing handler. It MUST still export a Composer so buildBot's
// auto-loader accepts the file.
export default composer;

/** Tunable. */
export const FOLLOWUP_DELAY_MS = 60 * 60 * 1000; // 1 hour
const TICK_MS = 60 * 1000; // 1 minute

let timer: NodeJS.Timeout | null = null;

async function tick(api: Api): Promise<void> {
  const now = Date.now();
  const horizon = now - FOLLOWUP_DELAY_MS;
  const candidates = await listBookings();
  for (const b of candidates) {
    if (b.followUpSent) continue;
    if (b.status !== "confirmed") continue;
    const endMs = b.startEpochMs + b.durationMinutes * 60_000;
    if (endMs > horizon) continue;
    // Send the follow-up.
    try {
      await api.sendMessage(
        b.userId,
        `👋 Hope your appointment went well! Care to leave a quick review?`,
        {
          reply_markup: inlineKeyboard([
            [inlineButton("✍️ Leave a review", "rv:s")],
            [inlineButton("Maybe later", "menu:main")],
          ]),
        },
      );
      await updateBooking(b.id, { followUpSent: true });
    } catch {
      // User may have blocked the bot; mark sent so we don't retry forever.
      await updateBooking(b.id, { followUpSent: true });
    }
  }
}

/** Start the periodic follow-up scan. Idempotent: re-calling is a no-op. */
export function startFollowupScheduler(api: Api): void {
  if (timer) return;
  // First tick immediately on boot, then on interval.
  void tick(api);
  timer = setInterval(() => {
    void tick(api);
  }, TICK_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
}

/** Test hook — stop the scheduler. */
export function _stopFollowupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}