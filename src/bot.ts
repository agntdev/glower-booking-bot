import { Composer } from "grammy";
import { readdirSync } from "node:fs";
import { createBot, type BotContext } from "./toolkit/index.js";
import { createService, listServices } from "./storage/store.js";

// The per-chat session shape (ephemeral conversation state only). Durable
// domain data (services, bookings, reviews, etc.) lives in src/storage/store.ts
// — NOT here.
export interface Session {
  /** Mid-flight booking draft. Cleared on confirm/cancel. */
  bookingDraft?: {
    serviceId?: number;
    startEpochMs?: number;
    notes?: string;
    awaitingNotes?: boolean;
  };
  /** Mid-flight review draft — text and accumulated photo file_ids. */
  reviewDraft?: {
    text?: string;
    photos?: string[];
    bookingId?: number;
  };
  /** Mid-flight admin edit (service / portfolio / reply / settings). */
  adminDraft?: {
    kind?: "service_new" | "service_edit" | "portfolio_new" | "review_reply" | "settings";
    targetId?: number;
    step?: string;
    buffer?: Record<string, unknown>;
  };
}

/** Seed a few default services on first build so the bot is usable out of the
 *  box (and so the test harness has services to operate on). Idempotent: no-op
 *  when any services exist. Also promotes ADMIN_ID env var (if set) to admin. */
export async function seedDefaults(): Promise<void> {
  const existing = await listServices(false);
  if (existing.length === 0) {
    await createService({
      title: "Classic facial",
      description: "Cleansing, exfoliation, mask, and moisturiser. 60 min of pure relaxation.",
      durationMinutes: 60,
      priceCents: 7500,
      active: true,
    });
    await createService({
      title: "Manicure",
      description: "Shape, cuticle care, hand massage, and polish. Quick pick-me-up.",
      durationMinutes: 45,
      priceCents: 3500,
      active: true,
    });
    await createService({
      title: "Hair cut & style",
      description: "Consultation, wash, cut, and blow-dry by a senior stylist.",
      durationMinutes: 75,
      priceCents: 6500,
      active: true,
    });
  }
  // Promote ADMIN_ID env var to admin role (idempotent).
  const envAdmin = parseInt(process.env.ADMIN_ID ?? "", 10);
  if (Number.isFinite(envAdmin) && envAdmin > 0) {
    const { updateSettings } = await import("./storage/store.js");
    const { getSettings } = await import("./storage/store.js");
    const s = await getSettings();
    if (!s.adminIds.includes(envAdmin)) {
      await updateSettings({ adminIds: [...s.adminIds, envAdmin] });
    }
  }
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
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx> };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    bot.use(mod.default);
  }

  // Seed default services (idempotent) so the bot has something to operate on
  // when first started, and so the test harness has services in store.
  await seedDefaults();

  bot.on("message", (ctx) => ctx.reply("Sorry, I didn't understand that. Try /help."));

  return bot;
}
