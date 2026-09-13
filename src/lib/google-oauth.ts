// ============================================================================
// GOOGLE OAUTH 2.0 (web server flow) — read-only Calendar connection
//
// Server-only helpers for the standard Google OAuth 2.0 authorization-code flow:
// build the consent URL, and exchange the returned code for tokens. We ask for
// OFFLINE access so Google issues a refresh token (needed to keep reading
// without making the user re-consent). Uses plain fetch — no extra dependency.
//
// This module does the OAuth handshake only; it does not touch Calendar data.
// ============================================================================
import "server-only";
import { GOOGLE_CALENDAR_SCOPE, type GoogleTokens } from "@/lib/google-connection";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

// Read the OAuth config from the environment, failing loudly if it's missing so
// misconfiguration is obvious rather than a vague OAuth error later.
export function getGoogleOAuthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, " +
        "GOOGLE_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// The consent-screen URL to send the user to. `state` is our CSRF token, which
// the callback verifies against a cookie.
export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    // offline + consent → Google returns a refresh token (every time), so we can
    // keep reading the calendar without prompting the user again.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// Use a stored refresh token to get a fresh access token (Google does NOT
// return a new refresh token here, so the caller keeps the existing one). This
// is what offline access buys us: reading the calendar without re-consent.
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number | null;
  scope: string | null;
}> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) {
    throw new Error("Google token refresh returned no access token.");
  }
  return {
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in ?? null,
    scope: data.scope ?? null,
  };
}

// Exchange the one-time authorization `code` for access + refresh tokens.
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) {
    throw new Error("Google token exchange returned no access token.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSeconds: data.expires_in ?? null,
    scope: data.scope ?? null,
  };
}
