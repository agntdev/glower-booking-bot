// Portfolio viewing: paginated images with optional service filter. Admins can
// upload / delete / tag portfolio items via the /admin menu (admin.ts).

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  paginate,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getService, listPortfolio, listServices } from "../storage/store.js";

registerMainMenuItem({ label: "🖼 Portfolio", data: "pf:v", order: 20 });

const composer = new Composer<Ctx>();
const PER_PAGE = 4;

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

async function renderPortfolio(ctx: Ctx, page: number, svcFilter?: number): Promise<void> {
  const items = await listPortfolio(svcFilter);
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = items.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  const rows: { text: string; callback_data: string }[][] = [];
  for (const item of slice) {
    const cap = item.caption ? item.caption.slice(0, 32) : `Photo #${item.id}`;
    rows.push([inlineButton(`📷 ${cap}`, `pf:i:${item.id}`)]);
  }
  // Service filter row.
  const svcs = await listServices(true);
  const filterRow: { text: string; callback_data: string }[] = [];
  filterRow.push(
    inlineButton(svcFilter === undefined ? "✓ All" : "All", "pf:v"),
  );
  for (const s of svcs.slice(0, 4)) {
    filterRow.push(
      inlineButton(
        svcFilter === s.id ? `✓ ${s.title}` : s.title,
        `pf:f:${s.id}`,
      ),
    );
  }
  rows.push(filterRow);
  // Pagination controls.
  if (totalPages > 1) {
    const navRow: { text: string; callback_data: string }[] = [];
    if (p > 0) navRow.push(inlineButton("« Prev", `pf:p:${svcFilter ?? 0}:${p - 1}`));
    navRow.push(inlineButton(`${p + 1} / ${totalPages}`, "pf:v"));
    if (p < totalPages - 1) navRow.push(inlineButton("Next »", `pf:p:${svcFilter ?? 0}:${p + 1}`));
    rows.push(navRow);
  }
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  const header =
    svcFilter !== undefined
      ? `<b>Portfolio</b> (filtered)`
      : `<b>Portfolio</b>`;
  const empty = items.length === 0
    ? "\n\nNo portfolio items yet. Check back soon."
    : "";
  const text = `${header}${empty}`;

  if (slice.length > 0) {
    // Telegram doesn't allow editing a text message to a media message in one call;
    // send the first photo with caption + pager, then chain the rest as media.
    const first = slice[0]!;
    await ctx.editMessageMedia({
      type: "photo",
      media: first.fileId,
      caption: text + (first.caption ? `\n\n${first.caption}` : ""),
      parse_mode: "HTML",
    });
    await ctx.editMessageReplyMarkup(
      inlineKeyboard(rows) as unknown as Parameters<typeof ctx.editMessageReplyMarkup>[0],
    );
  } else {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard(rows),
    });
  }
}

composer.callbackQuery("pf:v", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderPortfolio(ctx, 0);
});

composer.callbackQuery(/^pf:p:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const svcFilter = parseInt(ctx.match![1]!, 10) || undefined;
  const page = parseInt(ctx.match![2]!, 10);
  await renderPortfolio(ctx, page, svcFilter);
});

composer.callbackQuery(/^pf:f:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const svcId = parseInt(ctx.match![1]!, 10);
  const svc = await getService(svcId);
  if (!svc) {
    await ctx.answerCallbackQuery({ text: "Service not found", show_alert: true });
    return;
  }
  await renderPortfolio(ctx, 0, svcId);
});

composer.callbackQuery(/^pf:i:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match![1]!, 10);
  const items = await listPortfolio();
  const item = items.find((p) => p.id === id);
  if (!item) {
    await ctx.answerCallbackQuery({ text: "Not found", show_alert: true });
    return;
  }
  try {
    await ctx.editMessageMedia({
      type: "photo",
      media: item.fileId,
      caption: item.caption ?? "",
    });
  } catch {
    // ignore — message may already be media
  }
});

export default composer;