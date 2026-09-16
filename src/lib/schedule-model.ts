// ============================================================================
// SCHEDULE DOMAIN MODEL (Stage A of the scheduler rebuild)
//
// One clean vocabulary for the whole scheduler, so placement can be rebuilt on a
// correct foundation (Stage B) instead of patched. Three concepts:
//
//   • Commitment    — a FIXED, immovable block of real time the student must be
//                     present for (a class, a personal/Google event, a study
//                     block they dragged). It is busy time; it never generates
//                     work by itself.
//   • Task          — WORK to be completed before a deadline, schedulable (the
//                     app decides when). An assignment, or the study for an exam.
//   • ScheduledSession — the OUTPUT: a concrete block the scheduler places to
//                     make progress on a Task (this is the engine's PlannedBlock).
//
// STAGE A IS A NO-BEHAVIOR-CHANGE REFACTOR. These builders reproduce exactly the
// task list and busy set that runPlanner fed the engine before, just expressed in
// the new model and centralized here. Exams are still modeled as Tasks for now
// (their deadline = exam time); promoting the exam SITTING to a Commitment is
// Stage C. Reasonable-hours, distribution and leveling are Stage B.
//
// Pure functions only — no DB, no network, no AI — so this is unit-testable.
// ============================================================================
import {
  resolveArchetypeDuration,
  spacingScheduleFor,
  type BusyInterval,
  type LockedSession,
  type PlannableTask,
  type PlannedBlock,
} from "@/lib/scheduler";
import { type Archetype } from "@/lib/scheduler-config";
import { inferArchetype } from "@/lib/task-inference";
import { startOfDay } from "@/lib/calendar";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- The three domain concepts ----------------------------------------------

export type CommitmentSource =
  | "class" // Canvas class meeting / office hours
  | "google" // read-only Google Calendar event
  | "user_event" // the student's own event
  | "moved_study"; // a study block the student dragged (fixed for this run)

export type Commitment = {
  source: CommitmentSource;
  title: string | null;
  start: Date;
  end: Date;
};

export type TaskSource = "assignment" | "exam";

export type Task = {
  source: TaskSource;
  id: string; // canvas_assignment_id (as string) or exam id
  title: string;
  deadline: Date;
  totalMinutes: number | null; // resolved effort, or null → needs input
  needsInput: boolean;
  archetype: Archetype | null;
  spacingSchedule: string | null;
  // Data-collection substrate (recorded, not yet learned from): how the effort
  // estimate was arrived at, for later transparency and the learning loop.
  estimateBasis: string | null;
};

// The scheduler's output is a placed session — the engine already models this as
// PlannedBlock, so we alias rather than duplicate the shape.
export type ScheduledSession = PlannedBlock;

// --- Raw row shapes (what the server layer reads from the DB) ----------------

export type RawAssignment = {
  canvas_assignment_id: number;
  title: string;
  due_at: string | null;
  points_possible: number | null;
  submission_types: string[] | null;
  assignment_group_name: string | null;
  submitted: boolean | null;
  graded: boolean | null;
};

export type RawOverride = {
  canvas_assignment_id: number;
  task_category: string | null;
  archetype: string | null;
  est_minutes: number | null;
  skip: boolean;
};

export type RawExam = {
  id: string;
  title: string;
  exam_at: string;
  est_prep_minutes: number | null;
};

export type RawMovedBlock = {
  source_kind: "assignment" | "exam";
  canvas_assignment_id: number | null;
  exam_id: string | null;
  starts_at: string;
  ends_at: string;
  session_index: number | null;
};

// Whole days from the start of today to the start of a target date (used to pick
// a memorization task's spaced-review schedule).
export function wholeDaysUntil(now: Date, date: Date): number {
  return Math.max(
    0,
    Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY)
  );
}

// --- Task builders -----------------------------------------------------------

// Build the schedulable Tasks from Canvas assignments. Mirrors the previous
// runPlanner logic exactly: skip no-due-date / past-due / submitted / graded /
// opted-out; a saved archetype answer wins over inference; unknown → needs input.
export function buildAssignmentTasks(
  assignments: RawAssignment[],
  overridesByCanvasId: Map<number, RawOverride>,
  now: Date
): Task[] {
  const tasks: Task[] = [];
  for (const a of assignments) {
    if (!a.due_at) continue; // no due date → surfaced elsewhere, not scheduled
    const due = new Date(a.due_at);
    if (due <= now) continue; // past due
    if (a.submitted || a.graded) continue; // already done on Canvas

    const ov = overridesByCanvasId.get(Number(a.canvas_assignment_id));
    if (ov?.skip) continue;

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

    tasks.push({
      source: "assignment",
      id: String(a.canvas_assignment_id),
      title: a.title,
      deadline: due,
      totalMinutes,
      needsInput: archetype == null || totalMinutes == null,
      archetype,
      spacingSchedule:
        archetype === "memorization" ? spacingScheduleFor(wholeDaysUntil(now, due)) : null,
      estimateBasis:
        archetype == null
          ? null
          : ov?.est_minutes != null && ov.est_minutes > 0
            ? "student_estimate"
            : `archetype_default:${archetype}${inferred.subtype ? `:${inferred.subtype}` : ""}`,
    });
  }
  return tasks;
}

