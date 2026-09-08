// ============================================================================
// SIGN-OUT ROUTE (URL: "/auth/signout")
//
// Ends the user's session and sends them back to the login page.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Sign the user out and send them to the login page.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
