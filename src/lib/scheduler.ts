// ============================================================================
// SCHEDULER — the deterministic study-block placement engine
//
// Pure functions: (tasks + real busy time + config) → planned study blocks. No
// DB, no network, no randomness, NO AI. The same inputs always produce the same
// plan, which makes the whole thing unit-testable (see tests/scheduler.test.ts).
//
// What it does, in plain steps:
//   1. Build FREE intervals inside the daily window (08:00–22:00), from now to a
//      bounded horizon, by subtracting all busy time (classes, the user's own
//      events, Google events, and study blocks the student has manually moved).
//   2. Order tasks by urgency (earliest deadline first).
//   3. For each task, resolve how many focus sessions it needs and place them:
//        - assignments: spread across [now, due] EARLIEST-first, guaranteed to
//          finish before the deadline (backward-bounded, earlier-biased).
//        - exams: spaced across [now, exam] using the spacing effect
//          (gap ≈ SPACING_FRACTION × days-until-test), earliest-first.
//      Each placed slot is removed from free time so nothing double-books.
//   4. Assign a three-state honesty label: scheduled / reserved / needs_input.
//
// Duration estimation (the ladder) and category inference happen UPSTREAM (the
// server layer), so this engine just receives a resolved total per task.
// ============================================================================
import { addDays, startOfDay } from "@/lib/calendar";
import { SCHEDULER_CONFIG } from "@/lib/scheduler-config";

export type BusyInterval = { start: Date; end: Date };

export type PlannableTask = {
  kind: "assignment" | "exam";
  id: string; // canvas_assignment_id (as string) or exam id
  title: string;
  deadline: Date; // due_at (assignment) or exam_at (exam)
  // Total work minutes AFTER the duration ladder + buffer resolved it. null when
  // we couldn't resolve it (unknown category) → needsInput.
  totalMinutes: number | null;
  needsInput: boolean; // true → we must ask the student one question
};

// A study block the student manually moved on a previous run. We keep these
// fixed (their time is already in `busy`), and — crucially — they COUNT as one
// of their task's sessions so a re-plan doesn't re-create work the student has
// already placed. Matched to a task by (sourceKind, taskId); sessionIndex tells
// us which session slot it fills so the remaining sessions get the right labels.
export type LockedSession = {
  sourceKind: "assignment" | "exam";
  taskId: string;
  sessionIndex: number | null;
  start: Date;
  end: Date;
};

export type BlockState = "scheduled" | "reserved" | "needs_input";

export type PlannedBlock = {
  sourceKind: "assignment" | "exam";
  taskId: string;
  title: string;
  start: Date;
  end: Date;
  state: BlockState;
  reason: string; // plain-language "why", always traceable
  sessionIndex: number; // 1-based
  sessionCount: number;
};

type Config = typeof SCHEDULER_CONFIG;

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

// --- Duration fallback ladder ------------------------------------------------
// Student's own estimate (×1.4 buffer) → category default (used as-is, already
// padded) → null (unknown → the caller marks the task needs-input). The
// "category history average" rung is deferred (no data until the learning loop),
// so in v1 it's simply skipped. Pure so it's unit-testable.
export function resolveDurationMinutes(
  estMinutes: number | null,
  category: string | null,
  cfg: Config = SCHEDULER_CONFIG
): number | null {
  if (estMinutes != null && estMinutes > 0) {
    return Math.round(estMinutes * cfg.ESTIMATE_BUFFER);
  }
  if (category && cfg.CATEGORY_DEFAULT_MINUTES[category] != null) {
    return cfg.CATEGORY_DEFAULT_MINUTES[category];
  }
  return null;
}

// --- Start-offset ("don't start too early") ----------------------------------
// How many days before the due date an assignment's work may begin, from the
// LEAD_DAYS ladder: bigger tasks earn a longer lead. Pure so it's unit-testable.
export function leadDaysFor(totalMinutes: number, cfg: Config = SCHEDULER_CONFIG): number {
  for (const tier of cfg.LEAD_DAYS) {
    if (totalMinutes <= tier.maxMinutes) return tier.leadDays;
  }
  // Defensive: LEAD_DAYS always ends in an Infinity tier, so this is unreachable.
  return cfg.LEAD_DAYS[cfg.LEAD_DAYS.length - 1]?.leadDays ?? cfg.HORIZON_DAYS;
}

// --- Free-time construction --------------------------------------------------

// The daily working window [start, end) for a given day.
function windowFor(day: Date, cfg: Config): BusyInterval {
  const start = new Date(day);
  start.setHours(cfg.DAY_WINDOW_START_HOUR, 0, 0, 0);
  const end = new Date(day);
  end.setHours(cfg.DAY_WINDOW_END_HOUR, 0, 0, 0);
  return { start, end };
}

