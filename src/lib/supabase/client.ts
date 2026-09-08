// ============================================================================
// SUPABASE CLIENT (browser) — used by Client Components
//
// Talks to Supabase from the user's browser. It only ever sees the PUBLIC anon
// key; the database's per-user rules are what actually protect the data.
// ============================================================================
import { createBrowserClient } from "@supabase/ssr";

// Supabase client for use in the browser (Client Components).
// It only ever sees the public anon key, never any secret.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
