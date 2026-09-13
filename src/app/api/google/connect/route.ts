// ============================================================================
// GOOGLE CALENDAR — CONNECT (URL: "/api/google/connect")
//
// Starts the read-only Google Calendar OAuth flow: mints a CSRF `state`, stashes
// it in a short-lived httpOnly cookie, and redirects the user to Google's
// consent screen. Google sends them back to /api/google/callback.
//
// The user is already signed in here (the proxy enforces auth on app routes), so
// the callback can store the tokens under their account.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { buildGoogleAuthUrl } from "@/lib/google-oauth";

// Name of the cookie holding the CSRF state between connect and callback.
export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

export async function GET(_request: NextRequest) {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const authUrl = buildGoogleAuthUrl(state);

    const response = NextResponse.redirect(authUrl);
    // Short-lived, httpOnly: only the callback reads it, to confirm the redirect
    // came from a flow this browser started.
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10, // 10 minutes
    });
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not start Google sign-in.";
    return NextResponse.redirect(
      new URL(
        `/settings?google=error&reason=${encodeURIComponent(message)}`,
        _request.url
      )
    );
  }
}
