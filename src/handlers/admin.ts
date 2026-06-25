// /admin command + admin menu. Admins manage services, portfolio, bookings,
// reviews, and settings here. Routes are gated by isAdmin() — non-admins see a
// "not authorized" toast and the callback short-circuits.
//
// Callback prefixes used here (kept short to fit 64-byte Telegram limit):
//   ad:m              admin menu
//   ad:sv             services list
//   ad:sv:n           start new service
//   ad:sv:e:<id>      edit service <id>
//   ad:sv:e:<id>:t    edit title
//   ad:sv:e:<id>:d    edit description
//   ad:sv:e:<id>:p    edit price
//   ad:sv:e:<id>:m    edit duration
//   ad:sv:e:<id>:a    toggle active
//   ad:pf             portfolio list
//   ad:pf:n           start new portfolio item (awaiting photo)
//   ad:pf:e:<id>      edit portfolio item <id>
//   ad:pf:d:<id>      delete portfolio item <id>
//   ad:bkg            bookings list
//   ad:bkg:c:<id>     cancel booking <id>
//   ad:rv             reviews list
//   ad:rv:r:<id>      reply to review <id>
//   ad:rv:d:<id>      delete review <id>
//   ad:st             settings menu
//   ad:st:tz          edit timezone
//   ad:st:cn          edit contact info
//   ad:st:nm          edit studio name
//   ad:st:ad          manage admin list

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  createPortfolio,
  createService,
  deletePortfolio,
  getReview,
  getService,
  getSettings,
  isAdmin,
  listBookings,
  listPortfolio,
  listReviews,
  listServices,
  updateBooking,
  updateReview,
  updateService,
  updateSettings,
} from "../storage/store.js";
import { escapeHtml } from "../util/format.js";
import { fmtDateLabel, fmtTime } from "../util/dates.js";

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}
function backToAdmin() {
  return inlineKeyboard([[inlineButton("⬅️ Admin menu", "ad:m")]]);
}

/** Gate every admin callback behind isAdmin(). */
async function gateAdmin(ctx: Ctx): Promise<boolean> {
  if (!ctx.from) return false;
  const ok = await isAdmin(ctx.from.id);
  if (!ok) {
    await ctx.answerCallbackQuery({
      text: "Admins only.",
      show_alert: true,
    });
    return false;
  }
  return true;
}

