// Persistent domain-data store backed by Redis (when REDIS_URL is set) or
// in-memory (development/no Redis). The toolkit's session storage is for
// EPHEMERAL conversation state; this store is for DURABLE data that survives
// restarts: services, bookings, portfolio, reviews, admin accounts, users.

import { createRequire } from "node:module";

/** Minimal async key-value surface. */
interface StorageLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

class InMemoryStore implements StorageLike {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value);
    return "OK";
  }
  async del(key: string): Promise<unknown> {
    this.store.delete(key);
    return 1;
  }
  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replaceAll("*", "");
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

function createRedisClient(): StorageLike {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  const client = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  return client as StorageLike;
}

let _store: StorageLike | undefined;

function resolveStore(): StorageLike {
  if (_store) return _store;
  if (process.env.REDIS_URL) {
    _store = createRedisClient();
  } else {
    _store = new InMemoryStore();
  }
  return _store;
}

export function store(): StorageLike {
  return resolveStore();
}

const PREFIX = "data:";

async function readRaw(key: string): Promise<string | null> {
  return store().get(PREFIX + key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  await store().set(PREFIX + key, value);
}

async function deleteRaw(key: string): Promise<void> {
  await store().del(PREFIX + key);
}

// ── Generic collection helpers ─────────────────────────────────────────────────

export async function readCollection<T>(key: string, defaultVal: T): Promise<T> {
  const raw = await readRaw(key);
  if (!raw) return defaultVal;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultVal;
  }
}

export async function writeCollection<T>(key: string, value: T): Promise<void> {
  await writeRaw(key, JSON.stringify(value));
}

// ── Data types ─────────────────────────────────────────────────────────────────

export interface BotUser {
  userId: number;
  name: string;
  phoneNumber?: string;
  timezone?: string;
}

export interface Service {
  id: string;
  title: string;
  description: string;
  duration: number; // minutes
  price: number;
  photos: string[]; // Telegram file IDs
  category: string;
  active: boolean;
}

export interface PortfolioItem {
  id: string;
  images: string[]; // Telegram file IDs
  caption: string;
  serviceTags: string[]; // service IDs
  createdAt: string; // ISO
}

export interface Booking {
  id: string;
  userId: number;
  userName: string;
  serviceId: string;
  serviceTitle: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  duration: number; // minutes
  status: "confirmed" | "cancelled" | "completed";
  notes: string;
  contactName: string;
  contactPhone: string;
  createdAt: string; // ISO
  followupSent: boolean;
}

export interface Review {
  id: string;
  userId: number;
  userName: string;
  rating: number; // 1-5
  text: string;
  photos: string[]; // Telegram file IDs
  timestamp: string; // ISO
  visible: boolean;
  adminReply?: string;
}

export interface AdminAccount {
  userId: number;
  name: string;
}

// ── Typed entities access ──────────────────────────────────────────────────────

export async function getUsers(): Promise<BotUser[]> {
  return readCollection<BotUser[]>("users", []);
}

export async function saveUsers(users: BotUser[]): Promise<void> {
  await writeCollection("users", users);
}

export async function getUser(userId: number): Promise<BotUser | undefined> {
  const users = await getUsers();
  return users.find((u) => u.userId === userId);
}

export async function upsertUser(user: BotUser): Promise<void> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.userId === user.userId);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  await saveUsers(users);
}

export async function getServices(): Promise<Service[]> {
  return readCollection<Service[]>("services", []);
}

export async function saveServices(services: Service[]): Promise<void> {
  await writeCollection("services", services);
}

export async function getService(id: string): Promise<Service | undefined> {
  const svcs = await getServices();
  return svcs.find((s) => s.id === id);
}

export async function upsertService(svc: Service): Promise<void> {
  const svcs = await getServices();
  const idx = svcs.findIndex((s) => s.id === svc.id);
  if (idx >= 0) svcs[idx] = svc;
  else svcs.push(svc);
  await saveServices(svcs);
}

export async function deleteService(id: string): Promise<void> {
  const svcs = await getServices();
  await saveServices(svcs.filter((s) => s.id !== id));
}

export async function getPortfolioItems(): Promise<PortfolioItem[]> {
  return readCollection<PortfolioItem[]>("portfolio", []);
}

export async function savePortfolioItems(items: PortfolioItem[]): Promise<void> {
  await writeCollection("portfolio", items);
}

export async function getPortfolioItem(id: string): Promise<PortfolioItem | undefined> {
  const items = await getPortfolioItems();
  return items.find((i) => i.id === id);
}

export async function addPortfolioItem(item: PortfolioItem): Promise<void> {
  const items = await getPortfolioItems();
  items.push(item);
  await savePortfolioItems(items);
}

export async function deletePortfolioItem(id: string): Promise<void> {
  const items = await getPortfolioItems();
  await savePortfolioItems(items.filter((i) => i.id !== id));
}

