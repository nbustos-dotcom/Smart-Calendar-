"use server";

// ============================================================================
// SETTINGS SERVER ACTIONS — the buttons on the Settings page call these
//
// These functions run on the SERVER only (that's what "use server" means): save
// and verify the Canvas token, sync now, and remove the token. Running on the
// server keeps the token and encryption away from the browser.
// ============================================================================

import { revalidatePath } from "next/cache";
import {
  saveToken,
  clearToken,
  CANVAS_BASE_URL,
} from "@/lib/canvas-connection";
import { getSelf } from "@/lib/canvas";
import { syncCanvas } from "@/lib/sync";

export type ActionState = { ok: boolean; message: string } | null;

// Save the pasted token — but only after checking it actually works, so we
// never store a dead token and pretend everything is fine.
export async function saveTokenAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    return { ok: false, message: "Please paste your Canvas token first." };
  }

  // Verify the token against Canvas before saving it.
  try {
    const me = await getSelf({ baseUrl: CANVAS_BASE_URL, token });
    await saveToken(token);
    revalidatePath("/settings");
    revalidatePath("/");
    return {
      ok: true,
      message: `Token saved and verified for ${me.name}. You can sync now.`,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not verify the token.";
    return { ok: false, message };
  }
}

export async function clearTokenAction(): Promise<ActionState> {
  await clearToken();
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, message: "Canvas token removed." };
}

export async function syncNowAction(): Promise<ActionState> {
  const result = await syncCanvas();
  revalidatePath("/settings");
  revalidatePath("/");
  if (result.ok) {
    return {
      ok: true,
      message: `Synced ${result.courses} courses, ${result.assignments} assignments, ${result.events} class events.`,
    };
  }
  return { ok: false, message: result.error };
}
