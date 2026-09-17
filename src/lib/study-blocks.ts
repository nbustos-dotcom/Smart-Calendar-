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
import { planSchedule } from "@/lib/scheduler";
import { SCHEDULER_CONFIG, type Archetype } from "@/lib/scheduler-config";
import {
  buildAssignmentTasks,
  buildCommitments,
  buildExamTasks,
  commitmentsToBusy,
  movedBlocksToLocked,
  taskToPlannable,
  type RawAssignment,
  type RawExam,
  type RawMovedBlock,
  type RawOverride,
  type Task,
} from "@/lib/schedule-model";
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

  // CONCURRENCY FIX. The old flow read the stored hash, compared, then ran and
  // wrote the hash afterward — a check-then-act (TOCTOU) race. On a fresh load
  // two concurrent renders (e.g. a prefetch + the navigation) both saw the old
  // hash and both ran runPlanner, each doing its own non-atomic delete+insert,
  // so the plan was inserted twice (the duplicate-blocks bug).
  //
  // `claim_study_plan_run` records the new hash and returns TRUE only to the
  // caller that actually advanced it (an atomic upsert with an is-distinct-from
  // guard). We claim BEFORE running, so only one concurrent invocation ever
  // regenerates for a given input set; the others skip. If planning then fails,
  // we release the claim so the next load retries.
  const claim = await supabase.rpc("claim_study_plan_run", { p_hash: hash });
  if (!claim.error) {
    if (!claim.data) return; // someone else is regenerating this input set, or nothing changed
    const res = await runPlanner();
    if (!res.ok) {
      // Release the claim (blank the hash) so a later load retries.
      await supabase
        .from("study_plan_state")
        .update({ inputs_hash: "", updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
    }
    return;
  }

  // Fallback for before migration 0011 is applied (RPC not present yet): the
  // previous compare-then-run behavior, so the app keeps working meanwhile.
  const { data: state } = await supabase
    .from("study_plan_state")
    .select("inputs_hash")
    .maybeSingle();
  if (state?.inputs_hash === hash) return;
  const res = await runPlanner();
  if (!res.ok) return;
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
    { data: prefRow },
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
    // Stage B: the student's reasonable-hours model (null row → engine defaults).
    supabase
      .from("student_preferences")
      .select(
        "weekday_start_minute, weekday_end_minute, weekend_start_minute, weekend_end_minute, max_weekday_minutes, max_weekend_minutes, quality_bands"
      )
      .maybeSingle(),
  ]);

  // --- Build the domain model (Tasks + Commitments), then project it into the
  // engine's inputs. Same task list and busy set as before — the model layer is
  // now the single place this is assembled (see src/lib/schedule-model.ts).
  const overridesByCanvasId = new Map(
    ((assignmentOverrideRows ?? []) as RawOverride[]).map((o) => [Number(o.canvas_assignment_id), o])
  );

  const tasks: Task[] = [
    ...buildAssignmentTasks((assignmentRows ?? []) as RawAssignment[], overridesByCanvasId, now),
    ...buildExamTasks((examRows ?? []) as RawExam[], now),
  ];

  // Fixed commitments (busy time): classes, Google, moved study blocks, and the
  // student's own recurring events expanded into concrete occurrences.
  const occurrences = expandOccurrencesForRange(
    (userEventRows ?? []) as unknown as UserEventRow[],
    (userEventOverrideRows ?? []) as unknown as OverrideRow[],
    startOfDay(now),
    horizonEnd
  );
  const movedBlocks = (movedBlockRows ?? []) as RawMovedBlock[];
  const commitments = buildCommitments({
    classEvents: (classEventRows ?? []) as { start_at: string | null; end_at: string | null }[],
    googleEvents: googleEvents as { start_at: string | null; end_at: string | null }[],
    movedBlocks,
    userOccurrences: occurrences.map((o) => ({ start: o.start, end: o.end })),
  });

  // A moved study block is also a locked session (counts as one of its task's
  // sessions) so regen doesn't duplicate it.
  const locked = movedBlocksToLocked(movedBlocks);

  // Reasonable-hours model: the student's saved preferences if any, else the
  // engine's defaults. (No row → undefined → defaults.)
  const pr = prefRow as Record<string, unknown> | null;
  const preferences = pr
    ? {
        weekdayStartMinute: pr.weekday_start_minute as number,
        weekdayEndMinute: pr.weekday_end_minute as number,
        weekendStartMinute: pr.weekend_start_minute as number,
        weekendEndMinute: pr.weekend_end_minute as number,
        maxWeekdayMinutes: pr.max_weekday_minutes as number,
        maxWeekendMinutes: pr.max_weekend_minutes as number,
        qualityBands: Array.isArray(pr.quality_bands)
          ? (pr.quality_bands as { startMin: number; endMin: number; weight: number }[])
          : undefined,
      }
    : undefined;

  // --- Plan ------------------------------------------------------------------
  const planned = planSchedule({
    now,
    tasks: tasks.map(taskToPlannable),
    busy: commitmentsToBusy(commitments),
    locked,
    preferences,
  });

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
      // NOTE: estimate_minutes / estimate_basis columns are added by migration
      // 0011 as the data-collection substrate, but are POPULATED starting in
      // Stage D — Stage A writes the same columns as before (no new dependency).
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
