import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "../toolkit/index.js";
import {
  getServices,
  getService,
  getBookings,
  upsertBooking,
  getUser,
  upsertUser,
  getUserBookings,
  getAdmins,
  getSettings,
  ensureDefaults,
  type Booking,
} from "../store.js";

registerMainMenuItem({ label: "📅 Book service", data: "booking:start", order: 10 });

const composer = new Composer<Ctx>();

const BACK = [[inlineButton("⬅️ Back to menu", "menu:main")]];
const BACK_TO_BOOKING = [[inlineButton("⬅️ Back to services", "booking:start")]];

function id(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function notifyAdmins(ctx: Ctx, text: string): Promise<void> {
  const admins = await getAdmins();
  for (const a of admins) {
    await ctx.api.sendMessage(a.userId, text).catch(() => {});
  }
}

// ── Calendar helpers ───────────────────────────────────────────────────────────

function calendarKeyboard(year: number, month: number, selected?: string): ReturnType<typeof inlineKeyboard> {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  const header = [
    inlineButton("←", `booking:date:prev:${year}:${month}`),
    inlineButton(`${firstDay.toLocaleString("en", { month: "long" })} ${year}`, "booking:date:header"),
    inlineButton("→", `booking:date:next:${year}:${month}`),
  ];

  const dowRow = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) =>
    inlineButton(d, "booking:date:dow"),
  );

  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [header, dowRow];
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let week: ReturnType<typeof inlineKeyboard>["inline_keyboard"][number] = [];
  // Adjust: Mo=0 ... Su=6, but JS getDay: Su=0 ... Sa=6
  const monOffset = startDow === 0 ? 7 : startDow; // 1=Mon ... 7=Sun
  for (let i = 1; i < monOffset; i++) {
    week.push(inlineButton(" ", "booking:date:empty"));
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const past = ds < todayStr;
    const isSelected = ds === selected;
    const label = isSelected ? `[${d}]` : past ? `✗${d}` : `${d}`;
    week.push(inlineButton(label, past ? "booking:date:past" : `booking:date:select:${ds}`));
    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(inlineButton(" ", "booking:date:empty"));
    rows.push(week);
  }
  rows.push([inlineButton("⬅️ Back to services", "booking:start")]);
  return inlineKeyboard(rows);
}

// ── Time slot helpers ──────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

async function getAvailableSlots(
  date: string,
  durationMin: number,
): Promise<string[]> {
  const settings = await getSettings();
  const dayName = new Date(date).toLocaleString("en", { weekday: "short" }).toLowerCase() as keyof typeof settings.businessHours;
  const hours = settings.businessHours[dayName];
  if (!hours) return []; // closed

  const [open, close] = hours;
  const openMin = timeToMinutes(open);
  const closeMin = timeToMinutes(close);
  const slotSize = settings.slotMinutes;

  const bookings = await getBookings();
  const dayBookings = bookings.filter(
    (b) => b.date === date && b.status === "confirmed",
  );

  const slots: string[] = [];
  for (let m = openMin; m + durationMin <= closeMin; m += slotSize) {
    const slotStart = m;
    const slotEnd = m + durationMin;
    let blocked = false;
    for (const b of dayBookings) {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = bStart + b.duration;
      if (slotStart < bEnd && slotEnd > bStart) {
        blocked = true;
        break;
      }
    }
    if (!blocked) slots.push(minutesToTime(slotStart));
  }
  return slots;
}

function slotsKeyboard(slots: string[]): ReturnType<typeof inlineKeyboard> {
  if (slots.length === 0) {
    return inlineKeyboard([
      [inlineButton("No slots available", "booking:no_slots")],
      [inlineButton("⬅️ Pick another date", "booking:start")],
    ]);
  }
  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [];
  for (let i = 0; i < slots.length; i += 3) {
    rows.push(slots.slice(i, i + 3).map((s) => inlineButton(s, `booking:time:${s}`)));
  }
  rows.push([inlineButton("⬅️ Pick another date", "booking:select_date")]);
  return inlineKeyboard(rows);
}

// ── Booking flow ───────────────────────────────────────────────────────────────

