// ============================================================================
// COURSES — read the user's synced/removed courses and remove/re-add them
//
// Server-only. Every query runs as the signed-in user, so the database's
// per-user rules (RLS) guarantee a user only ever touches their own rows.
//
// "Removing" a course is a soft delete + suppression: we delete its synced
// assignments/class events AND record its Canvas id in hidden_courses, which the
// Canvas sync then skips — so a removed course's assignments never come back.
// Re-adding just forgets the suppression; the next sync repulls it.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CourseSummary = {
  canvasCourseId: number;
  name: string;
};

// The user's synced courses split into the ones still shown ("active") and the
// ones they've removed ("removed"). Both come from the courses snapshot; the
// split is by membership in hidden_courses.
export async function listSettingsCourses(): Promise<{
  active: CourseSummary[];
  removed: CourseSummary[];
}> {
  const supabase = await createClient();
  const [{ data: courses }, { data: hidden }] = await Promise.all([
    supabase
      .from("courses")
      .select("canvas_course_id, name")
      .order("name", { ascending: true }),
    supabase.from("hidden_courses").select("canvas_course_id"),
  ]);

  const hiddenSet = new Set(
    (hidden ?? []).map((h) => Number(h.canvas_course_id))
  );

  const active: CourseSummary[] = [];
  const removed: CourseSummary[] = [];
  for (const c of (courses ?? []) as { canvas_course_id: number; name: string }[]) {
    const summary: CourseSummary = {
      canvasCourseId: Number(c.canvas_course_id),
      name: c.name,
    };
    (hiddenSet.has(summary.canvasCourseId) ? removed : active).push(summary);
  }
  return { active, removed };
}

// The Canvas course ids this user has removed. The sync uses this to skip them.
export async function getHiddenCanvasCourseIds(): Promise<Set<number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hidden_courses")
    .select("canvas_course_id");
  return new Set((data ?? []).map((h) => Number(h.canvas_course_id)));
}

// Remove a course: delete its synced assignments + class events for this user,
// then record it as hidden so the next sync won't re-pull it. We keep the
// courses row so the "Removed courses" list can still show the course's name.
export async function hideCourse(canvasCourseId: number): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // RLS scopes each of these to the current user's own rows.
  const del = await supabase
    .from("assignments")
    .delete()
    .eq("canvas_course_id", canvasCourseId);
  if (del.error) throw new Error(del.error.message);

  const delEvents = await supabase
    .from("class_events")
    .delete()
    .eq("canvas_course_id", canvasCourseId);
  if (delEvents.error) throw new Error(delEvents.error.message);

  const hide = await supabase.from("hidden_courses").upsert(
    {
      user_id: user.id,
      canvas_course_id: canvasCourseId,
      hidden_at: new Date().toISOString(),
    },
    { onConflict: "user_id,canvas_course_id" }
  );
  if (hide.error) throw new Error(hide.error.message);
}

// Re-add a course: forget that it was hidden. The next sync repulls it.
export async function unhideCourse(canvasCourseId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("hidden_courses")
    .delete()
    .eq("canvas_course_id", canvasCourseId);
  if (error) throw new Error(error.message);
}
