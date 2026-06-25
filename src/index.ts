import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";
import { startFollowupScheduler } from "./handlers/followup.js";

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = await buildBot(token);
  // Publish the "/" command list to Telegram (discoverability). A button-first
  // bot exposes only /start + /help; /admin is documented in /help.
  await setDefaultCommands(bot, [
    { command: "admin", description: "Manage the studio (admins only)" },
  ]);
  // Kick off the post-appointment follow-up scan.
  startFollowupScheduler(bot.api);
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
