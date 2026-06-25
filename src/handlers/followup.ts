import { Composer, type Bot } from "grammy";
import type { Ctx } from "../bot.js";
import { getBookings, upsertBooking } from "../store.js";

const composer = new Composer<Ctx>();

const FOLLOWUP_CHECK_INTERVAL = 60_000;

async function checkFollowups(bot: Bot<Ctx>): Promise<void> {
  const now = new Date();
  const bookings = await getBookings();
  for (const b of bookings) {
    if (b.status !== "confirmed" || b.followupSent) continue;
    const [y, mo, d] = b.date.split("-").map(Number);
    const [h, m] = b.startTime.split(":").map(Number);
    const startMs = new Date(y, mo - 1, d, h, m).getTime();
    const endMs = startMs + b.duration * 60_000;
    const followupMs = endMs + 60 * 60_000;
    if (now.getTime() >= followupMs) {
      b.followupSent = true;
      await upsertBooking(b);
      await bot.api.sendMessage(
        b.userId,
        `✨ Thanks for your visit to GlowEr! How was your *${b.serviceTitle}* experience?\n\nLeave a review to help others:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✍️ Leave a review", callback_data: "followup:review:now" },
                { text: "⏰ Later", callback_data: "followup:review:later" },
              ],
              [{ text: "⏭ Skip", callback_data: "followup:review:skip" }],
              [{ text: "⬅️ Back to menu", callback_data: "menu:main" }],
            ],
          },
        },
      ).catch(() => {});
    }
  }
}

let _started = false;
export function startFollowupCheck(bot: Bot<Ctx>): void {
  if (_started) return;
  _started = true;
  checkFollowups(bot).catch(() => {});
  setInterval(() => checkFollowups(bot).catch(() => {}), FOLLOWUP_CHECK_INTERVAL);
}

export default composer;
