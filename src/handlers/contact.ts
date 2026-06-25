import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { getAdmins } from "../store.js";

registerMainMenuItem({ label: "📞 Contact", data: "contact:start", order: 50 });

const composer = new Composer<Ctx>();

const BACK = [[inlineButton("⬅️ Back to menu", "menu:main")]];

composer.callbackQuery("contact:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    "📞 *Contact GlowEr*\n\n" +
    "📍 123 Beauty Lane, Suite 101\n" +
    "📞 +1 (555) 123-4567\n" +
    "✉️ hello@glower-studio.com\n\n" +
    "🕐 Mon–Sat: 9:00 AM – 6:00 PM\n" +
    "🕐 Sun: Closed\n\n" +
    "Send us a message below:",
    {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard([
        [inlineButton("✉️ Send a message", "contact:message")],
        BACK[0],
      ]),
    },
  );
});

composer.callbackQuery("contact:message", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.contactStep = "awaiting_message";
  await ctx.editMessageText(
    "Type your message and we'll get back to you:",
    { reply_markup: inlineKeyboard(BACK) },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.contactStep !== "awaiting_message") return next();
  ctx.session.contactStep = undefined;

  const admins = await getAdmins();
  for (const a of admins) {
    await ctx.api.sendMessage(
      a.userId,
      `📨 *Message from ${ctx.from!.first_name}*\n\n${ctx.message.text}`,
      { parse_mode: "Markdown" },
    ).catch(() => {});
  }

  await ctx.reply(
    "✅ Message sent! We'll get back to you soon.",
    { reply_markup: inlineKeyboard(BACK) },
  );
});

export default composer;