// Build the exam study Tasks. Unchanged from before: an exam is (for now) a
// deadline-driven memorization Task whose deadline is the exam time.
export function buildExamTasks(exams: RawExam[], now: Date): Task[] {
  const BUFFER = 1.4; // matches SCHEDULER_CONFIG.ESTIMATE_BUFFER for entered exams
  const DEFAULT_PREP = 180; // matches SCHEDULER_CONFIG.EXAM_DEFAULT_PREP_MINUTES
  const tasks: Task[] = [];
  for (const e of exams) {
    const at = new Date(e.exam_at);
    if (at <= now) continue;
    const hasEstimate = e.est_prep_minutes != null && e.est_prep_minutes > 0;
    tasks.push({
      source: "exam",
      id: e.id,
      title: e.title,
      deadline: at,
      totalMinutes: hasEstimate ? Math.round((e.est_prep_minutes as number) * BUFFER) : DEFAULT_PREP,
      needsInput: false,
      archetype: "memorization",
      spacingSchedule: spacingScheduleFor(wholeDaysUntil(now, at)),
      estimateBasis: hasEstimate ? "student_estimate" : "exam_default",
    });
  }
  return tasks;
}

// --- Commitment builders -----------------------------------------------------

const toDate = (s: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Gather every fixed commitment (busy time) from its varied sources into one
// uniform list. Order does not matter — the engine sorts free intervals — but we
// keep it stable (class, google, moved, own events) for readable output.
export function buildCommitments(input: {
  classEvents: { start_at: string | null; end_at: string | null; title?: string | null }[];
  googleEvents: { start_at: string | null; end_at: string | null; title?: string | null }[];
  movedBlocks: RawMovedBlock[];
  userOccurrences: { start: Date; end: Date; title?: string | null }[];
}): Commitment[] {
  const out: Commitment[] = [];
  const pushRaw = (source: CommitmentSource, s: string | null, e: string | null, title: string | null) => {
    const start = toDate(s);
    const end = toDate(e);
    if (start && end && end > start) out.push({ source, title, start, end });
  };

  for (const c of input.classEvents) pushRaw("class", c.start_at, c.end_at, c.title ?? null);
  for (const g of input.googleEvents) pushRaw("google", g.start_at, g.end_at, g.title ?? null);
  for (const m of input.movedBlocks) pushRaw("moved_study", m.starts_at, m.ends_at, null);
  for (const o of input.userOccurrences) {
    if (o.end > o.start) out.push({ source: "user_event", title: o.title ?? null, start: o.start, end: o.end });
  }
  return out;
}

// --- Projections into the current engine's input shape -----------------------
// (Stage A: the engine is unchanged, so we translate the domain model back into
// exactly what planSchedule already consumes. Stage B replaces the engine.)

export function commitmentsToBusy(commitments: Commitment[]): BusyInterval[] {
  return commitments.map((c) => ({ start: c.start, end: c.end }));
}

export function taskToPlannable(task: Task): PlannableTask {
  return {
    kind: task.source,
    id: task.id,
    title: task.title,
    deadline: task.deadline,
    totalMinutes: task.totalMinutes,
    needsInput: task.needsInput,
    archetype: task.archetype,
    spacingSchedule: task.spacingSchedule,
  };
}

// A study block the student dragged is a Commitment (busy, above) AND it counts
// as one of its Task's sessions on regen, so build the engine's LockedSession
// view from the same moved rows.
export function movedBlocksToLocked(movedBlocks: RawMovedBlock[]): LockedSession[] {
  const locked: LockedSession[] = [];
  for (const m of movedBlocks) {
    const taskId =
      m.source_kind === "assignment"
        ? m.canvas_assignment_id != null
          ? String(m.canvas_assignment_id)
          : null
        : m.exam_id;
    if (!taskId) continue; // can't tie it to a task → stays busy-only
    const start = toDate(m.starts_at);
    const end = toDate(m.ends_at);
    if (!start || !end || end <= start) continue;
    locked.push({ sourceKind: m.source_kind, taskId, sessionIndex: m.session_index ?? null, start, end });
  }
  return locked;
}
