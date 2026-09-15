// ============================================================================
// STUDY BLOCKS — read the scheduler's output + run the planner (server-only)
//
// `listStudyBlocks` reads the stored blocks for rendering. `runPlanner` is the
// orchestration around the pure engine (src/lib/scheduler.ts): it gathers the
// student's deadlines, resolves each task's duration via the fallback ladder,
// gathers all real busy time (classes, own events, Google, and blocks the
// student manually moved), calls the engine, and persists the result.
//
// Deterministic, read-only Canvas/Google, per-user RLS. No AI.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  planSchedule,
  resolveArchetypeDuration,
  spacingScheduleFor,
  type BusyInterval,
  type LockedSession,
  type PlannableTask,
} from "@/lib/scheduler";
import { SCHEDULER_CONFIG, type Archetype } from "@/lib/scheduler-config";
import { inferArchetype } from "@/lib/task-inference";
import {
  expandOccurrencesForRange,
  type OverrideRow,
  type UserEventRow,
} from "@/lib/recurrence";
import { getGoogleCalendarEvents } from "@/lib/google-calendar";
import { addDays, startOfDay } from "@/lib/calendar";
import { fingerprintInputs } from "@/lib/plan-fingerprint";
import type { StudyBlockItem } from "@/lib/types";

type StudyBlockRow = {
  id: string;
  source_kind: "assignment" | "exam";
  canvas_assignment_id: number | null;
  exam_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  state: "scheduled" | "reserved" | "needs_input";
  reason: string | null;
  archetype: string | null;
  spacing_schedule: string | null;
  moved_by_user: boolean;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole days from the start of today to the start of a target date (used to pick
// a memorization task's spaced-review schedule).
function wholeDaysUntil(now: Date, date: Date): number {
  return Math.max(0, Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY));
}

// Cheap fingerprint of the scheduler's inputs for the current user: assignments,
// entered exams, saved answers, and MOVED study blocks. (Not ordinary busy time
// — per spec, a new personal event alone doesn't force a reflow.)
async function currentInputsHash(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  const [
    { data: assignmentRows },
    { data: examRows },
    { data: overrideRows },
    { data: movedRows },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "canvas_assignment_id, due_at, submitted, graded, title, submission_types, assignment_group_name"
      ),
    supabase.from("exams").select("id, exam_at, est_prep_minutes, title"),
    supabase
      .from("assignment_overrides")
      .select("canvas_assignment_id, task_category, archetype, est_minutes, skip"),
    supabase.from("study_blocks").select("id, starts_at, ends_at").eq("moved_by_user", true),
  ]);

  return fingerprintInputs({
    assignments: ((assignmentRows ?? []) as Record<string, unknown>[]).map((a) => ({
      canvasAssignmentId: Number(a.canvas_assignment_id),
      dueAt: (a.due_at as string | null) ?? null,
      submitted: Boolean(a.submitted),
      graded: Boolean(a.graded),
      title: String(a.title ?? ""),
      submissionTypes: (a.submission_types as string[] | null) ?? [],
      assignmentGroupName: (a.assignment_group_name as string | null) ?? null,
    })),
    exams: ((examRows ?? []) as Record<string, unknown>[]).map((e) => ({
      id: String(e.id),
      examAt: String(e.exam_at),
      estPrepMinutes: (e.est_prep_minutes as number | null) ?? null,
      title: String(e.title ?? ""),
    })),
    overrides: ((overrideRows ?? []) as Record<string, unknown>[]).map((o) => ({
      canvasAssignmentId: Number(o.canvas_assignment_id),
      taskCategory: (o.task_category as string | null) ?? null,
      archetype: (o.archetype as string | null) ?? null,
      estMinutes: (o.est_minutes as number | null) ?? null,
      skip: Boolean(o.skip),
    })),
    movedBlocks: ((movedRows ?? []) as Record<string, unknown>[]).map((m) => ({
      id: String(m.id),
      startsAt: String(m.starts_at),
      endsAt: String(m.ends_at),
    })),
  });
}

