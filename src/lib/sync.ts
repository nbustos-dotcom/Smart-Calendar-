// ============================================================================
// CANVAS SYNC — pull the student's Canvas data into our database
//
// Read-only against Canvas; everything it writes is the current user's own rows
// (the database's per-user rules enforce that). It records an honest ok/error
// status so the UI can show exactly what happened.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  getCredentials,
  recordSyncResult,
} from "@/lib/canvas-connection";
import {
  getCourses,
  getAssignmentsForCourse,
  getCalendarEvents,
  CanvasError,
} from "@/lib/canvas";
import {
  mapCourse,
  mapAssignment,
  mapClassEvent,
} from "@/lib/canvas-parse";
import { getHiddenCanvasCourseIds } from "@/lib/courses";

export type SyncResult =
  | { ok: true; courses: number; assignments: number; events: number }
  | { ok: false; error: string };

// Pull the user's Canvas data into our database. Read-only against Canvas;
// everything it writes is the current user's own rows (RLS enforces that).
export async function syncCanvas(): Promise<SyncResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const creds = await getCredentials();
  if (!creds) {
    return { ok: false, error: "No Canvas token saved yet." };
  }

  try {
    // 1) Courses ------------------------------------------------------------
    const rawCourses = await getCourses(creds);
    const courseRows = rawCourses
      .map(mapCourse)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({ ...c, user_id: user.id }));

    if (courseRows.length > 0) {
      const { error } = await supabase
        .from("courses")
        .upsert(courseRows, { onConflict: "user_id,canvas_course_id" });
      if (error) throw new Error(`Saving courses failed: ${error.message}`);
    }

    // Build a map from Canvas course id -> our course row id, so we can link
    // assignments and events to the right course.
    const { data: savedCourses } = await supabase
      .from("courses")
      .select("id, canvas_course_id");
    const courseIdByCanvasId = new Map<number, string>();
    for (const row of savedCourses ?? []) {
      courseIdByCanvasId.set(row.canvas_course_id, row.id);
    }

    // Courses the user has REMOVED are skipped here, so their assignments and
    // events never get re-inserted on a sync. (The course row itself stays, so
    // Settings can still show the removed course by name and offer "Re-add".)
    const hiddenCourseIds = await getHiddenCanvasCourseIds();
    const canvasCourseIds = [...courseIdByCanvasId.keys()].filter(
      (id) => !hiddenCourseIds.has(id)
    );

    // 2) Assignments (per course) ------------------------------------------
    let assignmentCount = 0;
    for (const canvasCourseId of canvasCourseIds) {
      const rawAssignments = await getAssignmentsForCourse(
        creds,
        canvasCourseId
      );
      const rows = rawAssignments
        .map(mapAssignment)
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map((a) => ({
          user_id: user.id,
          canvas_assignment_id: a.canvas_assignment_id,
          canvas_course_id: a.canvas_course_id,
          course_id: courseIdByCanvasId.get(a.canvas_course_id) ?? null,
          title: a.title,
          due_at: a.due_at,
          unlock_at: a.unlock_at,
          lock_at: a.lock_at,
          points_possible: a.points_possible,
          submission_types: a.submission_types,
          assignment_group_id: a.assignment_group_id,
          html_url: a.html_url,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("assignments")
          .upsert(rows, { onConflict: "user_id,canvas_assignment_id" });
        if (error)
          throw new Error(`Saving assignments failed: ${error.message}`);
        assignmentCount += rows.length;
      }
    }

    // 3) Class calendar events ---------------------------------------------
    // Window: a week back (to catch this week) through ~4 months ahead.
    const start = isoDate(daysFromNow(-7));
    const end = isoDate(daysFromNow(120));
    const rawEvents =
      canvasCourseIds.length > 0
        ? await getCalendarEvents(creds, canvasCourseIds, start, end)
        : [];

    const eventRows = rawEvents
      .map(mapClassEvent)
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map((e) => ({
        user_id: user.id,
        canvas_event_id: e.canvas_event_id,
        canvas_course_id: e.canvas_course_id,
        course_id:
          e.canvas_course_id != null
            ? courseIdByCanvasId.get(e.canvas_course_id) ?? null
            : null,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        location_name: e.location_name,
        html_url: e.html_url,
        updated_at: new Date().toISOString(),
      }));

    if (eventRows.length > 0) {
      const { error } = await supabase
        .from("class_events")
        .upsert(eventRows, { onConflict: "user_id,canvas_event_id" });
      if (error) throw new Error(`Saving class events failed: ${error.message}`);
    }

    await recordSyncResult("ok", null);
    return {
      ok: true,
      courses: courseRows.length,
      assignments: assignmentCount,
      events: eventRows.length,
    };
  } catch (err) {
    // Surface the real reason, honestly, and store it so the UI can show it.
    const message =
      err instanceof CanvasError || err instanceof Error
        ? err.message
        : "Unknown error during sync.";
    await recordSyncResult("error", message);
    return { ok: false, error: message };
  }
}

// --- tiny date helpers --------------------------------------------------------

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