async function renderAdminMenu(ctx: Ctx): Promise<void> {
  const text =
    `<b>Admin menu</b>\n\n` +
    `Manage services, portfolio, bookings, reviews, and studio settings.`;
  const keyboard = inlineKeyboard([
    [
      inlineButton("💅 Services", "ad:sv"),
      inlineButton("🖼 Portfolio", "ad:pf"),
    ],
    [
      inlineButton("📅 Bookings", "ad:bkg"),
      inlineButton("⭐ Reviews", "ad:rv"),
    ],
    [inlineButton("⚙️ Settings", "ad:st")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

composer.command("admin", async (ctx) => {
  if (!ctx.from) return;
  if (!(await isAdmin(ctx.from.id))) {
    await ctx.reply("This command is for studio admins only.");
    return;
  }
  await renderAdminMenu(ctx);
});

composer.callbackQuery("ad:m", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderAdminMenu(ctx);
});

// ─────────────── Services admin ───────────────

async function renderServicesAdmin(ctx: Ctx): Promise<void> {
  const svcs = await listServices(false);
  const lines: string[] = [`<b>Services</b> (${svcs.length})`];
  for (const s of svcs) {
    const flag = s.active ? "✅" : "⏸";
    lines.push(
      `${flag} <b>${escapeHtml(s.title)}</b> · ${s.durationMinutes}m · ${(s.priceCents / 100).toFixed(2)} EUR`,
    );
  }
  const rows: { text: string; callback_data: string }[][] = [];
  for (const s of svcs) {
    rows.push([inlineButton(`${s.active ? "✏️" : "▶️"} ${s.title}`, `ad:sv:e:${s.id}`)]);
  }
  rows.push([inlineButton("➕ New service", "ad:sv:n")]);
  rows.push([inlineButton("⬅️ Admin menu", "ad:m")]);
  await ctx.editMessageText(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery("ad:sv", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderServicesAdmin(ctx);
});

composer.callbackQuery("ad:sv:n", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminDraft = { kind: "service_new", step: "title" };
  await ctx.editMessageText(
    "Send the new service title.",
    { reply_markup: backToAdmin() },
  );
});

composer.callbackQuery(/^ad:sv:e:(\d+)$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const s = await getService(id);
  if (!s) {
    await ctx.editMessageText("Service not found.", { reply_markup: backToAdmin() });
    return;
  }
  await ctx.editMessageText(
    `<b>${escapeHtml(s.title)}</b>\n\n` +
      `${escapeHtml(s.description)}\n\n` +
      `⏱ ${s.durationMinutes}m · 💶 ${(s.priceCents / 100).toFixed(2)} EUR\n` +
      `Status: ${s.active ? "✅ Active" : "⏸ Hidden"}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("✏️ Title", `ad:sv:e:${s.id}:t`)],
        [inlineButton("✏️ Description", `ad:sv:e:${s.id}:d`)],
        [inlineButton("✏️ Price (cents)", `ad:sv:e:${s.id}:p`)],
        [inlineButton("✏️ Duration (min)", `ad:sv:e:${s.id}:m`)],
        [
          inlineButton(
            s.active ? "⏸ Deactivate" : "▶️ Activate",
            `ad:sv:e:${s.id}:a`,
          ),
        ],
        [inlineButton("⬅️ Back", "ad:sv")],
      ]),
    },
  );
});

composer.callbackQuery(/^ad:sv:e:(\d+):([tdpma])$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const field = ctx.match![2]!;
  const fieldName = { t: "title", d: "description", p: "price", m: "duration", a: "active" }[field];
  if (!fieldName || field === "a") return; // 'a' is toggle, not prompt
  ctx.session.adminDraft = {
    kind: "service_edit",
    targetId: id,
    step: fieldName,
  };
  const prompt = {
    title: "Send the new title.",
    description: "Send the new description.",
    price: "Send the new price in cents (e.g. 5000 = 50.00 EUR).",
    duration: "Send the new duration in minutes (e.g. 60).",
  }[fieldName];
  await ctx.editMessageText(prompt!, { reply_markup: backToAdmin() });
});

composer.callbackQuery(/^ad:sv:e:(\d+):a$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  const id = parseInt(ctx.match![1]!, 10);
  const s = await getService(id);
  if (!s) {
    await ctx.answerCallbackQuery({ text: "Not found", show_alert: true });
    return;
  }
  await updateService(id, { active: !s.active });
  await ctx.answerCallbackQuery({ text: s.active ? "Hidden" : "Activated" });
  // Re-render the edit view.
  const next = await getService(id);
  if (next) {
    await ctx.editMessageText(
      `<b>${escapeHtml(next.title)}</b>\n\n` +
        `${escapeHtml(next.description)}\n\n` +
        `⏱ ${next.durationMinutes}m · 💶 ${(next.priceCents / 100).toFixed(2)} EUR\n` +
        `Status: ${next.active ? "✅ Active" : "⏸ Hidden"}`,
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([
          [inlineButton("✏️ Title", `ad:sv:e:${next.id}:t`)],
          [inlineButton("✏️ Description", `ad:sv:e:${next.id}:d`)],
          [inlineButton("✏️ Price (cents)", `ad:sv:e:${next.id}:p`)],
          [inlineButton("✏️ Duration (min)", `ad:sv:e:${next.id}:m`)],
          [
            inlineButton(
              next.active ? "⏸ Deactivate" : "▶️ Activate",
              `ad:sv:e:${next.id}:a`,
            ),
          ],
          [inlineButton("⬅️ Back", "ad:sv")],
        ]),
      },
    );
  }
});

// ─────────────── Portfolio admin ───────────────

async function renderPortfolioAdmin(ctx: Ctx): Promise<void> {
  const items = await listPortfolio();
  const lines: string[] = [`<b>Portfolio</b> (${items.length})`];
  for (const it of items.slice(0, 8)) {
    lines.push(
      `🖼 #${it.id} ${escapeHtml((it.caption ?? "(no caption)").slice(0, 40))}` +
        (it.serviceIds.length > 0 ? ` · ${it.serviceIds.length} tag(s)` : ""),
    );
  }
  if (items.length > 8) lines.push(`… and ${items.length - 8} more`);
  const rows: { text: string; callback_data: string }[][] = [];
  for (const it of items.slice(0, 8)) {
    rows.push([inlineButton(`🗑 #${it.id}`, `ad:pf:d:${it.id}`)]);
  }
  rows.push([inlineButton("➕ Upload photo", "ad:pf:n")]);
  rows.push([inlineButton("⬅️ Admin menu", "ad:m")]);
  await ctx.editMessageText(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery("ad:pf", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderPortfolioAdmin(ctx);
});

composer.callbackQuery("ad:pf:n", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminDraft = { kind: "portfolio_new", step: "photo" };
  await ctx.editMessageText(
    "Send the photo to add to the portfolio (with optional caption).",
    { reply_markup: backToAdmin() },
  );
});

composer.callbackQuery(/^ad:pf:d:(\d+)$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  const id = parseInt(ctx.match![1]!, 10);
  await deletePortfolio(id);
  await ctx.answerCallbackQuery({ text: "Deleted" });
  await renderPortfolioAdmin(ctx);
});

// ─────────────── Bookings admin ───────────────

async function renderBookingsAdmin(ctx: Ctx): Promise<void> {
  const all = await listBookings();
  const now = Date.now();
  const upcoming = all.filter((b) => b.startEpochMs > now && b.status === "confirmed");
  const past = all.filter((b) => b.startEpochMs <= now || b.status !== "confirmed");
  const lines: string[] = [`<b>Bookings</b> (${all.length})`];
  const settings = await getSettings();
  lines.push(`\n<b>Upcoming (${upcoming.length})</b>`);
  for (const b of upcoming.slice(0, 8)) {
    const svc = await getService(b.serviceId);
    const dl = fmtDateLabel(b.startEpochMs, settings.timezone);
    const tl = fmtTime(b.startEpochMs, settings.timezone);
    lines.push(
      `#${b.id} · ${dl} ${tl} · ${svc?.title ?? "?"} · user <code>${b.userId}</code>`,
    );
  }
  lines.push(`\n<b>Past (${past.length})</b>`);
  for (const b of past.slice(0, 5)) {
    const svc = await getService(b.serviceId);
    const dl = fmtDateLabel(b.startEpochMs, settings.timezone);
    lines.push(
      `#${b.id} · ${dl} · ${svc?.title ?? "?"} · ${b.status} · user <code>${b.userId}</code>`,
    );
  }
  const rows: { text: string; callback_data: string }[][] = [];
  for (const b of upcoming.slice(0, 8)) {
    rows.push([inlineButton(`❌ Cancel #${b.id}`, `ad:bkg:c:${b.id}`)]);
  }
  rows.push([inlineButton("⬅️ Admin menu", "ad:m")]);
  await ctx.editMessageText(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery("ad:bkg", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderBookingsAdmin(ctx);
});

composer.callbackQuery(/^ad:bkg:c:(\d+)$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  const id = parseInt(ctx.match![1]!, 10);
  await updateBooking(id, { status: "cancelled_by_admin" });
  await ctx.answerCallbackQuery({ text: "Cancelled" });
  await renderBookingsAdmin(ctx);
});

// ─────────────── Reviews moderation ───────────────

async function renderReviewsAdmin(ctx: Ctx): Promise<void> {
  const all = await listReviews(false);
  const lines: string[] = [`<b>Reviews</b> (${all.length})`];
  for (const r of all.slice(0, 10)) {
    const flag = r.visible ? "✅" : "🚫";
    lines.push(
      `${flag} #${r.id} · ${escapeHtml(r.text.slice(0, 60))} · user <code>${r.userId}</code>`,
    );
  }
  if (all.length > 10) lines.push(`… and ${all.length - 10} more`);
  const rows: { text: string; callback_data: string }[][] = [];
  for (const r of all.slice(0, 10)) {
    rows.push([
      inlineButton(`💬 ${r.id}`, `ad:rv:r:${r.id}`),
      inlineButton(`🗑 ${r.id}`, `ad:rv:d:${r.id}`),
    ]);
  }
  rows.push([inlineButton("⬅️ Admin menu", "ad:m")]);
  await ctx.editMessageText(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery("ad:rv", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderReviewsAdmin(ctx);
});

composer.callbackQuery(/^ad:rv:r:(\d+)$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const r = await getReview(id);
  if (!r) {
    await ctx.editMessageText("Review not found.", { reply_markup: backToAdmin() });
    return;
  }
  ctx.session.adminDraft = { kind: "review_reply", targetId: id, step: "text" };
  await ctx.editMessageText(
    `Reply to review #${id}:\n\n<i>${escapeHtml(r.text)}</i>\n\n` +
      `Send your reply (or tap Skip to remove existing reply).`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("Skip reply", `ad:rv:rskip:${id}`)],
        [inlineButton("⬅️ Cancel", "ad:rv")],
      ]),
    },
  );
});

