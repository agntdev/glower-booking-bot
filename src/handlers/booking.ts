// Booking flow: service (passed via svc:p → bk:s:<id>) → pick date → pick time
// slot → optional notes → confirm. The booking is committed on confirm; admin
// notifications fire then too.

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  createBooking,
  ensureUser,
  getService,
  getSettings,
  listBookingsForUser,
  takenSlotEpochs,
  updateBooking,
  upsertUser,
} from "../storage/store.js";
import { formatDuration, formatPrice, userLabel } from "../util/format.js";
import {
  bookableDateKeys,
  fmtDateLabel,
  slotsForDate,
} from "../util/dates.js";

const composer = new Composer<Ctx>();

const MAX_DATES_PER_PAGE = 8;

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

/** Show date picker for a given service. Picks first MAX_DATES_PER_PAGE dates
 *  that are open in studio hours. */
async function renderDatePicker(ctx: Ctx, serviceId: number): Promise<void> {
  const svc = await getService(serviceId);
  if (!svc || !svc.active) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const settings = await getSettings();
  const now = Date.now();
  const dateKeys = bookableDateKeys(settings, now).slice(0, MAX_DATES_PER_PAGE);
  const rows: { text: string; callback_data: string }[][] = [];
  for (const key of dateKeys) {
    const epochMs = Date.parse(key + "T12:00:00Z");
    const label = fmtDateLabel(epochMs, settings.timezone);
    rows.push([inlineButton(`📆 ${label}`, `bk:d:${serviceId}:${key}`)]);
  }
  rows.push([inlineButton("⬅️ Back to services", "svc:l")]);
  await ctx.editMessageText(
    `<b>Pick a date for ${svc.title}</b>\n` +
      `(${formatDuration(svc.durationMinutes)} · ${formatPrice(svc.priceCents)})`,
    { parse_mode: "HTML", reply_markup: inlineKeyboard(rows) },
  );
}