// Run the planner AUTOMATICALLY, but only if the inputs changed since last time.
// Called on dashboard load. Cheap on the common path (two small reads + a hash
// compare); only does real work when something relevant actually changed. Safe
// to call on every render — the guard makes a repeat call a no-op.
export async function ensureSchedulePlanned(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const hash = await currentInputsHash(supabase);
  const { data: state } = await supabase
    .from("study_plan_state")
    .select("inputs_hash")
    .maybeSingle();

  if (state?.inputs_hash === hash) return; // nothing relevant changed → skip

  const res = await runPlanner();
  if (!res.ok) return; // leave the fingerprint unchanged so we retry next load

  await supabase.from("study_plan_state").upsert(
    { user_id: user.id, inputs_hash: hash, planned_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}

export async function listStudyBlocks(): Promise<StudyBlockItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("study_blocks")
    .select(
      "id, source_kind, canvas_assignment_id, exam_id, title, starts_at, ends_at, state, reason, archetype, spacing_schedule, moved_by_user"
    )
    .order("starts_at", { ascending: true });
  return ((data ?? []) as StudyBlockRow[]).map((r) => ({
    id: r.id,
    source_kind: r.source_kind,
    canvas_assignment_id: r.canvas_assignment_id,
    exam_id: r.exam_id,
    title: r.title,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    state: r.state,
    reason: r.reason,
    archetype: (r.archetype as Archetype | null) ?? null,
    spacing_schedule: r.spacing_schedule ?? null,
    moved_by_user: r.moved_by_user,
  }));
}

// Regenerate the schedule for the current user and persist it. Returns a short
// count summary. Safe to call from a button or at the end of a Canvas sync.
export async function runPlanner(): Promise<{
  ok: boolean;
  scheduled: number;
  reserved: number;
  needsInput: number;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, scheduled: 0, reserved: 0, needsInput: 0, error: "Not signed in." };

  const now = new Date();
  const horizonEnd = addDays(startOfDay(now), SCHEDULER_CONFIG.HORIZON_CAP_DAYS);

  // --- Gather everything concurrently ---------------------------------------
  const [
    { data: assignmentRows },
    { data: assignmentOverrideRows },
    { data: examRows },
    { data: classEventRows },
    { data: userEventRows },
    { data: userEventOverrideRows },
    { data: movedBlockRows },
    googleEvents,
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "canvas_assignment_id, title, due_at, points_possible, submission_types, assignment_group_name, submitted, graded"
      ),
    supabase
      .from("assignment_overrides")
      .select("canvas_assignment_id, task_category, archetype, est_minutes, skip"),
    supabase.from("exams").select("id, title, exam_at, est_prep_minutes"),
    supabase.from("class_events").select("start_at, end_at"),
    supabase
      .from("user_events")
      .select(
        "id, title, color, is_recurring, starts_at, ends_at, weekdays, start_minute, end_minute, series_start_date"
      ),
    supabase
      .from("user_event_overrides")
      .select(
        "id, event_id, occurrence_date, status, starts_at, ends_at, title, color"
      ),
    supabase
      .from("study_blocks")
      .select(
        "source_kind, canvas_assignment_id, exam_id, starts_at, ends_at, session_index"
      )
      .eq("moved_by_user", true),
    getGoogleCalendarEvents(),
  ]);

  // --- Build the task list (assignments + exams) ----------------------------
  const overridesByCanvasId = new Map(
    ((assignmentOverrideRows ?? []) as { canvas_assignment_id: number; task_category: string | null; archetype: string | null; est_minutes: number | null; skip: boolean }[]).map(
      (o) => [Number(o.canvas_assignment_id), o]
    )
  );

  const tasks: PlannableTask[] = [];

  for (const a of (assignmentRows ?? []) as {
    canvas_assignment_id: number;
    title: string;
    due_at: string | null;
    points_possible: number | null;
    submission_types: string[] | null;
    assignment_group_name: string | null;
    submitted: boolean | null;
    graded: boolean | null;
  }[]) {
    if (!a.due_at) continue; // no due date → shown honestly elsewhere, not scheduled
    const due = new Date(a.due_at);
    if (due <= now) continue; // past due
    if (a.submitted || a.graded) continue; // already done on Canvas

    const ov = overridesByCanvasId.get(Number(a.canvas_assignment_id));
    if (ov?.skip) continue;

    // Classify into an archetype: a student's confirmed answer wins; otherwise
    // infer deterministically from Canvas signals. A null archetype is genuinely
    // ambiguous → we ask once (needs-input).
    const inferred = inferArchetype({
      title: a.title,
      submissionTypes: a.submission_types ?? [],
      assignmentGroupName: a.assignment_group_name,
      pointsPossible: a.points_possible,
    });
    const archetype = ((ov?.archetype as Archetype | null) ?? inferred.archetype) ?? null;
    const totalMinutes =
      archetype == null
        ? null
        : resolveArchetypeDuration({
            estMinutes: ov?.est_minutes ?? null,
            archetype,
            subtype: inferred.subtype,
            points: a.points_possible,
          });
    const spacingSchedule =
      archetype === "memorization" ? spacingScheduleFor(wholeDaysUntil(now, due)) : null;

    tasks.push({
      kind: "assignment",
      id: String(a.canvas_assignment_id),
      title: a.title,
      deadline: due,
      totalMinutes,
      needsInput: archetype == null || totalMinutes == null,
      archetype,
      spacingSchedule,
    });
  }

  for (const e of (examRows ?? []) as {
    id: string;
    title: string;
    exam_at: string;
    est_prep_minutes: number | null;
  }[]) {
    const at = new Date(e.exam_at);
    if (at <= now) continue;
    const totalMinutes =
      e.est_prep_minutes != null && e.est_prep_minutes > 0
        ? Math.round(e.est_prep_minutes * SCHEDULER_CONFIG.ESTIMATE_BUFFER)
        : SCHEDULER_CONFIG.EXAM_DEFAULT_PREP_MINUTES;
    tasks.push({
      kind: "exam",
      id: e.id,
      title: e.title,
      deadline: at,
      totalMinutes,
      needsInput: false,
      // Entered exams are always memorization; record their spaced schedule.
      archetype: "memorization",
      spacingSchedule: spacingScheduleFor(wholeDaysUntil(now, at)),
    });
  }

  // --- Gather busy time -----------------------------------------------------
  const busy: BusyInterval[] = [];
  const pushInterval = (s: string | null, e: string | null) => {
    if (!s || !e) return;
    const start = new Date(s);
    const end = new Date(e);
    if (end > start) busy.push({ start, end });
  };

  for (const c of (classEventRows ?? []) as { start_at: string | null; end_at: string | null }[]) {
    pushInterval(c.start_at, c.end_at);
  }
  for (const g of googleEvents) pushInterval(g.start_at, g.end_at);

  // Moved study blocks are both (a) fixed busy time we schedule around, and
  // (b) a session the student has already placed for their task, so it must
  // COUNT as one of that task's sessions on regen (otherwise a 3-session task
  // with 1 moved block would regenerate 3 more → 4 total). We build both here.
  const locked: LockedSession[] = [];
  for (const m of (movedBlockRows ?? []) as {
    source_kind: "assignment" | "exam";
    canvas_assignment_id: number | null;
    exam_id: string | null;
    starts_at: string;
    ends_at: string;
    session_index: number | null;
  }[]) {
    pushInterval(m.starts_at, m.ends_at);
    const taskId =
      m.source_kind === "assignment"
        ? m.canvas_assignment_id != null
          ? String(m.canvas_assignment_id)
          : null
        : m.exam_id;
    if (!taskId) continue; // can't tie it to a task → keep only as busy time
    const start = new Date(m.starts_at);
    const end = new Date(m.ends_at);
    if (end <= start) continue;
    locked.push({
      sourceKind: m.source_kind,
      taskId,
      sessionIndex: m.session_index ?? null,
      start,
      end,
    });
  }
  // The user's own events, expanded into concrete occurrences over the horizon
  // (honoring per-occurrence moves/cancellations).
  const occurrences = expandOccurrencesForRange(
    (userEventRows ?? []) as unknown as UserEventRow[],
    (userEventOverrideRows ?? []) as unknown as OverrideRow[],
    startOfDay(now),
    horizonEnd
  );
  for (const o of occurrences) busy.push({ start: o.start, end: o.end });

  // --- Plan ------------------------------------------------------------------
  const planned = planSchedule({ now, tasks, busy, locked });

  // --- Persist: replace auto blocks, keep the ones the student moved --------
  await supabase
    .from("study_blocks")
    .delete()
    .eq("user_id", user.id)
    .eq("moved_by_user", false);

  if (planned.length > 0) {
    const rows = planned.map((b) => ({
      user_id: user.id,
      source_kind: b.sourceKind,
      canvas_assignment_id: b.sourceKind === "assignment" ? Number(b.taskId) : null,
      exam_id: b.sourceKind === "exam" ? b.taskId : null,
      title: b.title,
      starts_at: b.start.toISOString(),
      ends_at: b.end.toISOString(),
      state: b.state,
      reason: b.reason,
      session_index: b.sessionIndex,
      session_count: b.sessionCount,
      archetype: b.archetype,
      spacing_schedule: b.spacingSchedule,
      moved_by_user: false,
      generated_at: now.toISOString(),
    }));
    const { error } = await supabase.from("study_blocks").insert(rows);
    if (error) {
      return { ok: false, scheduled: 0, reserved: 0, needsInput: 0, error: error.message };
    }
  }

  return {
    ok: true,
    scheduled: planned.filter((b) => b.state === "scheduled").length,
    reserved: planned.filter((b) => b.state === "reserved").length,
    needsInput: planned.filter((b) => b.state === "needs_input").length,
  };
}