composer.callbackQuery(/^ad:rv:rskip:(\d+)$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  await updateReview(id, { adminReply: undefined });
  await ctx.answerCallbackQuery({ text: "Reply removed" });
  await renderReviewsAdmin(ctx);
});

composer.callbackQuery(/^ad:rv:d:(\d+)$/, async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  const id = parseInt(ctx.match![1]!, 10);
  const r = await getReview(id);
  if (!r) return;
  const nextVisible = !r.visible;
  await updateReview(id, { visible: nextVisible });
  await ctx.answerCallbackQuery({ text: nextVisible ? "Restored" : "Hidden" });
  await renderReviewsAdmin(ctx);
});

// ─────────────── Settings ───────────────

async function renderSettings(ctx: Ctx): Promise<void> {
  const s = await getSettings();
  await ctx.editMessageText(
    `<b>Settings</b>\n\n` +
      `🏷 Studio: ${escapeHtml(s.studioName)}\n` +
      `🕒 Timezone: <code>${escapeHtml(s.timezone)}</code>\n` +
      `📞 Contact: ${escapeHtml(s.contactInfo)}\n` +
      `👥 Admins: ${s.adminIds.length === 0 ? "(none)" : s.adminIds.map((id) => `<code>${id}</code>`).join(", ")}\n\n` +
      `Business hours & slot length live in code defaults — ask the dev to change them.`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("🏷 Studio name", "ad:st:nm")],
        [inlineButton("🕒 Timezone", "ad:st:tz")],
        [inlineButton("📞 Contact info", "ad:st:cn")],
        [inlineButton("⬅️ Admin menu", "ad:m")],
      ]),
    },
  );
}

