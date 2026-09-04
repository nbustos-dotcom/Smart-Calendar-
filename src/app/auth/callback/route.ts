import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google redirects the user back here with a one-time `code`. We swap that
// code for a real session (stored in cookies), then send the user into the app.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If the exchange failed, be honest about it rather than looping silently.
  return NextResponse.redirect(`${origin}/login?error=sign-in-failed`);
}
