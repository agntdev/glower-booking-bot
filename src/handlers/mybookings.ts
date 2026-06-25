import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "../toolkit/index.js";
import { getUserBookings, upsertBooking, getBooking } from "../store.js";

registerMainMenuItem({ label: "📋 My bookings", data: "bookings:view", order: 40 });

const composer = new Composer<Ctx>();

const BACK = [[inlineButton("⬅️ Back to menu", "menu:main")]];

composer.callbackQuery("bookings:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const bookings = await getUserBookings(ctx.from!.id);

  if (bookings.length === 0) {
    await ctx.editMessageText(
      "No bookings yet — tap 📅 Book service to get started!",
      { reply_markup: inlineKeyboard(BACK) },
    );
    return;
  }

  const sorted = [...bookings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const rows = sorted.map((b) => {
    const statusIcon = b.status === "confirmed" ? "✅" : b.status === "cancelled" ? "❌" : "✓";
    return [
      inlineButton(
        `${statusIcon} ${b.serviceTitle} — ${b.date} ${b.startTime}`,
        `bookings:detail:${b.id}`,
      ),
    ];
  });
  rows.push(BACK[0]);

  await ctx.editMessageText("📋 *Your Bookings*\n\nTap a booking for details:", {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^bookings:detail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await getBooking(ctx.match[1]);
  if (!booking || booking.userId !== ctx.from!.id) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }

  const status = booking.status === "confirmed"
    ? "✅ Confirmed"
    : booking.status === "cancelled"
      ? "❌ Cancelled"
      : "✓ Completed";

  let text = `📋 *Booking Details*\n\n`;
  text += `💅 ${booking.serviceTitle}\n`;
  text += `🗓 ${booking.date} at ${booking.startTime}\n`;
  text += `⏱️ ${booking.duration} min\n`;
  text += `👤 ${booking.contactName}\n`;
  if (booking.contactPhone) text += `📞 ${booking.contactPhone}\n`;
  if (booking.notes) text += `📝 ${booking.notes}\n`;
  text += `\nStatus: ${status}\n`;
  text += `ID: \`${booking.id}\``;

  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [];
  if (booking.status === "confirmed") {
    rows.push([inlineButton("❌ Cancel booking", `bookings:cancel:${booking.id}`)]);
  }
  rows.push([inlineButton("⬅️ Back to bookings", "bookings:view")]);
  rows.push(BACK[0]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^bookings:cancel:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const bookingId = ctx.match[1];
  const booking = await getBooking(bookingId);
  if (!booking || booking.userId !== ctx.from!.id) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  if (booking.status !== "confirmed") {
    await ctx.editMessageText("This booking can no longer be cancelled.", {
      reply_markup: inlineKeyboard(BACK),
    });
    return;
  }

  await ctx.editMessageText(
    `Cancel your booking for *${booking.serviceTitle}* on ${booking.date} at ${booking.startTime}?`,
    {
      parse_mode: "Markdown",
      reply_markup: confirmKeyboard(`bookings:cancel_confirm:${bookingId}`),
    },
  );
});

composer.callbackQuery(/^bookings:cancel_confirm:(.+):yes$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const bookingId = ctx.match[1];
  const booking = await getBooking(bookingId);
  if (!booking || booking.userId !== ctx.from!.id) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  booking.status = "cancelled";
  await upsertBooking(booking);

  await ctx.editMessageText(
    `✅ Booking cancelled.\n\n${booking.serviceTitle} on ${booking.date} at ${booking.startTime} has been cancelled.`,
    { reply_markup: inlineKeyboard(BACK) },
  );
});

composer.callbackQuery(/^bookings:cancel_confirm:(.+):no$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const bookingId = ctx.match[1];
  const booking = await getBooking(bookingId);
  if (!booking) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  await ctx.editMessageText(`Booking kept.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to bookings", "bookings:view")],
      BACK[0],
    ]),
  });
});

export default composer;