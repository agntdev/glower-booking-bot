// Date / timezone helpers for booking flow. Handlers ask this module to produce
// slot lists for a given date in studio-local time. Avoid pulling in date-fns or
// luxon — the bot only needs a handful of operations.
//
// Time strategy: settings.timezone is an IANA string; we use Intl.DateTimeFormat
// to compute the studio-local YYYY-MM-DD / HH:mm for any epoch ms. Slots are
// generated in studio-local time then converted back to epoch ms via Date.UTC.

import type { BusinessHour, Settings, SlotOption } from "../types.js";

/** Format epoch ms as YYYY-MM-DD in the given IANA tz. */
export function fmtDateKey(epochMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Format epoch ms as "Mon 26 Jun" in the given tz — short, button-friendly. */
export function fmtDateLabel(epochMs: number, tz: string): string {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(epochMs));
  return label; // "Tue 26 Jun"
}

/** Format epoch ms as HH:mm in the given tz. */
export function fmtTime(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/** Day-of-week (0=Sun..6=Sat) in studio tz for an epoch ms. */
export function dayOfWeekIn(epochMs: number, tz: string): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date(epochMs));
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[w] ?? 0;
}

/** Start of the studio-local day for an epoch ms (00:00 in that tz), returned as
 *  epoch ms. Approximate via two probes — Intl gives us hour/minute, we strip
 *  them by trial subtraction (handles DST shifts up to a couple hours, which is
 *  far more than a tz offset ever moves within a day). */
export function startOfDayMs(epochMs: number, tz: string): number {
  // Probe: get the YYYY-MM-DD for epoch ms in tz, then for epoch+86400000. The
  // day boundary is whichever probe matches; bisect a 24h window in 1h steps
  // starting from epoch - 12h.
  const targetKey = fmtDateKey(epochMs, tz);
  let lo = epochMs - 12 * 3600_000;
  let hi = epochMs + 12 * 3600_000;
  for (let i = 0; i < 24; i++) {
    const mid = Math.floor((lo + hi) / 2 / 3600_000) * 3600_000;
    const k = fmtDateKey(mid, tz);
    if (k === targetKey) hi = mid; else lo = mid;
  }
  return hi;
}

/** Add `days` days to an epoch ms at the same instant (calendar math is via
 *  studio-local day boundaries, then convert back). */
export function addDays(epochMs: number, days: number): number {
  return epochMs + days * 86400_000;
}

/** Compose an epoch ms from a YYYY-MM-DD and HH:mm in studio tz. */
export function composeEpochMs(dateKey: string, hhmm: string, tz: string): number {
  const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10));
  const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10));
  // Binary search for the epoch ms whose studio-local Y/M/D/HH/MM matches.
  // Studio is somewhere on Earth, so the epoch ms is in [-14h, +14h] of UTC
  // midnight for that date. Search that window.
  const guessUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  let lo = guessUtc - 14 * 3600_000;
  let hi = guessUtc + 14 * 3600_000;
  for (let i = 0; i < 30; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const k = fmtDateKey(mid, tz);
    const t = fmtTime(mid, tz);
    if (k < dateKey || (k === dateKey && t < `${pad2(hh)}:${pad2(mm)}`)) lo = mid;
    else hi = mid;
  }
  return Math.floor((lo + hi) / 2);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Find the business-hour row for a given day-of-week in studio tz. */
function hoursFor(day: number, hours: BusinessHour[]): BusinessHour | null {
  return hours.find((h) => h.dayOfWeek === day) ?? null;
}

/** Generate the available slots for a given dateKey (YYYY-MM-DD) in studio tz,
 *  excluding any time that is already booked or before now+leadMinutes. */
export function slotsForDate(
  dateKey: string,
  settings: Settings,
  nowEpochMs: number,
  takenEpochs: ReadonlySet<number>,
): SlotOption[] {
  const tz = settings.timezone;
  const row = hoursFor(dayOfWeekIn(composeEpochMs(dateKey, "12:00", tz), tz), settings.businessHours);
  if (!row) return [];
  const out: SlotOption[] = [];
  const minStart = nowEpochMs + settings.leadMinutes * 60_000;
  for (let mm = row.openMinute; mm + settings.slotMinutes <= row.closeMinute; mm += settings.slotMinutes) {
    const hh = Math.floor(mm / 60);
    const mn = mm % 60;
    const startMs = composeEpochMs(dateKey, `${pad2(hh)}:${pad2(mn)}`, tz);
    if (startMs < minStart) continue;
    if (takenEpochs.has(startMs)) continue;
    out.push({
      startEpochMs: startMs,
      dateKey,
      timeLabel: fmtTime(startMs, tz),
    });
  }
  return out;
}

/** All bookable dates (next horizonDays) as YYYY-MM-DD strings in studio tz. */
export function bookableDateKeys(settings: Settings, nowEpochMs: number): string[] {
  const tz = settings.timezone;
  const out: string[] = [];
  for (let i = 0; i < settings.horizonDays; i++) {
    const dayEpoch = addDays(nowEpochMs, i);
    out.push(fmtDateKey(dayEpoch, tz));
  }
  // Defensive: dedup in case of DST.
  return [...new Set(out)];
}

/** Default settings applied when no settings row exists. */
export function defaultSettings(): Settings {
  return {
    timezone: process.env.DEFAULT_TZ || "Europe/Berlin",
    // Mon-Sat 09:00-18:00. (Closed Sunday.)
    businessHours: [
      { dayOfWeek: 1, openMinute: 9 * 60, closeMinute: 18 * 60 },
      { dayOfWeek: 2, openMinute: 9 * 60, closeMinute: 18 * 60 },
      { dayOfWeek: 3, openMinute: 9 * 60, closeMinute: 18 * 60 },
      { dayOfWeek: 4, openMinute: 9 * 60, closeMinute: 18 * 60 },
      { dayOfWeek: 5, openMinute: 9 * 60, closeMinute: 18 * 60 },
      { dayOfWeek: 6, openMinute: 9 * 60, closeMinute: 18 * 60 },
    ],
    slotMinutes: 15,
    leadMinutes: 60,
    horizonDays: 30,
    studioName: "GlowEr",
    contactInfo: "📍 Friedrichstr. 1, Berlin · ☎️ +49 30 1234567 · ✉️ hello@glower.example",
    adminIds: [],
  };
}