composer.callbackQuery("booking:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureDefaults();
  ctx.session.bookingStep = "select_service";
  ctx.session.bookingServiceId = undefined;
  ctx.session.bookingDate = undefined;
  ctx.session.bookingTime = undefined;
  ctx.session.bookingContactName = undefined;
  ctx.session.bookingContactPhone = undefined;
  ctx.session.bookingNotes = undefined;

  const services = await getServices();
  const active = services.filter((s) => s.active);
  if (active.length === 0) {
    await ctx.editMessageText("No services available right now. Check back soon!", {
      reply_markup: inlineKeyboard(BACK),
    });
    return;
  }
  const rows = active.map((s) => [
    inlineButton(
      `${s.title} — $${s.price} (${s.duration} min)`,
      `booking:service:${s.id}`,
    ),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText("📅 Pick a service to book:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^booking:service:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  const svc = await getService(serviceId);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  ctx.session.bookingServiceId = serviceId;
  ctx.session.bookingStep = "select_date";

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  await ctx.editMessageText(
    `📅 *${svc.title}*\n${svc.description}\n\n💰 $${svc.price}  ⏱️ ${svc.duration} min\n\nPick a date:`,
    {
      parse_mode: "Markdown",
      reply_markup: calendarKeyboard(year, month),
    },
  );
});

// Calendar navigation
composer.callbackQuery(/^booking:date:prev:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  let year = parseInt(ctx.match[1]);
  let month = parseInt(ctx.match[2]);
  month--;
  if (month < 0) { month = 11; year--; }
  await ctx.editMessageReplyMarkup({ reply_markup: calendarKeyboard(year, month, ctx.session.bookingDate) });
});

composer.callbackQuery(/^booking:date:next:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  let year = parseInt(ctx.match[1]);
  let month = parseInt(ctx.match[2]);
  month++;
  if (month > 11) { month = 0; year++; }
  await ctx.editMessageReplyMarkup({ reply_markup: calendarKeyboard(year, month, ctx.session.bookingDate) });
});

composer.callbackQuery("booking:date:header", async (ctx) => {
  await ctx.answerCallbackQuery();
});

composer.callbackQuery("booking:date:dow", async (ctx) => {
  await ctx.answerCallbackQuery();
});

composer.callbackQuery("booking:date:empty", async (ctx) => {
  await ctx.answerCallbackQuery();
});

composer.callbackQuery("booking:date:past", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Cannot book past dates." });
});

composer.callbackQuery(/^booking:date:select:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const date = ctx.match[1];
  const serviceId = ctx.session.bookingServiceId;
  if (!serviceId) {
    await ctx.editMessageText("Start again from the menu.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  const svc = await getService(serviceId);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }

  // Check if it's a valid business day
  const dayName = new Date(date).toLocaleString("en", { weekday: "short" }).toLowerCase() as string;
  const settings = await getSettings();
  const hours = (settings.businessHours as Record<string, [string, string] | null>)[dayName];
  if (!hours) {
    await ctx.editMessageText("The studio is closed on that day. Pick another date:", {
      reply_markup: calendarKeyboard(new Date(date).getFullYear(), new Date(date).getMonth()),
    });
    return;
  }

  ctx.session.bookingDate = date;
  ctx.session.bookingStep = "select_time";

  const slots = await getAvailableSlots(date, svc.duration);
  await ctx.editMessageText(
    `📅 *${svc.title}* on ${date}\n\nPick a time slot:`,
    { parse_mode: "Markdown", reply_markup: slotsKeyboard(slots) },
  );
});

composer.callbackQuery("booking:select_date", async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = ctx.session.bookingServiceId;
  if (!serviceId) {
    await ctx.editMessageText("Start again from the menu.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  const svc = await getService(serviceId);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  ctx.session.bookingDate = undefined;
  ctx.session.bookingStep = "select_date";
  const now = new Date();
  await ctx.editMessageText(
    `📅 *${svc.title}*\n\nPick a date:`,
    {
      parse_mode: "Markdown",
      reply_markup: calendarKeyboard(now.getFullYear(), now.getMonth()),
    },
  );
});

composer.callbackQuery(/^booking:time:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const time = ctx.match[1];
  const serviceId = ctx.session.bookingServiceId;
  const date = ctx.session.bookingDate;
  if (!serviceId || !date) {
    await ctx.editMessageText("Start again from the menu.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  const svc = await getService(serviceId);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }

  ctx.session.bookingTime = time;
  ctx.session.bookingStep = "enter_contact";

  const user = await getUser(ctx.from!.id);
  const name = ctx.from!.first_name || "there";
  ctx.session.bookingContactName = user?.name || name;
  ctx.session.bookingContactPhone = user?.phoneNumber || "";

  await ctx.editMessageText(
    `📅 *${svc.title}*\n🗓 ${date} at ${time}\n⏱️ ${svc.duration} min\n💰 $${svc.price}\n\nEnter your contact name:`,
    {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard([
        [inlineButton(ctx.session.bookingContactName || "Use my Telegram name", "booking:use_tg_name")],
        [inlineButton("⬅️ Back to time slots", "booking:select_date")],
      ]),
    },
  );
});

composer.callbackQuery("booking:use_tg_name", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.bookingContactName = ctx.from!.first_name || "there";
  ctx.session.bookingStep = "enter_contact";
  await ctx.editMessageText(
    `Name: ${ctx.session.bookingContactName}\n\nNow enter your phone number (or tap Skip):`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip", "booking:skip_phone")],
        [inlineButton("⬅️ Back", "booking:start")],
      ]),
    },
  );
});

