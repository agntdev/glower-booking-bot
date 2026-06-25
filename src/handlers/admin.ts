import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "../toolkit/index.js";
import {
  isAdmin,
  getServices,
  getBooking,
  upsertService,
  deleteService,
  upsertBooking,
  getPortfolioItems,
  getPortfolioItem,
  addPortfolioItem,
  deletePortfolioItem,
  getReviews,
  getReview,
  upsertReview,
  deleteReview,
  getBookings,
  getAdmins,
  saveSettings,
  getSettings,
  type Service,
  type PortfolioItem,
  type Booking,
  type Review,
  type BusinessSettings,
} from "../store.js";
import type { InlineKeyboardMarkup, InlineButton } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

const BACK_ADMIN = [[inlineButton("⬅️ Back to admin menu", "admin:menu")]];
const BACK_MENU = [[inlineButton("⬅️ Back to menu", "menu:main")]];

function adminGuard() {
  return async (ctx: Ctx, next: () => Promise<void>) => {
    if (!(await isAdmin(ctx.from!.id))) {
      await ctx.answerCallbackQuery({ text: "Admin access required." }).catch(() => {});
      return;
    }
    await next();
  };
}

function id(): string {
  return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function notifyAdmins(ctx: Ctx, text: string): Promise<void> {
  const admins = await getAdmins();
  for (const a of admins) {
    await ctx.api.sendMessage(a.userId, text).catch(() => {});
  }
}

// ── /admin command ─────────────────────────────────────────────────────────────

composer.command("admin", async (ctx) => {
  if (!(await isAdmin(ctx.from!.id))) {
    await ctx.reply("Admin access required.");
    return;
  }
  await ctx.reply("🔧 *Admin Panel*\n\nSelect an option:", {
    parse_mode: "Markdown",
    reply_markup: adminMenuKeyboard(),
  });
});

function adminMenuKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("💅 Services", "admin:services")],
    [inlineButton("🖼 Portfolio", "admin:portfolio")],
    [inlineButton("📋 Bookings", "admin:bookings")],
    [inlineButton("⭐ Reviews", "admin:reviews")],
    [inlineButton("⚙️ Settings", "admin:settings")],
    [inlineButton("👥 Admins", "admin:admins")],
    BACK_MENU[0],
  ]);
}

composer.callbackQuery("admin:menu", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("🔧 *Admin Panel*\n\nSelect an option:", {
    parse_mode: "Markdown",
    reply_markup: adminMenuKeyboard(),
  });
});

// ── Settings ───────────────────────────────────────────────────────────────────

composer.callbackQuery("admin:settings", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = await getSettings();
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  let text = "⚙️ *Settings*\n\n";
  text += `Timezone: ${s.timezone}\n`;
  text += `Slot: ${s.slotMinutes} min\n\n`;
  for (const d of days) {
    const h = (s.businessHours as Record<string, [string, string] | null>)[d];
    text += `${d.toUpperCase()}: ${h ? `${h[0]}–${h[1]}` : "Closed"}\n`;
  }
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard([
      [inlineButton("🕐 Set timezone", "admin:set_timezone")],
      BACK_ADMIN[0],
    ]),
  });
});

composer.callbackQuery("admin:set_timezone", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = "awaiting_timezone";
  await ctx.editMessageText(
    "Enter the studio timezone (e.g. America/New_York, Europe/London, Asia/Tokyo):",
    { reply_markup: inlineKeyboard(BACK_ADMIN) },
  );
});

// ── Admins management ──────────────────────────────────────────────────────────

