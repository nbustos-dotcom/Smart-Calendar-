// ============================================================================
// CANVAS CONNECTION — store and read the (encrypted) Canvas token
//
// Saves/reads/clears the current user's Canvas token, and hands the DECRYPTED
// credentials to the sync. Server-only; the token never reaches the browser.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import type { CanvasCredentials } from "@/lib/canvas";

// The fixed Canvas base URL for this app (see CLAUDE.md).
export const CANVAS_BASE_URL = "https://mtu.instructure.com";

// What a page needs to know about the connection WITHOUT ever seeing the token.
export type ConnectionStatus = {
  connected: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: "never" | "ok" | "error";
  lastSyncError: string | null;
};

// Read the current user's connection status. Never returns the token.
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canvas_connections")
    .select("last_synced_at, last_sync_status, last_sync_error")
    .maybeSingle();

  if (!data) {
    return {
      connected: false,
      lastSyncedAt: null,
      lastSyncStatus: "never",
      lastSyncError: null,
    };
  }

  return {
    connected: true,
    lastSyncedAt: data.last_synced_at,
    lastSyncStatus: data.last_sync_status,
    lastSyncError: data.last_sync_error,
  };
}

// Save (or replace) the user's Canvas token, encrypted. The RLS policy plus the
// user_id below guarantee this only ever writes the current user's row.
export async function saveToken(token: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase.from("canvas_connections").upsert(
    {
      user_id: user.id,
      canvas_base_url: CANVAS_BASE_URL,
      access_token_encrypted: encrypt(token),
      // Saving a new token resets sync state; nothing has been pulled yet.
      last_sync_status: "never",
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(error.message);
}

// Remove the connection entirely (also leaves synced rows in place; the user
// can delete those separately if we add that later).
export async function clearToken(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("canvas_connections").delete().not(
    "user_id",
    "is",
    null
  );
  if (error) throw new Error(error.message);
}

// Get decrypted credentials for the current user, for use by the sync only.
// Returns null if the user has no connection. The decrypted token stays on the
// server and is never returned to the browser.
export async function getCredentials(): Promise<CanvasCredentials | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canvas_connections")
    .select("canvas_base_url, access_token_encrypted")
    .maybeSingle();

  if (!data) return null;

  return {
    baseUrl: data.canvas_base_url,
    token: decrypt(data.access_token_encrypted),
  };
}

// Record the outcome of a sync so the UI can show freshness / errors honestly.
export async function recordSyncResult(
  status: "ok" | "error",
  errorMessage: string | null
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("canvas_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .not("user_id", "is", null);
}
