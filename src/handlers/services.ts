// User-facing service browse + booking-start. Tapping "Book service" in the
// /start menu lands here. Admin CRUD for services lives in admin.ts.

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getService, listServices } from "../storage/store.js";
import { formatDuration, formatPrice } from "../util/format.js";
import type { Service } from "../types.js";

registerMainMenuItem({ label: "📅 Book service", data: "svc:l", order: 10 });

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

function renderService(s: Service): string {
  const price = formatPrice(s.priceCents);
  const dur = formatDuration(s.durationMinutes);
  const desc = s.description.length > 120 ? s.description.slice(0, 117) + "…" : s.description;
  return `💅 <b>${s.title}</b>\n${desc}\n⏱ ${dur} · 💶 ${price}`;
}

function servicesListKeyboard(svcs: Service[]): ReturnType<typeof inlineKeyboard> {
  const rows: { text: string; callback_data: string }[][] = [];
  for (const s of svcs) {
    rows.push([
      inlineButton(`${s.title} — ${formatPrice(s.priceCents)}`, `svc:p:${s.id}`),
    ]);
  }
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

composer.callbackQuery("svc:l", async (ctx) => {
  await ctx.answerCallbackQuery();
  const svcs = await listServices(true);
  if (svcs.length === 0) {
    await ctx.editMessageText(
      "No services are available right now. Please check back later.",
      { reply_markup: backToMenu() },
    );
    return;
  }
  const lines = svcs.map(renderService).join("\n\n");
  await ctx.editMessageText(`<b>Our services</b>\n\n${lines}`, {
    parse_mode: "HTML",
    reply_markup: servicesListKeyboard(svcs),
  });
});

composer.callbackQuery(/^svc:p:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const svc = await getService(id);
  if (!svc || !svc.active) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const text =
    `💅 <b>${svc.title}</b>\n\n` +
    `${svc.description}\n\n` +
    `⏱ ${formatDuration(svc.durationMinutes)} · 💶 ${formatPrice(svc.priceCents)}`;
  if (svc.thumbnailFileId) {
    try {
      await ctx.editMessageMedia({
        type: "photo",
        media: svc.thumbnailFileId,
        caption: text,
        parse_mode: "HTML",
      });
    } catch {
      // Some messages can't be edited to media; fall back to a text edit.
    }
  }
  await ctx.editMessageReplyMarkup(
    inlineKeyboard([
      [inlineButton("📅 Book this", `bk:s:${svc.id}`)],
      [inlineButton("🖼 Portfolio for this service", `pf:f:${svc.id}`)],
      [inlineButton("⬅️ Back to services", "svc:l")],
    ]) as unknown as Parameters<typeof ctx.editMessageReplyMarkup>[0],
  );
});

export default composer;