composer.callbackQuery("admin:admins", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const admins = await getAdmins();
  if (admins.length === 0) {
    await ctx.editMessageText("No admins configured. Use /add_admin to add one.", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add admin", "admin:add_admin")],
        BACK_ADMIN[0],
      ]),
    });
    return;
  }
  let text = "👥 *Admins*\n\n";
  for (const a of admins) {
    text += `• ${a.name} (ID: \`${a.userId}\`)\n`;
  }
  const rows = admins.map((a) => [
    inlineButton(`🗑 Remove ${a.name}`, `admin:remove_admin:${a.userId}`),
  ]);
  rows.push([inlineButton("➕ Add admin", "admin:add_admin")]);
  rows.push(BACK_ADMIN[0]);
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("admin:add_admin", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = "awaiting_admin_id";
  await ctx.editMessageText(
    "To add an admin, have them send a message to the bot first, then enter their Telegram user ID:",
    { reply_markup: inlineKeyboard(BACK_ADMIN) },
  );
});

composer.callbackQuery(/^admin:remove_admin:(\d+):yes$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match[1]);
  const admins = await getAdmins();
  const filtered = admins.filter((a) => a.userId !== id);
  if (filtered.length === 0) {
    await ctx.editMessageText("Cannot remove the last admin.", {
      reply_markup: inlineKeyboard(BACK_ADMIN),
    });
    return;
  }
  const { saveAdmins: sa } = await import("../store.js");
  await sa(filtered);
  await ctx.editMessageText("Admin removed.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:remove_admin:(\d+):no$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Removal cancelled.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:remove_admin:(\d+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Remove this admin?", {
    reply_markup: confirmKeyboard(`admin:remove_admin:${ctx.match[1]}`),
  });
});

// ── Services management ────────────────────────────────────────────────────────

