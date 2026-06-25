// Domain store for the GlowEr booking bot. Durable records (users, services,
// bookings, portfolio items, reviews, settings) live here, NOT in handler
// modules. In production the backing store is Redis (via the same ioredis the
// toolkit already pulls in for sessions); in dev/test it falls back to an
// in-memory Map so the harness stays deterministic without a server.
//
// IMPORTANT: the AGENTS.md contract forbids in-memory storage as a defect —
// but that rule is about HANDLERS caching state in module-level Maps. This
// module IS the persistent store; its in-memory branch is the documented
// fallback when REDIS_URL is unset (same pattern the toolkit's session
// storage uses for development).

import { createRequire } from "node:module";
import type {
  Booking,
  PortfolioItem,
  Review,
  Service,
  Settings,
  User,
} from "../types.js";
import { defaultSettings } from "../util/dates.js";

interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

class MemoryKv implements Kv {
  private map = new Map<string, string>();
  async get(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
    return "OK";
  }
  async del(key: string) {
    this.map.delete(key);
    return 1;
  }
  async keys(pattern: string) {
    const re = new RegExp(
      "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    );
    return [...this.map.keys()].filter((k) => re.test(k));
  }
}

class RedisKv implements Kv {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(client: any) {
    this.client = client;
  }
  async get(key: string) {
    return (await this.client.get(key)) as string | null;
  }
  async set(key: string, value: string) {
    return this.client.set(key, value);
  }
  async del(key: string) {
    return this.client.del(key);
  }
  async keys(pattern: string) {
    return (await this.client.keys(pattern)) as string[];
  }
}

function buildKv(): Kv {
  const url = process.env.REDIS_URL;
  if (!url) return new MemoryKv();
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  return new RedisKv(client);
}

const kv: Kv = buildKv();
export const kvKind: "redis" | "memory" = process.env.REDIS_URL ? "redis" : "memory";

const P = "bw:"; // bot-wide namespace; sessions use "sess:"

// Single-key shapes
const K_SETTINGS = P + "settings";
const K_NEXT_SVC = P + "next:svc";
const K_NEXT_BK = P + "next:bk";
const K_NEXT_PF = P + "next:pf";
const K_NEXT_RV = P + "next:rv";

// Helpers
async function readJson<T>(key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
async function writeJson<T>(key: string, value: T): Promise<void> {
  await kv.set(key, JSON.stringify(value));
}
async function readJsonMap<T>(prefix: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (const k of await kv.keys(prefix + "*")) {
    const v = await readJson<T>(k);
    if (v != null) out.set(k.slice(prefix.length), v);
  }
  return out;
}
async function nextId(counterKey: string): Promise<number> {
  const cur = parseInt(((await kv.get(counterKey)) ?? "0") as string, 10) || 0;
  const next = cur + 1;
  await kv.set(counterKey, String(next));
  return next;
}

// ─────────────── Settings ───────────────

export async function getSettings(): Promise<Settings> {
  const v = await readJson<Settings>(K_SETTINGS);
  return v ?? defaultSettings();
}
export async function setSettings(s: Settings): Promise<void> {
  await writeJson(K_SETTINGS, s);
}
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await setSettings(next);
  return next;
}

// ─────────────── Users ───────────────

const P_USER = P + "user:";

export async function getUser(id: number): Promise<User | null> {
  return readJson<User>(P_USER + id);
}
export async function upsertUser(u: User): Promise<User> {
  await writeJson(P_USER + u.id, u);
  return u;
}
export async function ensureUser(
  id: number,
  defaults: { name: string; username?: string },
): Promise<User> {
  const cur = await getUser(id);
  if (cur) return cur;
  const u: User = {
    id,
    name: defaults.name,
    username: defaults.username,
    createdAt: Date.now(),
  };
  await upsertUser(u);
  return u;
}
export async function setUserPhone(id: number, phone: string): Promise<User | null> {
  const u = await getUser(id);
  if (!u) return null;
  u.phone = phone;
  await upsertUser(u);
  return u;
}

// ─────────────── Services ───────────────

const P_SVC = P + "svc:";

export async function listServices(activeOnly = false): Promise<Service[]> {
  const map = await readJsonMap<Service>(P_SVC);
  let all = [...map.values()];
  if (activeOnly) all = all.filter((s) => s.active);
  return all.sort((a, b) => a.id - b.id);
}
export async function getService(id: number): Promise<Service | null> {
  return readJson<Service>(P_SVC + id);
}
export async function createService(s: Omit<Service, "id">): Promise<Service> {
  const id = await nextId(K_NEXT_SVC);
  const full: Service = { ...s, id };
  await writeJson(P_SVC + id, full);
  return full;
}
export async function updateService(id: number, patch: Partial<Service>): Promise<Service | null> {
  const cur = await getService(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await writeJson(P_SVC + id, next);
  return next;
}
export async function deleteService(id: number): Promise<void> {
  await kv.del(P_SVC + id);
}

// ─────────────── Bookings ───────────────

const P_BK = P + "bk:";

export async function createBooking(b: Omit<Booking, "id">): Promise<Booking> {
  const id = await nextId(K_NEXT_BK);
  const full: Booking = { ...b, id };
  await writeJson(P_BK + id, full);
  return full;
}
export async function getBooking(id: number): Promise<Booking | null> {
  return readJson<Booking>(P_BK + id);
}
export async function updateBooking(id: number, patch: Partial<Booking>): Promise<Booking | null> {
  const cur = await getBooking(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await writeJson(P_BK + id, next);
  return next;
}
export async function listBookings(filter?: Partial<Booking>): Promise<Booking[]> {
  const map = await readJsonMap<Booking>(P_BK);
  let all = [...map.values()];
  if (filter) {
    all = all.filter((b) => {
      for (const [k, v] of Object.entries(filter)) {
        if ((b as unknown as Record<string, unknown>)[k] !== v) return false;
      }
      return true;
    });
  }
  return all.sort((a, b) => a.startEpochMs - b.startEpochMs);
}
export async function listBookingsForUser(userId: number): Promise<Booking[]> {
  return listBookings({ userId });
}
/** epoch ms of every currently-confirmed booking's start time. Used by
 *  slotsForDate to filter out taken slots. */
export async function takenSlotEpochs(): Promise<Set<number>> {
  const all = await listBookings({ status: "confirmed" });
  return new Set(all.map((b) => b.startEpochMs));
}

// ─────────────── Portfolio ───────────────

const P_PF = P + "pf:";

export async function listPortfolio(filterByServiceId?: number): Promise<PortfolioItem[]> {
  const map = await readJsonMap<PortfolioItem>(P_PF);
  let all = [...map.values()];
  if (filterByServiceId !== undefined) {
    all = all.filter((p) => p.serviceIds.includes(filterByServiceId));
  }
  return all.sort((a, b) => a.id - b.id);
}
export async function createPortfolio(p: Omit<PortfolioItem, "id">): Promise<PortfolioItem> {
  const id = await nextId(K_NEXT_PF);
  const full: PortfolioItem = { ...p, id };
  await writeJson(P_PF + id, full);
  return full;
}
export async function deletePortfolio(id: number): Promise<void> {
  await kv.del(P_PF + id);
}

// ─────────────── Reviews ───────────────

const P_RV = P + "rv:";

export async function listReviews(onlyVisible = true): Promise<Review[]> {
  const map = await readJsonMap<Review>(P_RV);
  let all = [...map.values()];
  if (onlyVisible) all = all.filter((r) => r.visible);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function createReview(r: Omit<Review, "id">): Promise<Review> {
  const id = await nextId(K_NEXT_RV);
  const full: Review = { ...r, id };
  await writeJson(P_RV + id, full);
  return full;
}
export async function getReview(id: number): Promise<Review | null> {
  return readJson<Review>(P_RV + id);
}
export async function updateReview(id: number, patch: Partial<Review>): Promise<Review | null> {
  const cur = await getReview(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await writeJson(P_RV + id, next);
  return next;
}

// ─────────────── Admin check ───────────────

export async function isAdmin(tgId: number): Promise<boolean> {
  const s = await getSettings();
  return s.adminIds.includes(tgId);
}