// ============================================================================
// SUPABASE CLIENT (server) — used by Server Components, routes, and actions
//
// Reads the signed-in user's session from cookies, so every query runs AS that
// user and the database's per-user rules keep them to their own rows.
// ============================================================================
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase client for use on the server (Server Components, Route Handlers,
// Server Actions). It reads the logged-in user's session from cookies, so
// every query runs *as that user* and Row Level Security keeps them to their
// own rows.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a Server Component the cookie store is read-only; the try/catch
          // lets those calls no-op. The middleware is what actually refreshes
          // the session cookie on each request.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    }
  );
}