export async function getBookings(): Promise<Booking[]> {
  return readCollection<Booking[]>("bookings", []);
}

export async function saveBookings(bookings: Booking[]): Promise<void> {
  await writeCollection("bookings", bookings);
}

export async function getBooking(id: string): Promise<Booking | undefined> {
  const bookings = await getBookings();
  return bookings.find((b) => b.id === id);
}

export async function upsertBooking(booking: Booking): Promise<void> {
  const bookings = await getBookings();
  const idx = bookings.findIndex((b) => b.id === booking.id);
  if (idx >= 0) bookings[idx] = booking;
  else bookings.push(booking);
  await saveBookings(bookings);
}

export async function getUserBookings(userId: number): Promise<Booking[]> {
  const bookings = await getBookings();
  return bookings.filter((b) => b.userId === userId);
}

export async function getReviews(): Promise<Review[]> {
  return readCollection<Review[]>("reviews", []);
}

export async function saveReviews(reviews: Review[]): Promise<void> {
  await writeCollection("reviews", reviews);
}

export async function getReview(id: string): Promise<Review | undefined> {
  const reviews = await getReviews();
  return reviews.find((r) => r.id === id);
}

export async function upsertReview(review: Review): Promise<void> {
  const reviews = await getReviews();
  const idx = reviews.findIndex((r) => r.id === review.id);
  if (idx >= 0) reviews[idx] = review;
  else reviews.push(review);
  await saveReviews(reviews);
}

export async function deleteReview(id: string): Promise<void> {
  const reviews = await getReviews();
  await saveReviews(reviews.filter((r) => r.id !== id));
}

export async function getAdmins(): Promise<AdminAccount[]> {
  return readCollection<AdminAccount[]>("admins", []);
}

export async function saveAdmins(admins: AdminAccount[]): Promise<void> {
  await writeCollection("admins", admins);
}

export async function isAdmin(userId: number): Promise<boolean> {
  const admins = await getAdmins();
  return admins.some((a) => a.userId === userId);
}

// ── Seed defaults ──────────────────────────────────────────────────────────────

export async function ensureDefaults(): Promise<void> {
  const svcs = await getServices();
  if (svcs.length === 0) {
    const defaults: Service[] = [
      {
        id: "svc_1",
        title: "Classic Manicure",
        description: "Nail shaping, cuticle care, buffing, and polish of your choice.",
        duration: 45,
        price: 35,
        photos: [],
        category: "Nails",
        active: true,
      },
      {
        id: "svc_2",
        title: "Gel Manicure",
        description: "Long-lasting gel polish with nail shaping and cuticle care.",
        duration: 60,
        price: 50,
        photos: [],
        category: "Nails",
        active: true,
      },
      {
        id: "svc_3",
        title: "Spa Pedicure",
        description: "Soothing foot soak, exfoliation, nail care, and massage.",
        duration: 60,
        price: 55,
        photos: [],
        category: "Nails",
        active: true,
      },
      {
        id: "svc_4",
        title: "Classic Facial",
        description: "Deep cleansing, exfoliation, steam, mask, and moisturizer.",
        duration: 60,
        price: 70,
        photos: [],
        category: "Facial",
        active: true,
      },
      {
        id: "svc_5",
        title: "Brow Shaping",
        description: "Wax or tweeze shaping tailored to your face.",
        duration: 20,
        price: 25,
        photos: [],
        category: "Brows",
        active: true,
      },
    ];
    await saveServices(defaults);
  }

  const admins = await getAdmins();
  if (admins.length === 0 && process.env.ADMIN_USER_ID) {
    const id = parseInt(process.env.ADMIN_USER_ID, 10);
    if (!isNaN(id)) {
      await saveAdmins([{ userId: id, name: "Admin" }]);
    }
  }
}

// ── Business hours & timezone defaults ─────────────────────────────────────────

export interface BusinessSettings {
  timezone: string;
  businessHours: {
    mon: [string, string]; // [open, close] HH:MM
    tue: [string, string];
    wed: [string, string];
    thu: [string, string];
    fri: [string, string];
    sat: [string, string];
    sun: [string, string] | null; // null = closed
  };
  slotMinutes: number;
}

const DEFAULT_SETTINGS: BusinessSettings = {
  timezone: "UTC",
  businessHours: {
    mon: ["09:00", "18:00"],
    tue: ["09:00", "18:00"],
    wed: ["09:00", "18:00"],
    thu: ["09:00", "18:00"],
    fri: ["09:00", "18:00"],
    sat: ["09:00", "18:00"],
    sun: null,
  },
  slotMinutes: 15,
};

export async function getSettings(): Promise<BusinessSettings> {
  return readCollection<BusinessSettings>("settings", DEFAULT_SETTINGS);
}

export async function saveSettings(settings: BusinessSettings): Promise<void> {
  await writeCollection("settings", settings);
}
