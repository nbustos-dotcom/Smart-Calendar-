"use server";

// ============================================================================
// TO-DO SERVER ACTIONS — the write path for the day-scoped to-do list
//
// Runs on the server as the signed-in user, so per-user Row Level Security keeps
// every write to that user's own rows. Manual items live in todo_items; ticking
// off a Canvas assignment writes a row in assignment_done (we never mutate the
// read-only assignments snapshot).
// ============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TodoActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// --- Manual to-do items -----------------------------------------------------

// Add a manual item to a given day (YYYY-MM-DD).
export async function addTodoItemAction(
  day: string,
  text: string
): Promise<TodoActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Item can’t be empty." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, error: "Invalid day." };
  }

  const { data, error } = await supabase
    .from("todo_items")
    .insert({ user_id: user.id, day, text: trimmed, done: false })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true, id: data.id };
}

// Remove a manual item (manual only — assignments are never removable).
export async function removeTodoItemAction(
  id: string
): Promise<TodoActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("todo_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// Toggle a manual item's done state.
export async function setTodoItemDoneAction(
  id: string,
  done: boolean
): Promise<TodoActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("todo_items")
    .update({ done })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// --- Canvas assignment completion (no write-back to the read-only snapshot) --

// Tick a Canvas assignment done (insert a row) or clear it (delete the row).
export async function setAssignmentDoneAction(
  canvasAssignmentId: number,
  done: boolean
): Promise<TodoActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (done) {
    const { error } = await supabase.from("assignment_done").upsert(
      {
        user_id: user.id,
        canvas_assignment_id: canvasAssignmentId,
        done_at: new Date().toISOString(),
      },
      { onConflict: "user_id,canvas_assignment_id" }
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("assignment_done")
      .delete()
      .eq("canvas_assignment_id", canvasAssignmentId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/");
  return { ok: true };
}
