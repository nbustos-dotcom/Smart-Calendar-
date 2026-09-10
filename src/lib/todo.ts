// ============================================================================
// TO-DO — read the user's manual to-dos and their ticked-off Canvas assignments
//
// Server-only. Every query runs as the signed-in user, so the database's
// per-user rules (RLS) guarantee a user only ever sees their own rows.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";

// A manual to-do row (as the panel needs it).
export type TodoItemRow = {
  id: string;
  day: string; // YYYY-MM-DD (local calendar day)
  text: string;
  done: boolean;
};

// All of the user's manual to-do items, oldest first.
export async function listTodoItems(): Promise<TodoItemRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("todo_items")
    .select("id, day, text, done")
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id,
    day: r.day,
    text: r.text,
    done: r.done,
  }));
}

// The Canvas assignment ids the user has ticked off (presence = done).
export async function listDoneAssignmentIds(): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assignment_done")
    .select("canvas_assignment_id");
  return (data ?? []).map((r) => Number(r.canvas_assignment_id));
}