composer.callbackQuery("booking:skip_phone", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.bookingContactPhone = "";
  ctx.session.bookingStep = "enter_notes";
  await ctx.editMessageText(
    "Add a note for the appointment (or tap Skip):",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip", "booking:skip_notes")],
        [inlineButton("⬅️ Back", "booking:start")],
      ]),
    },
  );
});

composer.callbackQuery("booking:skip_notes", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.bookingNotes = "";
  await showConfirmation(ctx);
});

composer.callbackQuery("booking:no_slots", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "No available slots for this date." });
});

// Handle text inputs during booking flow
composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.bookingStep;
  if (!step || step === "select_service" || step === "select_date" || step === "select_time") {
    return next();
  }

  if (step === "enter_contact") {
    ctx.session.bookingContactName = ctx.message.text;
    ctx.session.bookingStep = "enter_contact";
    await ctx.reply(`Name: ${ctx.message.text}\n\nNow enter your phone number (or tap Skip):`, {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip", "booking:skip_phone")],
        [inlineButton("⬅️ Back", "booking:start")],
      ]),
    });
    return;
  }

  if (step === "enter_notes" || (ctx.session.bookingContactPhone !== undefined && !ctx.session.bookingContactPhone)) {
    // After contact entry, the phone number comes next
    if (!ctx.session.bookingContactPhone && ctx.session.bookingContactPhone !== "") {
      ctx.session.bookingContactPhone = ctx.message.text;
      ctx.session.bookingStep = "enter_notes";
      await ctx.reply("Add a note for the appointment (or tap Skip):", {
        reply_markup: inlineKeyboard([
          [inlineButton("⏭ Skip", "booking:skip_notes")],
          [inlineButton("⬅️ Back", "booking:start")],
        ]),
      });
      return;
    }
    if (step === "enter_notes") {
      ctx.session.bookingNotes = ctx.message.text;
      await showConfirmation(ctx);
      return;
    }
  }
  return next();
});