// Free intervals inside every day's window from `now` to `horizonEnd`, with all
// busy time subtracted. Never includes the past. Sorted by start.
function buildFreeIntervals(
  now: Date,
  horizonEnd: Date,
  busy: BusyInterval[],
  cfg: Config
): BusyInterval[] {
  const free: BusyInterval[] = [];
  let day = startOfDay(now);
  while (day <= horizonEnd) {
    const win = windowFor(day, cfg);
    // Clamp to [now, horizonEnd] so we never plan in the past or past the cap.
    const winStart = new Date(Math.max(win.start.getTime(), now.getTime()));
    const winEnd = new Date(Math.min(win.end.getTime(), horizonEnd.getTime()));
    if (winStart < winEnd) {
      // Subtract busy intervals that overlap this window.
      const cuts = busy
        .filter((b) => b.end > winStart && b.start < winEnd)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      let cursor = winStart;
      for (const b of cuts) {
        if (b.start > cursor) {
          free.push({ start: cursor, end: new Date(Math.min(b.start.getTime(), winEnd.getTime())) });
        }
        if (b.end > cursor) cursor = new Date(Math.max(cursor.getTime(), b.end.getTime()));
        if (cursor >= winEnd) break;
      }
      if (cursor < winEnd) free.push({ start: cursor, end: winEnd });
    }
    day = addDays(day, 1);
  }
  return free.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Take the earliest free sub-slot of `minutes` length within [after, before].
// Mutates `free` (removes the carved time). Returns the placed slot or null.
function takeEarliestSlot(
  free: BusyInterval[],
  after: Date,
  before: Date,
  minutes: number
): BusyInterval | null {
  const need = minutes * MS_PER_MIN;
  for (let i = 0; i < free.length; i++) {
    const iv = free[i];
    const s = Math.max(iv.start.getTime(), after.getTime());
    const e = Math.min(iv.end.getTime(), before.getTime());
    if (e - s >= need) {
      const placed = { start: new Date(s), end: new Date(s + need) };
      // Replace this interval with whatever is left on either side of the carve.
      const leftovers: BusyInterval[] = [];
      if (s > iv.start.getTime()) leftovers.push({ start: iv.start, end: new Date(s) });
      if (iv.end.getTime() > s + need) leftovers.push({ start: new Date(s + need), end: iv.end });
      free.splice(i, 1, ...leftovers);
      return placed;
    }
  }
  return null;
}

// --- Session sizing ----------------------------------------------------------

// Split a total into nearly-equal focus sessions, each no longer than the cap.
function splitSessions(total: number, cfg: Config): number[] {
  if (total <= 0) return [];
  if (total <= cfg.CHUNK_CAP_MINUTES) return [total];
  const count = Math.ceil(total / cfg.CHUNK_CAP_MINUTES);
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  // Hand the remainder minutes to the earliest sessions, one each.
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Whole days from the start of `now`'s day to the deadline's day.
function daysUntil(now: Date, deadline: Date): number {
  return Math.max(
    0,
    Math.round((startOfDay(deadline).getTime() - startOfDay(now).getTime()) / MS_PER_DAY)
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Bounds of one day-offset's window, intersected with [now, deadline].
function dayBounds(now: Date, deadline: Date, offset: number): { after: Date; before: Date } {
  const day = addDays(startOfDay(now), offset);
  const after = new Date(Math.max(day.getTime(), now.getTime()));
  const before = new Date(Math.min(addDays(day, 1).getTime(), deadline.getTime()));
  return { after, before };
}

// Key a day for the shared daily-load map (the workload cap): the local
// midnight timestamp of whatever day a slot falls on.
function dayKeyOf(d: Date): number {
  return startOfDay(d).getTime();
}

// Minutes a slot occupies.
function slotMinutes(slot: BusyInterval): number {
  return (slot.end.getTime() - slot.start.getTime()) / MS_PER_MIN;
}

// --- The main entry point ----------------------------------------------------

export function planSchedule(input: {
  now: Date;
  tasks: PlannableTask[];
  busy: BusyInterval[];
  // Study blocks the student has already moved by hand. Their time is expected
  // to be part of `busy`; here they also reduce how many NEW sessions each task
  // needs, so a moved block counts as one session instead of duplicating it.
  locked?: LockedSession[];
  config?: Config;
}): PlannedBlock[] {
  const cfg = input.config ?? SCHEDULER_CONFIG;
  const { now } = input;

  // Group the moved (locked) sessions by their task so each task can subtract
  // the sessions it already has placed.
  const lockedByTask = new Map<string, LockedSession[]>();
  for (const l of input.locked ?? []) {
    const key = `${l.sourceKind}:${l.taskId}`;
    const list = lockedByTask.get(key);
    if (list) list.push(l);
    else lockedByTask.set(key, [l]);
  }

  // Shared per-day workload tally (minutes), so the daily cap holds ACROSS tasks
  // and already-placed exam prep — not just within one task. Seed it with the
  // moved blocks the student has locked in, so they count toward each day's cap.
  const dayLoad = new Map<number, number>();
  for (const l of input.locked ?? []) {
    const key = dayKeyOf(l.start);
    dayLoad.set(key, (dayLoad.get(key) ?? 0) + slotMinutes(l));
  }

  // Horizon: HORIZON_DAYS out, stretched to the furthest deadline, capped.
  const cap = addDays(startOfDay(now), cfg.HORIZON_CAP_DAYS);
  const base = addDays(startOfDay(now), cfg.HORIZON_DAYS);
  const furthest = input.tasks.reduce(
    (m, t) => (t.deadline > m ? t.deadline : m),
    base
  );
  const horizonEnd = new Date(Math.min(furthest.getTime(), cap.getTime()));

  const free = buildFreeIntervals(now, horizonEnd, input.busy, cfg);

  // Urgency order: earliest deadline first, then larger effort, then id — a total
  // order so the plan is deterministic and urgent work gets first pick of slots.
  const tasks = [...input.tasks].sort(
    (a, b) =>
      a.deadline.getTime() - b.deadline.getTime() ||
      (b.totalMinutes ?? 0) - (a.totalMinutes ?? 0) ||
      a.id.localeCompare(b.id)
  );

  const out: PlannedBlock[] = [];
  for (const task of tasks) {
    if (task.deadline <= now) continue; // nothing to do for a past deadline

    const lockedForTask = lockedByTask.get(`${task.kind}:${task.id}`) ?? [];

    if (task.needsInput || task.totalMinutes == null) {
      // If the student already moved a block for this task, keep that (it's in
      // `busy`/`locked`) and don't re-create the placeholder. Otherwise hold one
      // small, clickable placeholder and ask what kind of task it is.
      if (lockedForTask.length > 0) continue;
      const slot =
        takeEarliestSlot(free, now, task.deadline, cfg.PLACEHOLDER_MINUTES) ??
        takeEarliestSlot(free, now, horizonEnd, cfg.PLACEHOLDER_MINUTES);
      if (slot) {
        out.push({
          sourceKind: task.kind,
          taskId: task.id,
          title: task.title,
          start: slot.start,
          end: slot.end,
          state: "needs_input",
          reason: "Tell me what kind of task this is and I'll schedule real time for it.",
          sessionIndex: 1,
          sessionCount: 1,
        });
      }
      continue;
    }

    // Full session plan for the task. `count` is the label denominator ("of N")
    // and stays fixed even when some sessions are already locked in by a move.
    const sessions = splitSessions(task.totalMinutes, cfg);
    const count = sessions.length;

    // Reconcile moved blocks: a locked session fills one of the N slots, so we
    // only place the REMAINING slots. Match by session index where we have it,
    // then fall back to the earliest still-open indices. This is what stops a
    // move from turning an N-session task into N+1 blocks on the next re-plan.
    const takenIndices = new Set(
      lockedForTask
        .map((l) => l.sessionIndex)
        .filter((n): n is number => n != null && n >= 1 && n <= count)
    );
    let openSlots = sessions
      .map((minutes, i) => ({ index: i + 1, minutes }))
      .filter((s) => !takenIndices.has(s.index));
    // Locked blocks without a usable index still consume a slot each: drop that
    // many from the front so the remaining count is exactly count − lockedCount.
    const untracked = lockedForTask.length - takenIndices.size;
    if (untracked > 0) openSlots = openSlots.slice(untracked);

    const toPlaceMinutes = openSlots.map((s) => s.minutes);
    // `placeAssignment` enforces (and updates) the shared daily cap itself. The
    // exam path is left untouched, so we record ITS placed minutes here so later
    // assignments still see exam-prep days filling up.
    const placed: BusyInterval[] =
      task.kind === "exam"
        ? placeExam(free, now, task, toPlaceMinutes, cfg)
        : placeAssignment(free, now, task, toPlaceMinutes, dayLoad, cfg);
    if (task.kind === "exam") {
      for (const slot of placed) {
        const key = dayKeyOf(slot.start);
        dayLoad.set(key, (dayLoad.get(key) ?? 0) + slotMinutes(slot));
      }
    }

    placed.forEach((slot, i) => {
      out.push({
        sourceKind: task.kind,
        taskId: task.id,
        title: task.title,
        start: slot.start,
        end: slot.end,
        state: "scheduled",
        reason: reasonFor(task, openSlots[i].index, count, slot.start),
        sessionIndex: openSlots[i].index,
        sessionCount: count,
      });
    });

    // Honest shortfall: if not everything fit (no free time, or the daily cap
    // was reached) before the deadline, hold ONE reserved placeholder so the gap
    // is visible rather than silently dropped or crammed past the cap.
    if (placed.length < openSlots.length) {
      const missing = openSlots
        .slice(placed.length)
        .reduce((a, b) => a + b.minutes, 0);
      const firstUnplacedIndex = openSlots[placed.length].index;
      const slot =
        takeEarliestSlot(free, now, task.deadline, cfg.MIN_CHUNK_MINUTES) ??
        takeEarliestSlot(free, now, horizonEnd, cfg.MIN_CHUNK_MINUTES);
      if (slot) {
        out.push({
          sourceKind: task.kind,
          taskId: task.id,
          title: task.title,
          start: slot.start,
          end: slot.end,
          state: "reserved",
          reason: `Not enough free time before the deadline for ~${missing} more min — held as a reminder.`,
          sessionIndex: firstUnplacedIndex,
          sessionCount: count,
        });
      }
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Assignments: place sessions ONLY inside the lead window [due − leadDays, due]
// (so far-future work doesn't flood the present), spread EARLIEST-first across
// that window, one per day per pass. A day is skipped once it would exceed the
// shared daily cap; sessions that never fit come back as a shortfall (→ the
// caller reserves them) rather than being crammed past the cap.
function placeAssignment(
  free: BusyInterval[],
  now: Date,
  task: PlannableTask,
  sessions: number[],
  dayLoad: Map<number, number>,
  cfg: Config
): BusyInterval[] {
  const placed: BusyInterval[] = [];
  if (sessions.length === 0) return placed;

  const lastDay = daysUntil(now, task.deadline);
  const total = sessions.reduce((a, b) => a + b, 0);
  const lead = leadDaysFor(total, cfg);
  // Earliest offset we're allowed to start: leadDays before the due day, clamped
  // to today. This is the START-OFFSET that keeps the calendar honest.
  const firstDay = Math.max(0, lastDay - lead);

  const queue = [...sessions];
  let progress = true;
  while (queue.length > 0 && progress) {
    progress = false;
    for (let offset = firstDay; offset <= lastDay && queue.length > 0; offset++) {
      const { after, before } = dayBounds(now, task.deadline, offset);
      if (after >= before) continue;

      // Daily cap: don't schedule this session if it would push the day's total
      // study minutes over the cap. The day just gets skipped; the session waits
      // for another day in the window (or becomes a reserved shortfall).
      const dayKey = dayKeyOf(addDays(startOfDay(now), offset));
      const used = dayLoad.get(dayKey) ?? 0;
      if (used + queue[0] > cfg.MAX_STUDY_MINUTES_PER_DAY) continue;

      const slot = takeEarliestSlot(free, after, before, queue[0]);
      if (slot) {
        placed.push(slot);
        dayLoad.set(dayKey, used + queue[0]);
        queue.shift();
        progress = true;
      }
    }
  }
  return placed;
}

// Exams: spacing effect — one session every `gap` days from today, earliest slot
// each target day, all before the exam. Prefer starting earlier over later.
function placeExam(
  free: BusyInterval[],
  now: Date,
  task: PlannableTask,
  sessions: number[],
  cfg: Config
): BusyInterval[] {
  const total = daysUntil(now, task.deadline);
  const gap = clamp(Math.round(cfg.SPACING_FRACTION * total), 1, Math.max(1, total));

  // Target days: 0, gap, 2*gap, … strictly before the exam day.
  const offsets: number[] = [];
  for (let o = 0; o < Math.max(total, 1); o += gap) offsets.push(o);
  if (offsets.length === 0) offsets.push(0);

  // One session per target day; size each so the total is covered (capped).
  const perDay = clamp(
    Math.ceil(sessions.reduce((a, b) => a + b, 0) / offsets.length),
    cfg.MIN_CHUNK_MINUTES,
    cfg.CHUNK_CAP_MINUTES
  );

  const placed: BusyInterval[] = [];
  for (const offset of offsets) {
    const { after, before } = dayBounds(now, task.deadline, offset);
    if (after >= before) continue;
    const slot = takeEarliestSlot(free, after, before, perDay);
    if (slot) placed.push(slot);
  }
  return placed;
}

function reasonFor(
  task: PlannableTask,
  index: number,
  count: number,
  start: Date
): string {
  const when = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (task.kind === "exam") {
    return `Study session ${index} of ${count} for your test — spaced out to help it stick (${when}).`;
  }
  return `Work session ${index} of ${count}, placed early so it's done before the due date (${when}).`;
}
