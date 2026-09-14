// ============================================================================
// GOOGLE CALENDAR EVENT COLORS — the fixed event-color palette (deterministic)
//
// Google Calendar events carry a `colorId` (1..11) into a well-known, fixed
// "event" color palette. We map that id to the same hex Google uses, so an event
// shows the colour the user picked in Google. This is Google's published palette
// — a constant, not a guess. Events with no colorId fall back to a sensible
// default (Peacock blue, Google's usual default event colour).
//
// Pure + no network so it can be unit-tested and used on the server or client.
// ============================================================================

// colorId ("1".."11") -> hex, matching Google Calendar's event palette.
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986CB", // Lavender
  "2": "#33B679", // Sage
  "3": "#8E24AA", // Grape
  "4": "#E67C73", // Flamingo
  "5": "#F6BF26", // Banana
  "6": "#F4511E", // Tangerine
  "7": "#039BE5", // Peacock
  "8": "#616161", // Graphite
  "9": "#3F51B5", // Blueberry
  "10": "#0B8043", // Basil
  "11": "#D50000", // Tomato
};

// Used when an event has no colorId (it inherits the calendar's colour, which we
// don't fetch — a calm blue is the sensible, Google-ish stand-in).
export const DEFAULT_GOOGLE_COLOR = "#039BE5"; // Peacock

// Resolve a colorId to a hex, falling back to the default for missing/unknown.
export function googleColorHex(colorId?: string | null): string {
  if (colorId && GOOGLE_EVENT_COLORS[colorId]) return GOOGLE_EVENT_COLORS[colorId];
  return DEFAULT_GOOGLE_COLOR;
}

// "#RRGGBB" -> "rgba(r, g, b, a)". Returns the original string if it's not a
// 6-digit hex. Used to lay the event colour down as a SUBTLE tint behind
// theme-token text, so it stays legible in light, dark, and hyper-focus (the
// colour is an accent, never the text/background contrast pair).
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
