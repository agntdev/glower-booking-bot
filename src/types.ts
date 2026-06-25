// Domain types for the GlowEr booking bot. All durable records persist via the
// toolkit's store (Redis in production, in-memory fallback for dev/test).

export interface User {
  id: number;            // Telegram user id
  name: string;          // Display name (Telegram first_name or updated)
  username?: string;     // Telegram @username (optional)
  phone?: string;        // E.164 or local format; optional (bookings work without)
  timezone?: string;     // IANA tz (per-user override; usually inherits studio tz)
  createdAt: number;     // epoch ms
}

export interface Service {
  id: number;
  title: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  /** Telegram file_id of the thumbnail (optional). */
  thumbnailFileId?: string;
  category?: string;
  active: boolean;       // false = hidden from booking, kept for past records
}

export type BookingStatus =
  | "confirmed"
  | "cancelled_by_user"
  | "cancelled_by_admin"
  | "completed";

export interface Booking {
  id: number;
  userId: number;
  serviceId: number;
  /** epoch ms of slot start (studio-local, recorded as absolute UTC) */
  startEpochMs: number;
  durationMinutes: number;
  status: BookingStatus;
  notes?: string;
  createdAt: number;     // epoch ms
  /** set true once the post-appointment follow-up has been sent */
  followUpSent: boolean;
}

export interface PortfolioItem {
  id: number;
  fileId: string;        // Telegram file_id
  caption?: string;
  serviceIds: number[];  // empty array = visible under "all"
  createdAt: number;
}

export interface Review {
  id: number;
  userId: number;
  /** Optional 1-5 star rating. */
  rating?: number;
  text: string;
  /** Telegram file_ids, 0..10 entries. */
  photos: string[];
  createdAt: number;
  visible: boolean;      // false = removed by admin (hidden from public)
  /** Admin reply text, if any. */
  adminReply?: string;
  /** Optional booking id this review originated from (post-appointment flow). */
  bookingId?: number;
}

export interface BusinessHour {
  /** 0 = Sunday, 1 = Monday, ... 6 = Saturday (matches JS Date.getDay()). */
  dayOfWeek: number;
  /** Minutes since midnight in studio timezone (e.g. 540 = 09:00). */
  openMinute: number;
  closeMinute: number;
}

export interface Settings {
  /** IANA timezone, e.g. "Europe/Berlin". Default: server local or "UTC". */
  timezone: string;
  businessHours: BusinessHour[];
  /** Slot granularity in minutes. Default 15. */
  slotMinutes: number;
  /** Minimum lead time in minutes before the next bookable slot. Default 60. */
  leadMinutes: number;
  /** How many days into the future a customer can book. Default 30. */
  horizonDays: number;
  /** Studio display name. */
  studioName: string;
  /** Studio contact line shown to users. */
  contactInfo: string;
  /** Telegram user ids with admin rights. Empty = no admins. */
  adminIds: number[];
}

/** A single time slot the user can pick, with the local-time strings for UI. */
export interface SlotOption {
  /** epoch ms of slot start. */
  startEpochMs: number;
  /** ISO date YYYY-MM-DD in studio tz, for grouping. */
  dateKey: string;
  /** HH:mm display in studio tz. */
  timeLabel: string;
}