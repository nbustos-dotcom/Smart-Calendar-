// ============================================================================
// GOOGLE CALENDAR — read the connected user's PRIMARY calendar (read-only)
//
// Server-only. Fetches events from the user's `primary` Google calendar over a
// bounded window (never their whole history), refreshing the access token when
// it's expired and persisting the refreshed token (encrypted). Returns the
// events in the app's read-only ClassEventItem shape so they render through the
// same path as Canvas class events.
//
// Graceful by design: if the user hasn't connected Google, or anything goes
// wrong, this returns [] (no Google events, no error) rather than breaking the
// dashboard. We never write to Google — read-only only.
// ============================================================================
import "server-only";
import {
  getGoogleCredentials,
  saveGoogleTokens,
} from "@/lib/google-connection";
import { refreshAccessToken } from "@/lib/google-oauth";
import { mapGoogleEvent, type RawGoogleEvent } from "@/lib/google-calendar-parse";
import type { ClassEventItem } from "@/lib/types";

// How far around "now" we pull. Bounded so we never fetch the whole calendar,
// while comfortably covering the weeks/months the user can navigate to.
const WINDOW_DAYS_BACK = 35;
const WINDOW_DAYS_AHEAD = 120;

// Refresh a little early so an about-to-expire token doesn't 401 mid-request.
const EXPIRY_SKEW_MS = 60 * 1000;

const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function defaultWindow(): { timeMin: string; timeMax: string } {
  const now = Date.now();
  return {
    timeMin: new Date(now - WINDOW_DAYS_BACK * 86400_000).toISOString(),
    timeMax: new Date(now + WINDOW_DAYS_AHEAD * 86400_000).toISOString(),
  };
}

// Return a valid access token, refreshing + persisting it if it's expired.
// Returns null if we can't get one (e.g. no refresh token).
async function getValidAccessToken(creds: {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: string | null;
}): Promise<string | null> {
  const expired =
    creds.tokenExpiry != null &&
    new Date(creds.tokenExpiry).getTime() - EXPIRY_SKEW_MS <= Date.now();

  if (!expired) return creds.accessToken;
  if (!creds.refreshToken) return null; // can't refresh — treat as not usable

  const refreshed = await refreshAccessToken(creds.refreshToken);
  // Persist the new access token (encrypted). saveGoogleTokens preserves the
  // existing refresh token when we pass null, which is what Google returns here.
  await saveGoogleTokens({
    accessToken: refreshed.accessToken,
    refreshToken: null,
    expiresInSeconds: refreshed.expiresInSeconds,
    scope: refreshed.scope,
  });
  return refreshed.accessToken;
}

async function fetchEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<Response> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true", // expand recurring events into concrete instances
    orderBy: "startTime",
    maxResults: "250",
  });
  return fetch(`${EVENTS_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

// The connected user's primary-calendar events for the default window, mapped to
// read-only ClassEventItems. [] when not connected or on any failure.
export async function getGoogleCalendarEvents(): Promise<ClassEventItem[]> {
  try {
    const creds = await getGoogleCredentials();
    if (!creds) return []; // not connected — show no Google events, no error

    let accessToken = await getValidAccessToken(creds);
    if (!accessToken) return [];

    const { timeMin, timeMax } = defaultWindow();
    let res = await fetchEvents(accessToken, timeMin, timeMax);

    // If the token was rejected despite our expiry check, try one refresh.
    if (res.status === 401 && creds.refreshToken) {
      const refreshed = await refreshAccessToken(creds.refreshToken);
      await saveGoogleTokens({
        accessToken: refreshed.accessToken,
        refreshToken: null,
        expiresInSeconds: refreshed.expiresInSeconds,
        scope: refreshed.scope,
      });
      accessToken = refreshed.accessToken;
      res = await fetchEvents(accessToken, timeMin, timeMax);
    }

    if (!res.ok) return [];

    const data = (await res.json()) as { items?: RawGoogleEvent[] };
    return (data.items ?? [])
      .map(mapGoogleEvent)
      .filter((e): e is ClassEventItem => e !== null);
  } catch {
    // Never let a Google hiccup break the dashboard.
    return [];
  }
}
