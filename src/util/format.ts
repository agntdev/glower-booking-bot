// Small text/format helpers shared by handlers. Keep pure — no grammY imports.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Format a price stored as integer cents in a human-friendly way. */
export function formatPrice(cents: number, currency = "EUR"): string {
  const value = (cents / 100).toFixed(2);
  // No locale surprises — show as 12.50 EUR.
  return `${value} ${currency}`;
}

/** Format a duration as "1h 30m" / "45m". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Pretty-print a Telegram user, falling back to "there" when no name. */
export function userLabel(u: { first_name?: string; username?: string } | undefined): string {
  if (!u) return "there";
  if (u.first_name) return u.first_name;
  if (u.username) return `@${u.username}`;
  return "there";
}

/** Confirm-yes/no button row (kept here so handlers don't have to import the
 *  toolkit's confirmKeyboard only to override labels sometimes). */
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
export function yesNoKeyboard(prefix: string, yes = "✅ Yes", no = "❌ No") {
  return inlineKeyboard([[inlineButton(yes, `${prefix}:yes`), inlineButton(no, `${prefix}:no`)]]);
}