/** Show available time slots for the chosen service+date. */
async function renderSlotPicker(ctx: Ctx, serviceId: number, dateKey: string): Promise<void> {
  const svc = await getService(serviceId);
  if (!svc || !svc.active) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const settings = await getSettings();
  const taken = await takenSlotEpochs();
  const slots = slotsForDate(dateKey, settings, Date.now(), taken).filter(
    (s) => s.startEpochMs + svc.durationMinutes * 60_000 > Date.now(),
  );
  const rows: { text: string; callback_data: string }[][] = [];
  if (slots.length === 0) {
    await ctx.editMessageText(
      `No time slots available on ${dateKey}. Try another date.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Pick another date", `bk:s:${serviceId}`)],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  for (const slot of slots) {
    rows.push([
      inlineButton(`🕐 ${slot.timeLabel}`, `bk:t:${serviceId}:${slot.startEpochMs}`),
    ]);
  }
  rows.push([inlineButton("⬅️ Pick another date", `bk:s:${serviceId}`)]);
  await ctx.editMessageText(
    `<b>Pick a time on ${dateKey}</b>\nFor ${svc.title}`,
    { parse_mode: "HTML", reply_markup: inlineKeyboard(rows) },
  );
}

composer.callbackQuery(/^bk:s:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = parseInt(ctx.match![1]!, 10);
  await renderDatePicker(ctx, serviceId);
});

composer.callbackQuery(/^bk:d:(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = parseInt(ctx.match![1]!, 10);
  const dateKey = ctx.match![2]!;
  await renderSlotPicker(ctx, serviceId, dateKey);
});

composer.callbackQuery(/^bk:t:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = parseInt(ctx.match![1]!, 10);
  const startEpochMs = parseInt(ctx.match![2]!, 10);
  const svc = await getService(serviceId);
  if (!svc || !svc.active) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  // Stash the pending booking as a record in Redis (status='confirmed' only on
  // user confirm). Until then we keep it as a sentinel — easier to test than
  // session-only state, and won't conflict because we re-check on commit.
  ctx.session.bookingDraft = {
    serviceId,
    startEpochMs,
  };
  const settings = await getSettings();
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(startEpochMs));
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(startEpochMs));
  await ctx.editMessageText(
    `<b>Confirm appointment</b>\n\n` +
      `💅 ${svc.title}\n` +
      `📆 ${dayLabel}\n` +
      `🕐 ${timeLabel}\n` +
      `⏱ ${formatDuration(svc.durationMinutes)} · 💶 ${formatPrice(svc.priceCents)}\n\n` +
      `Tap "Add notes" to attach a message, or "Confirm" to book now.`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [
          inlineButton("✅ Confirm", `bk:c:${serviceId}:${startEpochMs}`),
          inlineButton("📝 Add notes", `bk:n:${serviceId}:${startEpochMs}`),
        ],
        [inlineButton("⬅️ Pick another time", `bk:s:${serviceId}`)],
      ]),
    },
  );
});

composer.callbackQuery(/^bk:n:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = parseInt(ctx.match![1]!, 10);
  const startEpochMs = parseInt(ctx.match![2]!, 10);
  ctx.session.bookingDraft = { serviceId, startEpochMs, awaitingNotes: true };
  await ctx.editMessageText(
    "Send your note in the next message (or tap Skip to continue without one).",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Skip", `bk:c:${serviceId}:${startEpochMs}`)],
      ]),
    },
  );
});

// Free-form text during booking flow: notes input OR a phone-number capture.
// One handler so the two cases don't fight each other.
composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  const draft = ctx.session.bookingDraft;

  // 1) Awaiting booking notes → store + offer confirm.
  if (draft?.awaitingNotes) {
    draft.notes = text.slice(0, 500);
    draft.awaitingNotes = false;
    await ctx.reply(
      "Got it. Tap Confirm to book, or pick a different time.",
      {
        reply_markup: inlineKeyboard([
          [
            inlineButton(
              "✅ Confirm",
              `bk:c:${draft.serviceId}:${draft.startEpochMs}`,
            ),
          ],
          [
            inlineButton(
              "⬅️ Pick another time",
              `bk:s:${draft.serviceId}`,
            ),
          ],
        ]),
      },
    );
    return;
  }

  // 2) Phone-number capture (only if the text looks like a phone number).
  if (/^[+\d][\d\s\-()]{4,}$/.test(text)) {
    const u = await ensureUser(ctx.from!.id, {
      name: ctx.from!.first_name,
      username: ctx.from!.username,
    });
    await upsertUser({ ...u, phone: text.slice(0, 32) });
    await ctx.reply("Saved. Thanks! 🙏");
    return;
  }

  return next();
});

composer.callbackQuery(/^bk:c:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = parseInt(ctx.match![1]!, 10);
  const startEpochMs = parseInt(ctx.match![2]!, 10);
  const svc = await getService(serviceId);
  if (!svc || !svc.active) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  // Conflict check.
  const taken = await takenSlotEpochs();
  if (taken.has(startEpochMs)) {
    await ctx.editMessageText(
      "Sorry, that slot was just taken. Please pick another.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Pick another time", `bk:s:${serviceId}`)],
        ]),
      },
    );
    return;
  }
  // Ensure user record exists.
  const u = await ensureUser(ctx.from!.id, {
    name: ctx.from!.first_name,
    username: ctx.from!.username,
  });
  // If user has a phone on file, use it; else ask once.
  const draft = ctx.session.bookingDraft;
  const notes = draft?.serviceId === serviceId && draft?.startEpochMs === startEpochMs
    ? draft.notes
    : undefined;
  const booking = await createBooking({
    userId: u.id,
    serviceId,
    startEpochMs,
    durationMinutes: svc.durationMinutes,
    status: "confirmed",
    notes,
    createdAt: Date.now(),
    followUpSent: false,
  });
  ctx.session.bookingDraft = undefined;
  const settings = await getSettings();
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(startEpochMs));
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(startEpochMs));
  await ctx.editMessageText(
    `✅ <b>Booked!</b>\n\n` +
      `💅 ${svc.title}\n` +
      `📆 ${dayLabel}\n` +
      `🕐 ${timeLabel}\n` +
      `${notes ? `📝 Note: ${notes}\n` : ""}` +
      `\nWe'll send a follow-up after your appointment — leave us a review!`,
    { parse_mode: "HTML", reply_markup: backToMenu() },
  );
  // Notify admins (if any). Best-effort: swallow per-admin errors.
  for (const adminId of settings.adminIds) {
    try {
      const userBookings = await listBookingsForUser(u.id);
      const total = userBookings.length;
      await ctx.api.sendMessage(
        adminId,
        `🔔 <b>New booking</b>\n` +
          `👤 ${userLabel(ctx.from)} (<code>${u.id}</code>) — ${total} prior booking${total === 1 ? "" : "s"}\n` +
          `💅 ${svc.title}\n` +
          `📆 ${dayLabel} · 🕐 ${timeLabel}\n` +
          `⏱ ${formatDuration(svc.durationMinutes)} · 💶 ${formatPrice(svc.priceCents)}` +
          (notes ? `\n📝 ${notes}` : ""),
        { parse_mode: "HTML" },
      );
    } catch {
      // ignore — admin may not have started the bot yet
    }
  }
  // If we don't have a phone on file, gently suggest adding one (not blocking).
  if (!u.phone) {
    await ctx.reply(
      "Tip: add a phone number to your profile for faster check-in next time. Just send it here.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Skip", `bk:skip:${booking.id}`)],
        ]),
      },
    );
  }
});

composer.callbackQuery(/^bk:skip:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("No problem. Enjoy your appointment! ✨");
});

// Booking cancellation (re-uses updateBooking). The actual button row lives in
// my-bookings.ts; the confirm callback is here because it's part of the booking
// state machine.
composer.callbackQuery(/^bk:x:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const updated = await updateBooking(id, { status: "cancelled_by_user" });
  if (!updated) {
    await ctx.editMessageText("That booking no longer exists.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  await ctx.editMessageText("❌ Booking cancelled.", {
    reply_markup: backToMenu(),
  });
});

export default composer;