import { Composer, type Bot } from "grammy";
import { readdirSync } from "node:fs";
import { createBot, type BotContext } from "./toolkit/index.js";
import { ensureDefaults } from "./store.js";

// The per-chat session shape (ephemeral conversation state only). Extend as the
// bot grows. Durable domain data must NOT live here — use the toolkit's
// persistent storage (see AGENTS.md).
export interface Session {
  bookingStep?: "select_service" | "select_date" | "select_time" | "enter_contact" | "enter_notes" | "confirm";
  bookingServiceId?: string;
  bookingDate?: string;
  bookingTime?: string;
  bookingContactName?: string;
  bookingContactPhone?: string;
  bookingNotes?: string;
  reviewStep?: "awaiting_text" | "awaiting_photos";
  reviewText?: string;
  reviewPhotos?: string[];
  adminStep?:
    | "awaiting_service_title"
    | "awaiting_service_description"
    | "awaiting_service_duration"
    | "awaiting_service_price"
    | "awaiting_service_category"
    | "awaiting_service_photos"
    | "awaiting_portfolio_caption"
    | "awaiting_portfolio_tags"
    | "awaiting_portfolio_photo"
    | "awaiting_portfolio_more_photos"
    | "awaiting_review_reply"
    | "awaiting_timezone"
    | "awaiting_admin_id";
  adminMode?: boolean;
  editingServiceId?: string;
  contactStep?: "awaiting_message";
  timezone?: string;
  portfolioFilter?: string;
}

export type Ctx = BotContext<Session>;

/**
 * buildBot — assembles the bot, AUTO-LOADS every feature handler from
 * src/handlers/, then registers the global fallback. Does NOT start the bot.
 * Add a feature by creating src/handlers/<name>.ts that default-exports a grammY
 * Composer — NEVER edit this file (concurrent feature PRs would conflict).
 */
export async function buildBot(token: string) {
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  const dir = new URL("./handlers/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".js") || f.endsWith(".ts")) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.includes(".spec."),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    files = []; // no handlers/ dir yet → nothing to load
  }
  for (const file of files.sort()) {
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx>; startFollowupCheck?: (bot: Bot<Ctx>) => void };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    bot.use(mod.default);
    if (mod.startFollowupCheck) {
      mod.startFollowupCheck(bot);
    }
  }

  await ensureDefaults();

  bot.on("message", (ctx) => ctx.reply("Sorry, I didn't understand that. Try /help."));

  return bot;
}
