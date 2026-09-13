// ============================================================================
// GOOGLE CALENDAR PARSING — pure mappers (no network, fully testable)
//
// Turns a raw Google Calendar API event into the app's ClassEventItem shape, so
// Google events flow through the exact same read-only rendering path as Canvas
// class events. Deterministic: no guessing, no AI. Kept separate from the
// network code so it can be unit-tested in isolation.
// ============================================================================
import type { ClassEventItem } from "@/lib/types";

// The slice of the Google Calendar Events resource we read.
export type RawGoogleEvent = {
  id?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

// A Google "all-day" event uses `date` ("YYYY-MM-DD") instead of `dateTime`.
// Convert that to local midnight so the calendar treats it as an all-day event
// (its all-day detection keys off a midnight start/end). Returns null if the
// string isn't a plain date.
function localMidnightFromDate(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d)).toISOString();
}

// Resolve a Google start/end object to an ISO instant we store, or null.
function resolveTime(t: RawGoogleEvent["start"]): string | null {
  if (!t) return null;
  if (t.dateTime) {
    const parsed = new Date(t.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (t.date) return localMidnightFromDate(t.date);
  return null;
}

// Map one raw Google event to a ClassEventItem, or null if it can't be placed
// (cancelled, or no id/start). We never invent a time.
export function mapGoogleEvent(raw: RawGoogleEvent): ClassEventItem | null {
  if (!raw.id) return null;
  if (raw.status === "cancelled") return null;

  const start = resolveTime(raw.start);
  if (!start) return null; // undated event — nothing to place on the grid

  return {
    // Namespaced so a Google id can never collide with a Canvas/user event id.
    id: `google:${raw.id}`,
    title: raw.summary?.trim() || "(busy)",
    start_at: start,
    end_at: resolveTime(raw.end),
    location_name: raw.location ?? null,
    html_url: raw.htmlLink ?? null,
    course_name: null,
    source: "google",
  };
}