async function showConfirmation(ctx: Ctx) {
  const serviceId = ctx.session.bookingServiceId;
  const date = ctx.session.bookingDate;
  const time = ctx.session.bookingTime;
  if (!serviceId || !date || !time) {
    await ctx.reply("Start again from the menu.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }
  const svc = await getService(serviceId);
  if (!svc) {
    await ctx.reply("Service not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }

  ctx.session.bookingStep = "confirm";

  let text = "✅ *Confirm your booking*\n\n";
  text += `💅 *${svc.title}*\n`;
  text += `🗓 ${date} at ${time}\n`;
  text += `⏱️ ${svc.duration} min\n`;
  text += `💰 $${svc.price}\n`;
  text += `👤 ${ctx.session.bookingContactName || ctx.from!.first_name}\n`;
  if (ctx.session.bookingContactPhone) text += `📞 ${ctx.session.bookingContactPhone}\n`;
  if (ctx.session.bookingNotes) text += `📝 ${ctx.session.bookingNotes}\n`;

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard("booking:confirm"),
  });
}

composer.callbackQuery("booking:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = ctx.session.bookingServiceId;
  const date = ctx.session.bookingDate;
  const time = ctx.session.bookingTime;
  if (!serviceId || !date || !time) {
    await ctx.editMessageText("Booking expired. Start again from the menu.", {
      reply_markup: inlineKeyboard(BACK),
    });
    return;
  }
  const svc = await getService(serviceId);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK) });
    return;
  }

  // Check for overlapping bookings
  const bookings = await getUserBookings(ctx.from!.id);
  const bookingStart = timeToMinutes(time);
  const bookingEnd = bookingStart + svc.duration;
  const overlap = bookings.find((b) => {
    if (b.date !== date || b.status === "cancelled") return false;
    const bStart = timeToMinutes(b.startTime);
    const bEnd = bStart + b.duration;
    return bookingStart < bEnd && bookingEnd > bStart;
  });
  if (overlap) {
    await ctx.editMessageText(
      "You already have a booking that overlaps with this time. Please pick a different time.",
      { reply_markup: inlineKeyboard(BACK_TO_BOOKING) },
    );
    return;
  }

  const booking: Booking = {
    id: id(),
    userId: ctx.from!.id,
    userName: ctx.session.bookingContactName || ctx.from!.first_name || "Client",
    serviceId: serviceId,
    serviceTitle: svc.title,
    date,
    startTime: time,
    duration: svc.duration,
    status: "confirmed",
    notes: ctx.session.bookingNotes || "",
    contactName: ctx.session.bookingContactName || ctx.from!.first_name || "Client",
    contactPhone: ctx.session.bookingContactPhone || "",
    createdAt: new Date().toISOString(),
    followupSent: false,
  };
  await upsertBooking(booking);

  // Save user info
  await upsertUser({
    userId: ctx.from!.id,
    name: booking.contactName,
    phoneNumber: booking.contactPhone || undefined,
    timezone: ctx.session.timezone,
  });

  // Clear session booking state
  ctx.session.bookingStep = undefined;
  ctx.session.bookingServiceId = undefined;
  ctx.session.bookingDate = undefined;
  ctx.session.bookingTime = undefined;
  ctx.session.bookingContactName = undefined;
  ctx.session.bookingContactPhone = undefined;
  ctx.session.bookingNotes = undefined;

  const confirmText = `✅ *Booking confirmed!*\n\n💅 ${svc.title}\n🗓 ${date} at ${time}\n⏱️ ${svc.duration} min\n💰 $${svc.price}\n\nYour booking ID: \`${booking.id}\`\n\nWe look forward to seeing you!`;
  await ctx.editMessageText(confirmText, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(BACK),
  });

  // Notify admins
  const adminMsg = `🆕 *New Booking*\n\n💅 ${svc.title}\n👤 ${booking.contactName}${booking.contactPhone ? `\n📞 ${booking.contactPhone}` : ""}\n🗓 ${date} at ${time}\n⏱️ ${svc.duration} min\n💰 $${svc.price}\n📝 ${booking.notes || "—"}\n\nID: \`${booking.id}\``;
  await notifyAdmins(ctx, adminMsg);

  // Schedule follow-up (1 hour after appointment ends)
  const endTime = bookingStart + svc.duration;
  const [yearStr, monthStr, dayStr] = date.split("-").map(Number);
  const endDate = new Date(yearStr, monthStr - 1, dayStr, Math.floor(endTime / 60), endTime % 60);
  const followupAt = endDate.getTime() + 60 * 60 * 1000; // 1 hour after end
  const delay = followupAt - Date.now();
  if (delay > 0) {
    setTimeout(() => scheduleFollowup(booking.id, ctx), delay);
  }
});

composer.callbackQuery("booking:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Booking cancelled. Start again anytime.", {
    reply_markup: inlineKeyboard(BACK),
  });
});

// ── Follow-up scheduler ────────────────────────────────────────────────────────

async function scheduleFollowup(bookingId: string, ctx: Ctx) {
  const booking = await (await import("../store.js")).getBooking(bookingId);
  if (!booking || booking.status !== "confirmed" || booking.followupSent) return;

  await ctx.api.sendMessage(
    booking.userId,
    `✨ Thanks for your visit to GlowEr! How was your *${booking.serviceTitle}* experience?\n\nLeave a review to help others:`,
    {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard([
        [inlineButton("✍️ Leave a review", "followup:review:now")],
        [inlineButton("⏰ Later", "followup:review:later")],
        [inlineButton("⏭ Skip", "followup:review:skip")],
      ]),
    },
  ).catch(() => {});
}

export { scheduleFollowup };
export default composer;
