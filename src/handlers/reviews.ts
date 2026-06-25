// Reviews: public list (paginated) + submit-a-review flow. Admin moderation
// (reply, remove) lives in admin.ts.

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  createReview,
  getSettings,
  listReviews,
} from "../storage/store.js";
import { escapeHtml, userLabel } from "../util/format.js";

registerMainMenuItem({ label: "⭐ Reviews", data: "rv:v", order: 40 });

const composer = new Composer<Ctx>();
const PER_PAGE = 3;

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

async function renderReviews(ctx: Ctx, page: number, edit = true): Promise<void> {
  const all = await listReviews(true);
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = all.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  const rows: { text: string; callback_data: string }[][] = [];
  const lines: string[] = [`<b>Reviews</b> (${all.length})`];
  for (const r of slice) {
    const stars = r.rating ? `${r.rating}★ ` : "";
    const when = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(r.createdAt));
    lines.push(
      `${stars}<i>${escapeHtml(r.text.slice(0, 200))}</i>\n` +
        `— ${when}${r.photos.length > 0 ? ` · 📷 ${r.photos.length}` : ""}` +
        (r.adminReply ? `\n   💬 ${escapeHtml(r.adminReply)}` : ""),
    );
  }
  if (all.length === 0) {
    lines.push("\nNo reviews yet — be the first!");
  }
  rows.push([inlineButton("✍️ Leave a review", "rv:s")]);
  if (totalPages > 1) {
    const navRow: { text: string; callback_data: string }[] = [];
    if (p > 0) navRow.push(inlineButton("« Prev", `rv:p:${p - 1}`));
    navRow.push(inlineButton(`${p + 1} / ${totalPages}`, "rv:v"));
    if (p < totalPages - 1) navRow.push(inlineButton("Next »", `rv:p:${p + 1}`));
    rows.push(navRow);
  }
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  if (edit) {
    await ctx.editMessageText(lines.join("\n\n"), {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard(rows),
    });
  } else {
    await ctx.reply(lines.join("\n\n"), {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard(rows),
    });
  }
}

composer.callbackQuery("rv:v", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderReviews(ctx, 0);
});

composer.callbackQuery(/^rv:p:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = parseInt(ctx.match![1]!, 10);
  await renderReviews(ctx, p);
});

composer.callbackQuery("rv:s", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.reviewDraft = { photos: [] };
  await ctx.editMessageText(
    "Send your review as a text message. You can attach up to 10 photos afterwards.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "rv:v")],
      ]),
    },
  );
});

// Free-form review text → ask for photos.
composer.on("message:text", async (ctx, next) => {
  const draft = ctx.session.reviewDraft;
  // Only act if the user just started a review (no text yet).
  if (draft && draft.photos !== undefined && draft.text === undefined) {
    draft.text = ctx.message.text.slice(0, 1000);
    await ctx.reply(
      "Got it. Now send up to 10 photos (or tap Done to publish without photos).",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Done — publish", "rv:done")],
          [inlineButton("Cancel", "rv:v")],
        ]),
      },
    );
    return;
  }
  return next();
});

// Photos: accumulate up to 10.
composer.on("message:photo", async (ctx, next) => {
  const draft = ctx.session.reviewDraft;
  if (!draft || draft.photos === undefined) return next();
  if (draft.text === undefined) return next(); // text first
  const photos = draft.photos;
  const photo = ctx.message.photo;
  // Telegram sends multiple sizes; pick the largest.
  const largest = photo[photo.length - 1];
  if (!largest) return next();
  if (photos.length >= 10) {
    await ctx.reply(
      `That's already ${photos.length} photos — the limit is 10. Tap Done to publish.`,
      {
        reply_markup: inlineKeyboard([[inlineButton("Done — publish", "rv:done")]]),
      },
    );
    return;
  }
  photos.push(largest.file_id);
  const left = 10 - photos.length;
  await ctx.reply(
    `📷 Photo added (${photos.length}/10)${left > 0 ? `, ${left} more allowed` : ""}. Tap Done when ready.`,
    {
      reply_markup: inlineKeyboard([[inlineButton("Done — publish", "rv:done")]]),
    },
  );
  return;
});

composer.callbackQuery("rv:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = ctx.session.reviewDraft;
  if (!draft || draft.text === undefined) {
    await ctx.editMessageText("Nothing to publish.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  await createReview({
    userId: ctx.from!.id,
    text: draft.text,
    photos: draft.photos ?? [],
    createdAt: Date.now(),
    visible: true,
    ...(draft.bookingId !== undefined ? { bookingId: draft.bookingId } : {}),
  });
  ctx.session.reviewDraft = undefined;
  await ctx.editMessageText(
    `✅ Thanks for your review${userLabel(ctx.from)}! It's now visible on the Reviews page.`,
    { reply_markup: backToMenu() },
  );
  // Notify admins.
  const settings = await getSettings();
  for (const adminId of settings.adminIds) {
    try {
      await ctx.api.sendMessage(
        adminId,
        `🔔 New review from ${userLabel(ctx.from)}:\n${draft.text.slice(0, 200)}`,
      );
    } catch {
      // ignore
    }
  }
});

export default composer;