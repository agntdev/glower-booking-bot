// Contact info — read-only display of the studio's contact details. Admins
// update the contactInfo string via the /admin menu → Settings (admin.ts).

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getSettings } from "../storage/store.js";

registerMainMenuItem({ label: "📞 Contact", data: "ct:v", order: 50 });

const composer = new Composer<Ctx>();

composer.callbackQuery("ct:v", async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = await getSettings();
  await ctx.editMessageText(
    `<b>${s.studioName}</b>\n\n${s.contactInfo}\n\n` +
      `💬 Or just message us here — your chat is forwarded to the studio.`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;