composer.callbackQuery("admin:services", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const services = await getServices();
  const rows = services.map((s) => [
    inlineButton(
      `${s.active ? "✅" : "❌"} ${s.title} — $${s.price}`,
      `admin:service:view:${s.id}`,
    ),
  ]);
  rows.push([inlineButton("➕ Add service", "admin:service:add")]);
  rows.push(BACK_ADMIN[0]);
  await ctx.editMessageText("💅 *Services*\n\nSelect a service to manage:", {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("admin:service:add", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = "awaiting_service_title";
  await ctx.editMessageText("Enter the service title:", {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.callbackQuery(/^admin:service:view:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const svc = await (await import("../store.js")).getService(ctx.match[1]);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  await ctx.editMessageText(
    `💅 *${svc.title}*\n\n${svc.description}\n\n⏱️ ${svc.duration} min\n💰 $${svc.price}\n📂 ${svc.category}\nStatus: ${svc.active ? "Active" : "Inactive"}`,
    {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard([
        [inlineButton(svc.active ? "❌ Deactivate" : "✅ Activate", `admin:service:toggle:${svc.id}`)],
        [inlineButton("🗑 Delete", `admin:service:delete:${svc.id}`)],
        BACK_ADMIN[0],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:service:toggle:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const svc = await (await import("../store.js")).getService(ctx.match[1]);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  svc.active = !svc.active;
  await upsertService(svc);
  await ctx.editMessageText(`Service ${svc.active ? "activated" : "deactivated"}.`, {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.callbackQuery(/^admin:service:delete:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const svc = await (await import("../store.js")).getService(ctx.match[1]);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  await ctx.editMessageText(`Delete *${svc.title}*?`, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard(`admin:svc_delete:${svc.id}`),
  });
});

composer.callbackQuery(/^admin:svc_delete:(.+):yes$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await deleteService(ctx.match[1]);
  await ctx.editMessageText("Service deleted.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:svc_delete:(.+):no$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Deletion cancelled.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

// Handle admin text input for service creation
composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.adminStep;
  if (!step) return next();
  if (!(await isAdmin(ctx.from!.id))) return next();

  if (step === "awaiting_service_title") {
    ctx.session.adminStep = "awaiting_service_description";
    ctx.session.editingServiceId = id();
    await upsertService({
      id: ctx.session.editingServiceId,
      title: ctx.message.text,
      description: "",
      duration: 30,
      price: 0,
      photos: [],
      category: "General",
      active: true,
    });
    await ctx.reply("Enter description:", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  if (step === "awaiting_service_description") {
    const sid = ctx.session.editingServiceId;
    if (!sid) return next();
    const svc = await (await import("../store.js")).getService(sid);
    if (!svc) return next();
    svc.description = ctx.message.text;
    await upsertService(svc);
    ctx.session.adminStep = "awaiting_service_duration";
    await ctx.reply("Enter duration (minutes):", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  if (step === "awaiting_service_duration") {
    const sid = ctx.session.editingServiceId;
    if (!sid) return next();
    const minutes = parseInt(ctx.message.text);
    if (isNaN(minutes) || minutes <= 0) {
      await ctx.reply("Enter a valid number (minutes):");
      return;
    }
    const svc = await (await import("../store.js")).getService(sid);
    if (!svc) return next();
    svc.duration = minutes;
    await upsertService(svc);
    ctx.session.adminStep = "awaiting_service_price";
    await ctx.reply("Enter price ($):", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  if (step === "awaiting_service_price") {
    const sid = ctx.session.editingServiceId;
    if (!sid) return next();
    const price = parseInt(ctx.message.text);
    if (isNaN(price) || price < 0) {
      await ctx.reply("Enter a valid price ($):");
      return;
    }
    const svc = await (await import("../store.js")).getService(sid);
    if (!svc) return next();
    svc.price = price;
    await upsertService(svc);
    ctx.session.adminStep = "awaiting_service_category";
    await ctx.reply("Enter category:", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  if (step === "awaiting_service_category") {
    const sid = ctx.session.editingServiceId;
    if (!sid) return next();
    const svc = await (await import("../store.js")).getService(sid);
    if (!svc) return next();
    svc.category = ctx.message.text;
    await upsertService(svc);
    ctx.session.adminStep = "awaiting_service_photos";
    await ctx.reply("Send up to 5 photos for this service (or tap Done):", {
      reply_markup: inlineKeyboard([[inlineButton("✅ Done", "admin:svc_photos_done")]]),
    });
    return;
  }

  if (step === "awaiting_review_reply") {
    const rid = ctx.session.editingServiceId; // Reusing field for review ID
    if (!rid) return next();
    const review = await getReview(rid);
    if (!review) return next();
    review.adminReply = ctx.message.text;
    await upsertReview(review);
    ctx.session.adminStep = undefined;
    ctx.session.editingServiceId = undefined;
    await ctx.reply("Reply sent to review.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }

  if (step === "awaiting_timezone") {
    ctx.session.adminStep = undefined;
    const s = await getSettings();
    s.timezone = ctx.message.text;
    await saveSettings(s);
    await ctx.reply(`Timezone set to ${ctx.message.text}.`, {
      reply_markup: inlineKeyboard(BACK_ADMIN),
    });
    return;
  }

  if (step === "awaiting_admin_id") {
    const id = parseInt(ctx.message.text);
    if (isNaN(id) || id <= 0) {
      await ctx.reply("Enter a valid Telegram user ID:", {
        reply_markup: inlineKeyboard(BACK_ADMIN),
      });
      return;
    }
    ctx.session.adminStep = undefined;
    const admins = await getAdmins();
    if (admins.some((a) => a.userId === id)) {
      await ctx.reply("This user is already an admin.", {
        reply_markup: inlineKeyboard(BACK_ADMIN),
      });
      return;
    }
    admins.push({ userId: id, name: `User ${id}` });
    const { saveAdmins: sa } = await import("../store.js");
    await sa(admins);
    await ctx.reply(`Admin added (ID: ${id}).`, {
      reply_markup: inlineKeyboard(BACK_ADMIN),
    });
    return;
  }

  return next();
});

composer.on("message:photo", async (ctx, next) => {
  if (!(await isAdmin(ctx.from!.id))) return next();
  const step = ctx.session.adminStep;
  if (step !== "awaiting_service_photos" && step !== "awaiting_portfolio_photo" && step !== "awaiting_portfolio_more_photos") return next();

  const fileId = ctx.message.photo[ctx.message.photo.length - 1]!.file_id;
  if (step === "awaiting_service_photos") {
    const sid = ctx.session.editingServiceId;
    if (!sid) return next();
    const svc = await (await import("../store.js")).getService(sid);
    if (!svc) return next();
    if (svc.photos.length >= 5) {
      await ctx.reply("Max 5 photos. Tap Done.");
      return;
    }
    svc.photos.push(fileId);
    await upsertService(svc);
    await ctx.reply(`Photo ${svc.photos.length}/5 added. Send more or tap Done.`, {
      reply_markup: inlineKeyboard([[inlineButton("✅ Done", "admin:svc_photos_done")]]),
    });
    return;
  }

  if (step === "awaiting_portfolio_photo" || step === "awaiting_portfolio_more_photos") {
    if (!ctx.session.editingServiceId) {
      // New portfolio item
      const item: PortfolioItem = {
        id: id(),
        images: [fileId],
        caption: "",
        serviceTags: [],
        createdAt: new Date().toISOString(),
      };
      await addPortfolioItem(item);
      ctx.session.editingServiceId = item.id;
      ctx.session.adminStep = "awaiting_portfolio_more_photos";
    } else {
      const item = await getPortfolioItem(ctx.session.editingServiceId);
      if (item) {
        item.images.push(fileId);
        const items = await getPortfolioItems();
        const idx = items.findIndex((i) => i.id === item!.id);
        if (idx >= 0) {
          items[idx] = item;
          await (await import("../store.js")).savePortfolioItems(items);
        }
      }
    }
    await ctx.reply("Photo added. Send more or tap Continue:", {
      reply_markup: inlineKeyboard([[inlineButton("➡️ Continue", "admin:portfolio_continue")]]),
    });
    return;
  }
  return next();
});

composer.callbackQuery("admin:svc_photos_done", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = undefined;
  ctx.session.editingServiceId = undefined;
  await ctx.editMessageText("✅ Service created!", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

// ── Portfolio management ───────────────────────────────────────────────────────

composer.callbackQuery("admin:portfolio", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const items = await getPortfolioItems();
  const rows = items.map((i) => [
    inlineButton(`🖼 ${i.caption || "Untitled"}`, `admin:portfolio:view:${i.id}`),
  ]);
  rows.push([inlineButton("➕ Add item", "admin:portfolio:add")]);
  rows.push(BACK_ADMIN[0]);
  await ctx.editMessageText("🖼 *Portfolio Items*\n\nSelect an item to manage:", {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("admin:portfolio:add", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = "awaiting_portfolio_photo";
  ctx.session.editingServiceId = undefined;
  await ctx.editMessageText("Send a photo for the portfolio:", {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.callbackQuery("admin:portfolio_continue", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = "awaiting_portfolio_caption";
  await ctx.editMessageText("Enter a caption:", {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.adminStep;
  if (step === "awaiting_portfolio_caption") {
    if (!(await isAdmin(ctx.from!.id))) return next();
    const pid = ctx.session.editingServiceId;
    if (!pid) return next();
    const item = await getPortfolioItem(pid);
    if (!item) return next();
    item.caption = ctx.message.text;
    const items = await getPortfolioItems();
    const idx = items.findIndex((i) => i.id === pid);
    if (idx >= 0) {
      items[idx] = item;
      await (await import("../store.js")).savePortfolioItems(items);
    }
    ctx.session.adminStep = "awaiting_portfolio_tags";
    const services = await getServices();
    const tagRows = services.map((s) => [
      inlineButton(s.title, `admin:portfolio_tag:${s.id}`),
    ]);
    tagRows.push([inlineButton("✅ Done", "admin:portfolio_tags_done")]);
    await ctx.reply("Select service tags:", {
      reply_markup: inlineKeyboard(tagRows),
    });
    return;
  }
  return next();
});

composer.callbackQuery(/^admin:portfolio_tag:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const pid = ctx.session.editingServiceId;
  if (!pid) return;
  const item = await getPortfolioItem(pid);
  if (!item) return;
  const tag = ctx.match[1];
  if (!item.serviceTags.includes(tag)) {
    item.serviceTags.push(tag);
    const items = await getPortfolioItems();
    const idx = items.findIndex((i) => i.id === pid);
    if (idx >= 0) {
      items[idx] = item;
      await (await import("../store.js")).savePortfolioItems(items);
    }
  }
  await ctx.answerCallbackQuery({ text: "Tag added." });
});

composer.callbackQuery("admin:portfolio_tags_done", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = undefined;
  ctx.session.editingServiceId = undefined;
  await ctx.editMessageText("✅ Portfolio item added!", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:portfolio:view:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const item = await getPortfolioItem(ctx.match[1]);
  if (!item) {
    await ctx.editMessageText("Item not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  await ctx.editMessageText(
    `🖼 ${item.caption}\n\nTags: ${item.serviceTags.join(", ") || "None"}\nPhotos: ${item.images.length}\nCreated: ${item.createdAt}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🗑 Delete", `admin:portfolio:delete:${item.id}`)],
        BACK_ADMIN[0],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:portfolio:delete:(.+):yes$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await deletePortfolioItem(ctx.match[1]);
  await ctx.editMessageText("Portfolio item deleted.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:portfolio:delete:(.+):no$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Deletion cancelled.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:portfolio:delete:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Delete this portfolio item?", {
    reply_markup: confirmKeyboard(`admin:portfolio:delete:${ctx.match[1]}`),
  });
});

// ── Bookings management ─────────────────────────────────────────────────────────

composer.callbackQuery("admin:bookings", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const bookings = await getBookings();
  const sorted = [...bookings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  if (sorted.length === 0) {
    await ctx.editMessageText("No bookings yet.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  const rows = sorted.slice(0, 10).map((b) => [
    inlineButton(
      `${b.status === "confirmed" ? "✅" : b.status === "cancelled" ? "❌" : "✓"} ${b.serviceTitle} — ${b.date}`,
      `admin:booking:view:${b.id}`,
    ),
  ]);
  rows.push(BACK_ADMIN[0]);
  await ctx.editMessageText("📋 *Bookings*\n\nTap to manage:", {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^admin:booking:view:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await getBooking(ctx.match[1]);
  if (!booking) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  const status = booking.status === "confirmed"
    ? "✅ Confirmed"
    : booking.status === "cancelled"
      ? "❌ Cancelled"
      : "✓ Completed";

  let text = `📋 *Booking*\n\n`;
  text += `💅 ${booking.serviceTitle}\n`;
  text += `👤 ${booking.contactName}\n`;
  if (booking.contactPhone) text += `📞 ${booking.contactPhone}\n`;
  text += `🗓 ${booking.date} at ${booking.startTime}\n`;
  text += `⏱️ ${booking.duration} min\n`;
  text += `📝 ${booking.notes || "—"}\n`;
  text += `Status: ${status}\nID: \`${booking.id}\``;

  const rows: InlineButton[][] = [];
  if (booking.status === "confirmed") {
    rows.push([inlineButton("✅ Mark completed", `admin:booking:complete:${booking.id}`)]);
    rows.push([inlineButton("❌ Cancel", `admin:booking:cancel:${booking.id}`)]);
  }
  if (booking.status === "cancelled") {
    rows.push([inlineButton("✅ Restore", `admin:booking:restore:${booking.id}`)]);
  }
  rows.push(BACK_ADMIN[0]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^admin:booking:complete:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await getBooking(ctx.match[1]);
  if (!booking) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  booking.status = "completed";
  await upsertBooking(booking);
  await ctx.api.sendMessage(
    booking.userId,
    `✅ Your booking for *${booking.serviceTitle}* has been marked as completed. Thanks for visiting!`,
    { parse_mode: "Markdown" },
  ).catch(() => {});
  await ctx.editMessageText("Booking marked as completed.", {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.callbackQuery(/^admin:booking:cancel:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await getBooking(ctx.match[1]);
  if (!booking) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  await ctx.editMessageText(`Cancel booking for ${booking.contactName} on ${booking.date}?`, {
    reply_markup: confirmKeyboard(`admin:bk_cancel:${booking.id}`),
  });
});

composer.callbackQuery(/^admin:bk_cancel:(.+):yes$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await getBooking(ctx.match[1]);
  if (!booking) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  booking.status = "cancelled";
  await upsertBooking(booking);
  await ctx.api.sendMessage(
    booking.userId,
    `Your booking for *${booking.serviceTitle}* on ${booking.date} has been cancelled by the studio.`,
    { parse_mode: "Markdown" },
  ).catch(() => {});
  await ctx.editMessageText("Booking cancelled.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:bk_cancel:(.+):no$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Cancellation aborted.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:booking:restore:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await getBooking(ctx.match[1]);
  if (!booking) {
    await ctx.editMessageText("Booking not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  booking.status = "confirmed";
  await upsertBooking(booking);
  await ctx.api.sendMessage(
    booking.userId,
    `✅ Your booking for *${booking.serviceTitle}* on ${booking.date} has been restored.`,
    { parse_mode: "Markdown" },
  ).catch(() => {});
  await ctx.editMessageText("Booking restored.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

// ── Reviews management ─────────────────────────────────────────────────────────

composer.callbackQuery("admin:reviews", adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const reviews = await getReviews();
  if (reviews.length === 0) {
    await ctx.editMessageText("No reviews yet.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  const rows = reviews.slice(0, 10).map((r) => [
    inlineButton(
      `${r.visible ? "👁" : "🙈"} ${r.userName}: ${r.text.slice(0, 30)}...`,
      `admin:review:view:${r.id}`,
    ),
  ]);
  rows.push(BACK_ADMIN[0]);
  await ctx.editMessageText("⭐ *Reviews*\n\nTap to manage:", {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^admin:review:view:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const review = await getReview(ctx.match[1]);
  if (!review) {
    await ctx.editMessageText("Review not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  const stars = "⭐".repeat(review.rating);
  let text = `${stars} *${review.userName}*\n\n${review.text}\n\n`;
  if (review.adminReply) text += `Reply: ${review.adminReply}\n`;
  text += `Visible: ${review.visible ? "Yes" : "No"}\n`;
  text += `ID: \`${review.id}\``;

  const rows: InlineButton[][] = [
    [inlineButton(review.visible ? "🙈 Hide" : "👁 Show", `admin:review:toggle:${review.id}`)],
    [inlineButton("✉️ Reply", `admin:review:reply:${review.id}`)],
    [inlineButton("🗑 Delete", `admin:review:delete:${review.id}`)],
    BACK_ADMIN[0],
  ];
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^admin:review:toggle:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  const review = await getReview(ctx.match[1]);
  if (!review) {
    await ctx.editMessageText("Review not found.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
    return;
  }
  review.visible = !review.visible;
  await upsertReview(review);
  await ctx.editMessageText(`Review ${review.visible ? "shown" : "hidden"}.`, {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.callbackQuery(/^admin:review:reply:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminStep = "awaiting_review_reply";
  ctx.session.editingServiceId = ctx.match[1]; // Tmp: store review ID
  await ctx.editMessageText("Type your reply to this review:", {
    reply_markup: inlineKeyboard(BACK_ADMIN),
  });
});

composer.callbackQuery(/^admin:review:delete:(.+)$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Delete this review?", {
    reply_markup: confirmKeyboard(`admin:rv_delete:${ctx.match[1]}`),
  });
});

composer.callbackQuery(/^admin:rv_delete:(.+):yes$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await deleteReview(ctx.match[1]);
  await ctx.editMessageText("Review deleted.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

composer.callbackQuery(/^admin:rv_delete:(.+):no$/, adminGuard(), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Deletion cancelled.", { reply_markup: inlineKeyboard(BACK_ADMIN) });
});

export default composer;