import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  paginate,
} from "../toolkit/index.js";
import { getPortfolioItems, getServices } from "../store.js";

registerMainMenuItem({ label: "🖼 Portfolio", data: "portfolio:view", order: 20 });

const composer = new Composer<Ctx>();

const BACK = [[inlineButton("⬅️ Back to menu", "menu:main")]];

composer.callbackQuery("portfolio:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const items = await getPortfolioItems();
  const services = await getServices();

  if (items.length === 0) {
    await ctx.editMessageText("No portfolio items yet — check back soon!", {
      reply_markup: inlineKeyboard(BACK),
    });
    return;
  }

  const filterRows = services.map((s) => [
    inlineButton(`🔍 ${s.title}`, `portfolio:filter:${s.id}`),
  ]);
  filterRows.push([inlineButton("Show all", "portfolio:show_all")]);
  filterRows.push(BACK[0]);

  await ctx.editMessageText("🖼 *GlowEr Portfolio*\n\nBrowse our work. Filter by service:", {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(filterRows),
  });
});

composer.callbackQuery("portfolio:show_all", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPortfolioPage(ctx, 0, undefined);
});

composer.callbackQuery(/^portfolio:filter:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPortfolioPage(ctx, 0, ctx.match[1]);
});

composer.callbackQuery(/^portfolio:page:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPortfolioPage(ctx, parseInt(ctx.match[1]), ctx.session.portfolioFilter);
});

composer.callbackQuery(/^portfolio:page:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPortfolioPage(ctx, parseInt(ctx.match[1]), ctx.session.portfolioFilter);
});

async function showPortfolioPage(ctx: Ctx, page: number, filter?: string) {
  ctx.session.portfolioFilter = filter;
  const allItems = await getPortfolioItems();
  const filtered = filter
    ? allItems.filter((i) => i.serviceTags.includes(filter))
    : allItems;

  if (filtered.length === 0) {
    await ctx.editMessageText(
      filter
        ? "No portfolio items for this service yet."
        : "No portfolio items yet — check back soon!",
      { reply_markup: inlineKeyboard(BACK) },
    );
    return;
  }

  const paged = paginate(filtered, {
    page,
    perPage: 4,
    callbackPrefix: "portfolio:page",
  });

  const text = filtered.map((item, i) => {
    const num = paged.page * 4 + i + 1;
    const tags = item.serviceTags.length > 0
      ? item.serviceTags.join(", ")
      : "General";
    return `${num}. ${item.caption} [${tags}]`;
  }).join("\n\n");

  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [
    ...paged.controls.inline_keyboard,
  ];
  rows.push([inlineButton("🔍 Filter by service", "portfolio:view")]);
  rows.push(BACK[0]);

  if (filter) {
    await ctx.editMessageText(
      `🖼 *Portfolio* (filtered by ${filter})\n\n${text}`,
      { parse_mode: "Markdown", reply_markup: inlineKeyboard(rows) },
    );
  } else {
    await ctx.editMessageText(
      `🖼 *Portfolio*\n\n${text}`,
      { parse_mode: "Markdown", reply_markup: inlineKeyboard(rows) },
    );
  }
}

export default composer;