composer.callbackQuery("ad:st", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderSettings(ctx);
});

composer.callbackQuery("ad:st:nm", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminDraft = { kind: "settings", step: "studioName" };
  await ctx.editMessageText("Send the new studio name.", {
    reply_markup: backToAdmin(),
  });
});
composer.callbackQuery("ad:st:tz", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminDraft = { kind: "settings", step: "timezone" };
  await ctx.editMessageText(
    "Send an IANA timezone (e.g. <code>Europe/Berlin</code>, <code>America/New_York</code>).",
    { parse_mode: "HTML", reply_markup: backToAdmin() },
  );
});
composer.callbackQuery("ad:st:cn", async (ctx) => {
  if (!(await gateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminDraft = { kind: "settings", step: "contactInfo" };
  await ctx.editMessageText("Send the new contact info line.", {
    reply_markup: backToAdmin(),
  });
});

// ─────────────── Free-form text during admin drafts ───────────────
//
// One handler so the three drafts (new service, edit service, settings) +
// portfolio photo + review reply + new-service continue don't conflict.

composer.on("message:text", async (ctx, next) => {
  const draft = ctx.session.adminDraft;
  if (!draft) return next();

  // 1) Service new: title → desc → price → duration → save.
  if (draft.kind === "service_new" && draft.step === "title") {
    draft.buffer = { title: ctx.message.text.slice(0, 80) };
    draft.step = "description";
    await ctx.reply("Send the description.");
    return;
  }
  if (draft.kind === "service_new" && draft.step === "description") {
    const buf = (draft.buffer ?? {}) as Record<string, unknown>;
    buf.description = ctx.message.text.slice(0, 400);
    draft.step = "price";
    await ctx.reply("Send the price in cents (e.g. 5000 = 50.00 EUR).");
    return;
  }
  if (draft.kind === "service_new" && draft.step === "price") {
    const cents = parseInt(ctx.message.text.trim(), 10);
    if (!Number.isFinite(cents) || cents < 0) {
      await ctx.reply("That doesn't look like a number. Try again.");
      return;
    }
    const buf = (draft.buffer ?? {}) as Record<string, unknown>;
    buf.priceCents = cents;
    draft.step = "duration";
    await ctx.reply("Send the duration in minutes (e.g. 60).");
    return;
  }
  if (draft.kind === "service_new" && draft.step === "duration") {
    const minutes = parseInt(ctx.message.text.trim(), 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      await ctx.reply("That doesn't look like a number. Try again.");
      return;
    }
    const buf = (draft.buffer ?? {}) as Record<string, unknown>;
    buf.durationMinutes = minutes;
    const svc = await createService({
      title: String(buf.title ?? "Untitled"),
      description: String(buf.description ?? ""),
      priceCents: Number(buf.priceCents ?? 0),
      durationMinutes: Number(buf.durationMinutes ?? 60),
      active: true,
    });
    ctx.session.adminDraft = undefined;
    await ctx.reply(
      `✅ Service created: <b>${escapeHtml(svc.title)}</b> (#${svc.id})`,
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([
          [inlineButton("💅 Services", "ad:sv")],
          [inlineButton("⬅️ Admin menu", "ad:m")],
        ]),
      },
    );
    return;
  }

  // 2) Service edit.
  if (draft.kind === "service_edit" && draft.targetId !== undefined) {
    const id = draft.targetId;
    const step = draft.step;
    const text = ctx.message.text.slice(0, 1000);
    if (step === "title") {
      await updateService(id, { title: text });
    } else if (step === "description") {
      await updateService(id, { description: text });
    } else if (step === "price") {
      const cents = parseInt(text, 10);
      if (!Number.isFinite(cents) || cents < 0) {
        await ctx.reply("That doesn't look like a number. Try again.");
        return;
      }
      await updateService(id, { priceCents: cents });
    } else if (step === "duration") {
      const m = parseInt(text, 10);
      if (!Number.isFinite(m) || m <= 0) {
        await ctx.reply("That doesn't look like a number. Try again.");
        return;
      }
      await updateService(id, { durationMinutes: m });
    }
    ctx.session.adminDraft = undefined;
    const next = await getService(id);
    if (next) {
      await ctx.reply(
        `✅ Updated <b>${escapeHtml(next.title)}</b>`,
        {
          parse_mode: "HTML",
          reply_markup: inlineKeyboard([
            [inlineButton("✏️ Continue editing", `ad:sv:e:${id}`)],
            [inlineButton("⬅️ Admin menu", "ad:m")],
          ]),
        },
      );
    } else {
      await ctx.reply("Service disappeared.", { reply_markup: backToAdmin() });
    }
    return;
  }

  // 3) Settings edit.
  if (draft.kind === "settings" && draft.step) {
    const step = draft.step;
    const text = ctx.message.text.slice(0, 400);
    let ok = true;
    if (step === "timezone") {
      // Validate by trying to use it.
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: text }).format(new Date());
      } catch {
        ok = false;
      }
      if (!ok) {
        await ctx.reply("That timezone isn't recognised. Try IANA like Europe/Berlin.");
        return;
      }
      await updateSettings({ timezone: text });
    } else if (step === "studioName") {
      await updateSettings({ studioName: text });
    } else if (step === "contactInfo") {
      await updateSettings({ contactInfo: text });
    }
    ctx.session.adminDraft = undefined;
    await ctx.reply("✅ Setting saved.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⚙️ Settings", "ad:st")],
        [inlineButton("⬅️ Admin menu", "ad:m")],
      ]),
    });
    return;
  }

  // 4) Review reply.
  if (draft.kind === "review_reply" && draft.targetId !== undefined && draft.step === "text") {
    const id = draft.targetId;
    await updateReview(id, { adminReply: ctx.message.text.slice(0, 500) });
    ctx.session.adminDraft = undefined;
    await ctx.reply("✅ Reply posted.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⭐ Reviews", "ad:rv")],
        [inlineButton("⬅️ Admin menu", "ad:m")],
      ]),
    });
    return;
  }

  return next();
});

// 5) Portfolio photo (admin uploads photo → create item).
composer.on("message:photo", async (ctx, next) => {
  const draft = ctx.session.adminDraft;
  if (draft?.kind !== "portfolio_new") return next();
  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  if (!largest) return next();
  await createPortfolio({
    fileId: largest.file_id,
    caption: ctx.message.caption?.slice(0, 200),
    serviceIds: [],
    createdAt: Date.now(),
  });
  ctx.session.adminDraft = undefined;
  await ctx.reply("✅ Added to portfolio.", {
    reply_markup: inlineKeyboard([
      [inlineButton("🖼 Portfolio", "ad:pf")],
      [inlineButton("⬅️ Admin menu", "ad:m")],
    ]),
  });
});

export default composer;