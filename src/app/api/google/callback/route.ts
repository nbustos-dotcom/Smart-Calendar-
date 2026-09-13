// ============================================================================
// GOOGLE CALENDAR — OAUTH CALLBACK (URL: "/api/google/callback")
//
// Google redirects the user back here after they approve read-only Calendar
// access. We verify the CSRF state, exchange the one-time code for tokens, and
// store them ENCRYPTED under the signed-in user (mirroring the Canvas token).
// Then we send the user back to /settings with a success/error flag.
//
// >>> Register this exact path as the redirect URI in Google Cloud Console <<<
//     Local:      http://localhost:3000/api/google/callback
//     Production: https://smart-calendar-sigma-ten.vercel.app/api/google/callback
//
// We do NOT fetch or display any calendar events here — this only connects.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens } from "@/lib/google-oauth";
import { saveGoogleTokens } from "@/lib/google-connection";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/app/api/google/connect/route";

function settingsRedirect(request: NextRequest, params: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?${params}`, request.url));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  // Google can return an error instead of a code (e.g. the user declined).
  if (providerError) {
    return settingsRedirect(
      request,
      `google=error&reason=${encodeURIComponent(providerError)}`
    );
  }

  // Verify the CSRF state against the cookie we set when starting the flow.
  const expectedState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    const res = settingsRedirect(
      request,
      "google=error&reason=" +
        encodeURIComponent("Sign-in could not be verified. Please try again.")
    );
    res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    return res;
  }

  try {
    // Must be signed in — we store the tokens under this user's account.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const tokens = await exchangeCodeForTokens(code);
    await saveGoogleTokens(tokens);

    const res = settingsRedirect(request, "google=connected");
    res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    return res;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not connect Google Calendar.";
    const res = settingsRedirect(
      request,
      `google=error&reason=${encodeURIComponent(message)}`
    );
    res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    return res;
  }
}
