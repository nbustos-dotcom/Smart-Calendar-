"use server";

// ============================================================================
// GOOGLE CALENDAR SETTINGS ACTIONS
//
// Server action(s) for the Google Calendar connection section on Settings. Kept
// in their own file so the whole feature (lib + routes + UI + this action) is
// easy to relocate as a unit. Connecting happens via the OAuth redirect routes
// under /api/google; this only handles disconnecting.
// ============================================================================

import { revalidatePath } from "next/cache";
import { clearGoogleConnection } from "@/lib/google-connection";

export type GoogleActionState = { ok: boolean; message: string } | null;

// Remove the stored Google tokens for the current user.
export async function disconnectGoogleCalendarAction(): Promise<GoogleActionState> {
  try {
    await clearGoogleConnection();
    revalidatePath("/settings");
    return { ok: true, message: "Google Calendar disconnected." };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Could not disconnect Google Calendar.",
    };
  }
}
