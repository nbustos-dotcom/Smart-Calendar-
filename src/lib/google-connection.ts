// ============================================================================
// GOOGLE CALENDAR CONNECTION — store and read the (encrypted) Google OAuth tokens
//
// Mirrors src/lib/canvas-connection.ts: saves/reads/clears the current user's
// Google Calendar tokens. The access + refresh tokens are the real secrets, so
// they are encrypted (AES-256-GCM, src/lib/crypto.ts) before they ever reach the
// database, and the decrypted values never leave the server.
//
// This module only handles the CONNECTION (OAuth token storage). Fetching or
// displaying calendar events is a separate later step and lives elsewhere.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";

// The read-only Calendar scope this app requests.
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

// What a page needs to know about the connection WITHOUT ever seeing the tokens.
export type GoogleConnectionStatus = {
  connected: boolean;
  connectedAt: string | null;
  scope: string | null;
};

// The token set returned by Google's token endpoint, as we store it.
export type GoogleTokens = {
  accessToken: string;
  // Google only returns a refresh token on first consent (or with
  // prompt=consent). When absent, we keep whatever we already had.
  refreshToken: string | null;
  // Seconds until the access token expires (from Google's `expires_in`).
  expiresInSeconds: number | null;
  scope: string | null;
};

// Read the current user's Google connection status. Never returns the tokens.
export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_connections")
    .select("created_at, scope")
    .maybeSingle();

  if (!data) {
    return { connected: false, connectedAt: null, scope: null };
  }
  return {
    connected: true,
    connectedAt: data.created_at,
    scope: data.scope ?? null,
  };
}

// Save (or replace) the user's Google tokens, encrypted. RLS + the user_id below
// guarantee this only ever writes the current user's row. If Google didn't hand
// back a new refresh token this time, we preserve the one we already stored so
// the connection keeps working.
export async function saveGoogleTokens(tokens: GoogleTokens): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  let refreshEncrypted: string | null = tokens.refreshToken
    ? encrypt(tokens.refreshToken)
    : null;

  // Don't clobber an existing refresh token with null on a re-consent that
  // didn't return one.
  if (!refreshEncrypted) {
    const { data: existing } = await supabase
      .from("google_connections")
      .select("refresh_token_encrypted")
      .maybeSingle();
    refreshEncrypted = existing?.refresh_token_encrypted ?? null;
  }

  const expiry =
    tokens.expiresInSeconds != null
      ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString()
      : null;

  const { error } = await supabase.from("google_connections").upsert(
    {
      user_id: user.id,
      access_token_encrypted: encrypt(tokens.accessToken),
      refresh_token_encrypted: refreshEncrypted,
      token_expiry: expiry,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(error.message);
}

// Remove the Google connection entirely (revokes nothing on Google's side; the
// user can also revoke access from their Google Account settings).
export async function clearGoogleConnection(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("google_connections")
    .delete()
    .not("user_id", "is", null);
  if (error) throw new Error(error.message);
}

// Decrypted tokens for the current user, for SERVER use by a later event-fetch
// step. Returns null if the user has no connection. The decrypted tokens stay on
// the server and are never returned to the browser. (Not used yet.)
export async function getGoogleCredentials(): Promise<{
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: string | null;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_connections")
    .select("access_token_encrypted, refresh_token_encrypted, token_expiry")
    .maybeSingle();

  if (!data) return null;
  return {
    accessToken: decrypt(data.access_token_encrypted),
    refreshToken: data.refresh_token_encrypted
      ? decrypt(data.refresh_token_encrypted)
      : null,
    tokenExpiry: data.token_expiry ?? null,
  };
}
