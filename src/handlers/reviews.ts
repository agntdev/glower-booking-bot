import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  paginate,
} from "../toolkit/index.js";
import { getReviews, upsertReview, getAdmins } from "../store.js";
import type { Review } from "../store.js";

registerMainMenuItem({ label: "⭐ Reviews", data: "reviews:view", order: 30 });

const composer = new Composer<Ctx>();

const BACK = [[inlineButton("⬅️ Back to menu", "menu:main")]];

function id(): string {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

composer.callbackQuery("reviews:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const reviews = await getReviews();
  const visible = reviews.filter((r) => r.visible);

  if (visible.length === 0) {
    await ctx.editMessageText(
      "No reviews yet — be the first to share your experience!",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("✍️ Leave a review", "reviews:submit")],
          BACK[0],
        ]),
      },
    );
    return;
  }

  const paged = paginate(visible, {
    page: 0,
    perPage: 3,
    callbackPrefix: "reviews:page",
  });

  const text = visible.map((r, i) => {
    const stars = "⭐".repeat(r.rating);
    return `${stars} *${r.userName}*: ${r.text}`;
  }).join("\n\n");

  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [
    ...paged.controls.inline_keyboard,
  ];
  rows.push([inlineButton("✍️ Leave a review", "reviews:submit")]);
  rows.push(BACK[0]);

  await ctx.editMessageText(`⭐ *Reviews*\n\n${text}`, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^reviews:page:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match[1]);
  const reviews = await getReviews();
  const visible = reviews.filter((r) => r.visible);

  const paged = paginate(visible, {
    page,
    perPage: 3,
    callbackPrefix: "reviews:page",
  });

  const text = visible.map((r, i) => {
    const stars = "⭐".repeat(r.rating);
    return `${stars} *${r.userName}*: ${r.text}`;
  }).join("\n\n");

  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [
    ...paged.controls.inline_keyboard,
  ];
  rows.push([inlineButton("✍️ Leave a review", "reviews:submit")]);
  rows.push(BACK[0]);

  await ctx.editMessageText(`⭐ *Reviews*\n\n${text}`, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^reviews:page:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match[1]);
  const reviews = await getReviews();
  const visible = reviews.filter((r) => r.visible);

  const paged = paginate(visible, {
    page,
    perPage: 3,
    callbackPrefix: "reviews:page",
  });

  const text = visible.map((r, i) => {
    const stars = "⭐".repeat(r.rating);
    return `${stars} *${r.userName}*: ${r.text}`;
  }).join("\n\n");

  const rows: ReturnType<typeof inlineKeyboard>["inline_keyboard"] = [
    ...paged.controls.inline_keyboard,
  ];
  rows.push([inlineButton("✍️ Leave a review", "reviews:submit")]);
  rows.push(BACK[0]);

  await ctx.editMessageText(`⭐ *Reviews*\n\n${text}`, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard(rows),
  });
});

// ── Review submission flow ─────────────────────────────────────────────────────

composer.callbackQuery("reviews:submit", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.reviewStep = "awaiting_text";
  ctx.session.reviewText = undefined;
  ctx.session.reviewPhotos = [];
  await ctx.editMessageText(
    "✍️ *Leave a Review*\n\nWrite your review (text only, no photos required):",
    {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "reviews:view")],
      ]),
    },
  );
});

composer.callbackQuery("followup:review:now", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.reviewStep = "awaiting_text";
  ctx.session.reviewText = undefined;
  ctx.session.reviewPhotos = [];
  await ctx.editMessageText(
    "✍️ *Leave a Review*\n\nWrite your review:",
    {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard(BACK),
    },
  );
});

composer.callbackQuery("followup:review:later", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    "No problem! You can leave a review anytime from the Reviews menu.",
    { reply_markup: inlineKeyboard(BACK) },
  );
});

composer.callbackQuery("followup:review:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    "Thanks for visiting GlowEr! See you again soon.",
    { reply_markup: inlineKeyboard(BACK) },
  );
});

// Handle text input during review flow
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.reviewStep !== "awaiting_text") return next();
  ctx.session.reviewText = ctx.message.text;
  ctx.session.reviewStep = "awaiting_photos";
  ctx.session.reviewPhotos = [];
  await ctx.reply(
    "Send up to 10 photos for your review (or tap Done):",
    { reply_markup: inlineKeyboard([[inlineButton("✅ Done", "reviews:done")]]) },
  );
});

// Handle photo uploads during review flow
composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.reviewStep !== "awaiting_photos") return next();
  const photos = ctx.session.reviewPhotos || [];
  if (photos.length >= 10) {
    await ctx.reply("Maximum 10 photos. Tap Done to finish.");
    return;
  }
  const fileId = ctx.message.photo[ctx.message.photo.length - 1]!.file_id;
  photos.push(fileId);
  ctx.session.reviewPhotos = photos;
  await ctx.reply(
    `Photo ${photos.length}/10 added. Send more or tap Done.`,
    { reply_markup: inlineKeyboard([[inlineButton("✅ Done", "reviews:done")]]) },
  );
});

composer.callbackQuery("reviews:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.reviewText) {
    await ctx.editMessageText("Write your review first:", {
      reply_markup: inlineKeyboard(BACK),
    });
    return;
  }

  const review: Review = {
    id: id(),
    userId: ctx.from!.id,
    userName: ctx.from!.first_name || "Client",
    rating: 5,
    text: ctx.session.reviewText,
    photos: ctx.session.reviewPhotos || [],
    timestamp: new Date().toISOString(),
    visible: true,
  };

  await upsertReview(review);
  ctx.session.reviewStep = undefined;
  ctx.session.reviewText = undefined;
  ctx.session.reviewPhotos = undefined;

  await ctx.editMessageText(
    "✅ Review submitted! Thank you for sharing your experience.",
    { reply_markup: inlineKeyboard(BACK) },
  );

  // Notify admins
  const admins = await getAdmins();
  for (const a of admins) {
    await ctx.api.sendMessage(
      a.userId,
      `🆕 *New Review*\n\n⭐ ${review.text}\n\n👤 ${review.userName}\nID: \`${review.id}\``,
      { parse_mode: "Markdown" },
    ).catch(() => {});
  }
});

export default composer;