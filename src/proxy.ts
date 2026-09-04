import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js "proxy" convention (the successor to the old "middleware" file):
// runs on every matched request. We use it to keep the Supabase auth session
// fresh and to redirect signed-out users to the login page.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on all routes except static files and images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
