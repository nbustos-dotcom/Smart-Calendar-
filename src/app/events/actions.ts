"use server";

// ============================================================================
// EVENT SERVER ACTIONS — the write path for the user's own calendar events
//
// This is the app's first write-to-database code. Everything runs on the server
// as the logged-in user, so per-user Row Level Security guarantees a user can
// only touch their own rows. Canvas / synced data is never touched here.
// ============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { EventPayload } from "@/lib/recurrence";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

// Turn the form payload into a user_events row (minus user_id).
function toEventRow(p: EventPayload) {
  return {
    title: p.title.trim() || "Untitled",
    color: p.color,
    is_recurring: p.isRecurring,
    starts_at: p.isRecurring ? null : p.startsAt,
    ends_at: p.isRecurring ? null : p.endsAt,
    weekdays: p.isRecurring ? p.weekdays : [],
    start_minute: p.isRecurring ? p.startMinute : null,
    end_minute: p.isRecurring ? p.endMinute : null,
    series_start_date: p.isRecurring ? p.seriesStartDate : null,
    updated_at: new Date().toISOString(),
  };
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// --- Create a new event (single or recurring series) ------------------------
export async function createEventAction(
  payload: EventPayload
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Build the exact row we send, so we can log it alongside any failure and
  // compare it column-for-column against the 0002 migration.
  const insertRow = { ...toEventRow(payload), user_id: user.id };

  const { data, error } = await supabase
    .from("user_events")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    // Surface the REAL Postgres/Supabase error to the server console (visible in
    // `next dev` / Vercel logs), not just the friendly message we return to the
    // client. PostgrestError carries message/code/details/hint — all useful:
    //   * code 23502 → a NOT NULL column got null
    //   * code 42703 → the insert names a column the table doesn't have
    //   * code 42501 / "row-level security" → RLS rejected the insert
    //   * code 22P02 → a value didn't match its column type
    console.error("[createEventAction] insert into user_events failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      userId: user.id,
      insertRow,
    });
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  return { ok: true, id: data.id };
}

// --- Edit the WHOLE series (or a single event) ------------------------------
export async function updateSeriesAction(
  id: string,
  payload: EventPayload
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("user_events")
    .update(toEventRow(payload))
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// --- Delete an event (a single event, or a whole series + its overrides) ----
export async function deleteEventAction(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Overrides cascade via the FK, so this removes the whole series cleanly.
  const { error } = await supabase.from("user_events").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// --- Move/resize a SINGLE (non-recurring) event -----------------------------
export async function setSingleEventTimeAction(
  id: string,
  startsAt: string,
  endsAt: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("user_events")
    .update({ starts_at: startsAt, ends_at: endsAt, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("is_recurring", false);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// --- Override ONE occurrence of a recurring series (move/resize/edit) --------
// occurrenceDate is the ORIGINAL pattern date, so the series knows which slot
// this replaces even after the occurrence is dragged elsewhere.
export async function setOccurrenceOverrideAction(
  eventId: string,
  occurrenceDate: string,
  fields: {
    startsAt?: string | null;
    endsAt?: string | null;
    title?: string | null;
    color?: string | null;
  }
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("user_event_overrides").upsert(
    {
      user_id: user.id,
      event_id: eventId,
      occurrence_date: occurrenceDate,
      status: "modified",
      starts_at: fields.startsAt ?? null,
      ends_at: fields.endsAt ?? null,
      title: fields.title ?? null,
      color: fields.color ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id,occurrence_date" }
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// --- Delete ONE occurrence of a recurring series (series continues) ---------
export async function deleteOccurrenceAction(
  eventId: string,
  occurrenceDate: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("user_event_overrides").upsert(
    {
      user_id: user.id,
      event_id: eventId,
      occurrence_date: occurrenceDate,
      status: "cancelled",
      starts_at: null,
      ends_at: null,
      title: null,
      color: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id,occurrence_date" }
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}
