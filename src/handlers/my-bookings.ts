// "My bookings" — list the current user's upcoming and past bookings, with
// cancel buttons for upcoming confirmed ones.

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getService, getSettings, listBookingsForUser } from "../storage/store.js";
import { formatDuration, formatPrice } from "../util/format.js";
import { fmtDateLabel, fmtTime } from "../util/dates.js";
import type { Booking } from "../types.js";

registerMainMenuItem({ label: "📋 My bookings", data: "mb:l", order: 30 });

const composer = new Composer<Ctx>();
const PER_PAGE = 5;

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

async function renderBookingsList(ctx: Ctx, edit = true): Promise<void> {
  const userId = ctx.from!.id;
  const all = await listBookingsForUser(userId);
  const now = Date.now();
  const upcoming = all.filter(
    (b) => b.startEpochMs > now && b.status === "confirmed",
  );
  const past = all.filter(
    (b) => b.startEpochMs <= now || b.status !== "confirmed",
  );
  const settings = await getSettings();
  const lines: string[] = [];
  const rows: { text: string; callback_data: string }[][] = [];

  function fmtRow(b: Booking): string {
    const dateLabel = fmtDateLabel(b.startEpochMs, settings.timezone);
    const timeLabel = fmtTime(b.startEpochMs, settings.timezone);
    return `🗓 ${dateLabel} ${timeLabel} · ${formatDuration(b.durationMinutes)} · ${b.status}`;
  }

  if (upcoming.length > 0) {
    lines.push(`<b>Upcoming (${upcoming.length})</b>`);
    for (const b of upcoming.slice(0, 5)) lines.push(fmtRow(b));
  } else {
    lines.push("No upcoming bookings.");
  }

  if (past.length > 0) {
    lines.push(`\n<b>Past (${past.length})</b>`);
    for (const b of past.slice(0, 5)) lines.push(fmtRow(b));
  }

  if (upcoming.length > 0) {
    for (const b of upcoming.slice(0, 5)) {
      const svc = await getService(b.serviceId);
      const title = svc?.title ?? "(deleted service)";
      rows.push([
        inlineButton(
          `❌ Cancel ${title}`,
          `mb:x:${b.id}`,
        ),
      ]);
    }
  }
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  const text = lines.join("\n");
  if (edit) {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard(rows),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard(rows),
    });
  }
}

composer.callbackQuery("mb:l", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderBookingsList(ctx);
});

composer.callbackQuery(/^mb:x:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const bookings = await listBookingsForUser(ctx.from!.id);
  const b = bookings.find((x) => x.id === id);
  if (!b) {
    await ctx.editMessageText("Booking not found.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const svc = await getService(b.serviceId);
  const settings = await getSettings();
  const dateLabel = fmtDateLabel(b.startEpochMs, settings.timezone);
  const timeLabel = fmtTime(b.startEpochMs, settings.timezone);
  await ctx.editMessageText(
    `Cancel this booking?\n\n` +
      `💅 ${svc?.title ?? "(deleted service)"}\n` +
      `📆 ${dateLabel} · 🕐 ${timeLabel}\n` +
      `💶 ${svc ? formatPrice(svc.priceCents) : "—"}\n\n` +
      `This cannot be undone.`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("✅ Yes, cancel", `bk:x:${id}`),
          inlineButton("Keep it", "mb:l"),
        ],
      ]),
    },
  );
});

export default composer;