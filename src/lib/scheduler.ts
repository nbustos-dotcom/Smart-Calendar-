// ============================================================================
// SCHEDULER — the deterministic study-block placement engine (Stage B)
//
// Pure functions: (tasks + real busy time + preferences + config) → planned
// study blocks. No DB, no network, no randomness, NO AI. Same inputs always
// produce the same plan (unit-tested in tests/scheduler.test.ts).
//
// ONE unified placement pass. Sessions from ALL tasks are placed against a
// SHARED day-load ledger, so placement is workload-aware (not per-task in
// isolation). For each session it SCORES every candidate day and takes the
// best-scoring available slot:
//
//   score(day) = SPREAD·(−|day − idealDay|)      ← order empty days by nearness
//                                                   to the deadline (ideal) day
//              + LEVEL·(remainingCapacity/cap)   ← CROSS-TASK spreading pressure:
//                                                   days already filled by earlier
//                                                   tasks repel later ones
//              + QUALITY·(best time-of-day there) ← reasonable hours
//
// LEVEL out-pulls SPREAD once a day is partly full, so a CLUSTER of same-deadline
// work fans across days — and reaches back onto earlier days when the days right
// before the deadline fill (anti-cramming). Within the chosen day it takes the
// best-QUALITY free sub-slot; the quality curve is broad, so times vary across
// the day. Availability comes from weekday/weekend windows (never overnight);
// work that can't fit under daily capacity before a deadline becomes a `reserved`
// block (honest), never crammed and never dropped. Moved blocks stay fixed (in
// `busy` and counted as their task's sessions), so regen is non-destructive.
// ============================================================================
import { addDays, startOfDay } from "@/lib/calendar";
import { SCHEDULER_CONFIG, type Archetype } from "@/lib/scheduler-config";

export type BusyInterval = { start: Date; end: Date };

export type PlannableTask = {
  kind: "assignment" | "exam";
  id: string; // canvas_assignment_id (as string) or exam id
  title: string;
  deadline: Date; // due_at (assignment) or exam_at (exam)
  // Total work minutes AFTER the duration ladder + buffer resolved it. null when
  // we couldn't resolve it (unknown archetype) → needsInput.
  totalMinutes: number | null;
  needsInput: boolean; // true → we must ask the student one question
  // Which scheduling archetype this task is, and (memorization only) the
  // spaced-repetition schedule id we recorded. null archetype ⇒ needsInput. When
  // omitted, the engine falls back to kind (exam → memorization, else production).
  archetype?: Archetype | null;
  spacingSchedule?: string | null;
};

// A study block the student manually moved on a previous run. Its time is in
// `busy` (so nothing double-books it); it also COUNTS as one of its task's
// sessions so a re-plan doesn't re-create work the student already placed.
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
  archetype: Archetype | null;
  spacingSchedule: string | null;
};

// The student's reasonable-hours model. Read from `student_preferences` when a
// row exists, else the config defaults (see resolvePreferences).
export type PlacementPreferences = {
  weekdayStartMinute: number;
  weekdayEndMinute: number;
  weekendStartMinute: number;
  weekendEndMinute: number;
  maxWeekdayMinutes: number;
  maxWeekendMinutes: number;
  qualityBands: { startMin: number; endMin: number; weight: number }[];
};

type Config = typeof SCHEDULER_CONFIG;

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;
const EPS = 1e-9;

// The archetype to schedule by: an explicit one wins; otherwise fall back to kind.
function effectiveArchetype(task: PlannableTask): Archetype | null {
  if (task.archetype !== undefined) return task.archetype;
  if (task.needsInput || task.totalMinutes == null) return null;
  return task.kind === "exam" ? "memorization" : "production";
}

// --- Duration ladder + estimation (unchanged; pure, exported for reuse/tests) --

export function resolveDurationMinutes(
  estMinutes: number | null,
  category: string | null,
  cfg: Config = SCHEDULER_CONFIG
): number | null {
  if (estMinutes != null && estMinutes > 0) return Math.round(estMinutes * cfg.ESTIMATE_BUFFER);
  if (category && cfg.CATEGORY_DEFAULT_MINUTES[category] != null) return cfg.CATEGORY_DEFAULT_MINUTES[category];
  return null;
}

function pointsMultiplier(points: number | null, cfg: Config): number {
  if (points == null) return 1;
  for (const tier of cfg.POINTS_SIZE_MULTIPLIER) if (points <= tier.maxPoints) return tier.multiplier;
  return 1;
}

export function resolveArchetypeDuration(input: {
  estMinutes: number | null;
  archetype: Archetype;
  subtype: string | null;
  points: number | null;
  cfg?: Config;
}): number {
  const cfg = input.cfg ?? SCHEDULER_CONFIG;
  const { estMinutes, archetype, subtype, points } = input;
  if (estMinutes != null && estMinutes > 0) {
    const buffer = cfg.ESTIMATE_BUFFER_BY_ARCHETYPE[archetype] ?? cfg.ESTIMATE_BUFFER;
    return Math.round(estMinutes * buffer);
  }
  if (archetype === "completion") return cfg.COMPLETION_DEFAULT_MINUTES;
  if (archetype === "production") {
    const base = cfg.PRODUCTION_BASE_MINUTES[subtype ?? "default"] ?? cfg.PRODUCTION_BASE_MINUTES.default;
    return Math.round(clamp(base * pointsMultiplier(points, cfg), cfg.PRODUCTION_MIN_MINUTES, cfg.PRODUCTION_MAX_MINUTES));
  }
  const base = cfg.MEMORIZATION_BASE_MINUTES[subtype ?? "default"] ?? cfg.MEMORIZATION_BASE_MINUTES.default;
  return Math.round(base * pointsMultiplier(points, cfg));
}

export function spacingScheduleFor(daysUntilDate: number, cfg: Config = SCHEDULER_CONFIG): string {
  return daysUntilDate <= cfg.SPACING_SCHEDULE_LONG_THRESHOLD_DAYS ? "2-3-5-7" : "1-3-7-21";
}

// How many days before the deadline a task's work may begin (bounds the smoothing
// window so far-future work doesn't surface now). Bigger tasks earn a longer lead.
export function leadDaysFor(totalMinutes: number, cfg: Config = SCHEDULER_CONFIG): number {
  for (const tier of cfg.LEAD_DAYS) if (totalMinutes <= tier.maxMinutes) return tier.leadDays;
  return cfg.LEAD_DAYS[cfg.LEAD_DAYS.length - 1]?.leadDays ?? cfg.HORIZON_DAYS;
}

// Split a total into nearly-equal focus sessions, each no longer than the cap.
function splitSessions(total: number, cfg: Config): number[] {
  if (total <= 0) return [];
  if (total <= cfg.CHUNK_CAP_MINUTES) return [total];
  const count = Math.ceil(total / cfg.CHUNK_CAP_MINUTES);
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

function daysUntil(now: Date, deadline: Date): number {
  return Math.max(0, Math.round((startOfDay(deadline).getTime() - startOfDay(now).getTime()) / MS_PER_DAY));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dayKeyOf(d: Date): number {
  return startOfDay(d).getTime();
}

function slotMinutes(slot: BusyInterval): number {
  return (slot.end.getTime() - slot.start.getTime()) / MS_PER_MIN;
}

// --- Availability & quality (the "reasonable hours" model) -------------------

export function resolvePreferences(
  p: Partial<PlacementPreferences> | undefined,
  cfg: Config = SCHEDULER_CONFIG
): PlacementPreferences {
  const d = cfg.AVAILABILITY_DEFAULTS;
  return {
    weekdayStartMinute: p?.weekdayStartMinute ?? d.weekdayStartMinute,
    weekdayEndMinute: p?.weekdayEndMinute ?? d.weekdayEndMinute,
    weekendStartMinute: p?.weekendStartMinute ?? d.weekendStartMinute,
    weekendEndMinute: p?.weekendEndMinute ?? d.weekendEndMinute,
    maxWeekdayMinutes: p?.maxWeekdayMinutes ?? d.maxWeekdayMinutes,
    maxWeekendMinutes: p?.maxWeekendMinutes ?? d.maxWeekendMinutes,
    qualityBands: p?.qualityBands && p.qualityBands.length > 0 ? p.qualityBands : [...cfg.QUALITY_BANDS],
  };
}

function isWeekend(day: Date): boolean {
  const w = day.getDay();
  return w === 0 || w === 6;
}

function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function dayWindowMinutes(day: Date, prefs: PlacementPreferences): { start: number; end: number } {
  return isWeekend(day)
    ? { start: prefs.weekendStartMinute, end: prefs.weekendEndMinute }
    : { start: prefs.weekdayStartMinute, end: prefs.weekdayEndMinute };
}

function dayCapacity(day: Date, prefs: PlacementPreferences): number {
  return isWeekend(day) ? prefs.maxWeekendMinutes : prefs.maxWeekdayMinutes;
}

function windowFor(day: Date, prefs: PlacementPreferences): BusyInterval {
  const w = dayWindowMinutes(day, prefs);
  const start = new Date(day);
  start.setHours(Math.floor(w.start / 60), w.start % 60, 0, 0);
  const end = new Date(day);
  end.setHours(Math.floor(w.end / 60), w.end % 60, 0, 0);
  return { start, end };
}

// Free intervals inside every day's AVAILABILITY window from `now` to horizon,
// with all busy time subtracted. Never past, never overnight. Reuses the classic
// window-minus-busy subtraction; the window now varies weekday vs weekend.
function buildFreeIntervals(
  now: Date,
  horizonEnd: Date,
  busy: BusyInterval[],
  prefs: PlacementPreferences
): BusyInterval[] {
  const free: BusyInterval[] = [];
  let day = startOfDay(now);
  while (day <= horizonEnd) {
    const win = windowFor(day, prefs);
    const winStart = new Date(Math.max(win.start.getTime(), now.getTime()));
    const winEnd = new Date(Math.min(win.end.getTime(), horizonEnd.getTime()));
    if (winStart < winEnd) {
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

// Average time-of-day quality over [startMin, endMin) — exact piecewise integral
// over the quality bands, so a session that straddles two bands is scored fairly.
function windowQuality(startMin: number, endMin: number, prefs: PlacementPreferences): number {
  const span = endMin - startMin;
  if (span <= 0) return 0;
  let sum = 0;
  for (const band of prefs.qualityBands) {
    const s = Math.max(startMin, band.startMin);
    const e = Math.min(endMin, band.endMin);
    if (e > s) sum += (e - s) * band.weight;
  }
  return sum / span;
}

// Best free sub-slot of `minutes` on ONE day, within [lo, hi]. Ranks candidate
// starts by (1) time-of-day QUALITY, then (2) least-globally-used HOUR, then (3)
// earliest. The hour tie-break spreads sessions ACROSS the day over the whole
// schedule — so within the broad prime plateau, successive sessions rotate
// through the usable hours instead of all stacking at the earliest prime time.
// `hourLoad` is the global start-hour histogram. Returns null if nothing fits.
function bestSlotInDay(
  free: BusyInterval[],
  dayKey: number,
  minutes: number,
  lo: Date,
  hi: Date,
  prefs: PlacementPreferences,
  cfg: Config,
  hourLoad: Map<number, number>
): { start: Date; end: Date; quality: number } | null {
  const need = minutes * MS_PER_MIN;
  const step = cfg.PLACEMENT.GRANULARITY_MINUTES * MS_PER_MIN;
  type Cand = { startMs: number; quality: number; used: number };
  const ref: { best: Cand | null } = { best: null };
  const consider = (t: number) => {
    const startMin = minuteOfDay(new Date(t));
    const q = windowQuality(startMin, startMin + minutes, prefs);
    const used = hourLoad.get(Math.floor(startMin / 60)) ?? 0;
    const b = ref.best;
    if (b === null || q > b.quality + EPS) {
      ref.best = { startMs: t, quality: q, used };
    } else if (Math.abs(q - b.quality) <= EPS) {
      if (used < b.used || (used === b.used && t < b.startMs)) {
        ref.best = { startMs: t, quality: q, used };
      }
    }
  };
  for (const iv of free) {
    if (dayKeyOf(iv.start) !== dayKey) continue;
    const s0 = Math.max(iv.start.getTime(), lo.getTime());
    const e0 = Math.min(iv.end.getTime(), hi.getTime());
    if (e0 - s0 < need) continue;
    const lastStart = e0 - need;
    for (let t = s0; t <= lastStart + EPS; t += step) consider(t);
    // Always consider the exact latest position too, so end-of-window prime time
    // is never missed by the coarse step.
    consider(lastStart);
  }
  const chosen = ref.best;
  if (!chosen) return null;
  return { start: new Date(chosen.startMs), end: new Date(chosen.startMs + need), quality: chosen.quality };
}

// Carve a specific placed slot out of the free list (splice + leftovers).
function takeSpecificSlot(free: BusyInterval[], slot: BusyInterval): void {
  const s = slot.start.getTime();
  const e = slot.end.getTime();
  for (let i = 0; i < free.length; i++) {
    const iv = free[i];
    if (iv.start.getTime() <= s && iv.end.getTime() >= e) {
      const leftovers: BusyInterval[] = [];
      if (iv.start.getTime() < s) leftovers.push({ start: iv.start, end: new Date(s) });
      if (iv.end.getTime() > e) leftovers.push({ start: new Date(e), end: iv.end });
      free.splice(i, 1, ...leftovers);
      return;
    }
  }
}

function offsetToDay(now: Date, offset: number): Date {
  return addDays(startOfDay(now), offset);
}

// --- The unified placement pass ----------------------------------------------

export function planSchedule(input: {
  now: Date;
  tasks: PlannableTask[];
  busy: BusyInterval[];
  locked?: LockedSession[];
  preferences?: Partial<PlacementPreferences>;
  config?: Config;
}): PlannedBlock[] {
  const cfg = input.config ?? SCHEDULER_CONFIG;
  const prefs = resolvePreferences(input.preferences, cfg);
  const { now } = input;

  const lockedByTask = new Map<string, LockedSession[]>();
  for (const l of input.locked ?? []) {
    const key = `${l.sourceKind}:${l.taskId}`;
    (lockedByTask.get(key) ?? lockedByTask.set(key, []).get(key)!).push(l);
  }

  // Shared daily study-load ledger (LEVELING), seeded with the minutes of blocks
  // the student already moved so those days count as partly full.
  const dayLoad = new Map<number, number>();
  // Global start-hour histogram (TIME-OF-DAY spreading): how many sessions start
  // in each hour, so successive sessions rotate through the usable hours instead
  // of all stacking at the earliest prime time. Seeded with moved blocks.
  const hourLoad = new Map<number, number>();
  for (const l of input.locked ?? []) {
    const key = dayKeyOf(l.start);
    dayLoad.set(key, (dayLoad.get(key) ?? 0) + slotMinutes(l));
    const h = l.start.getHours();
    hourLoad.set(h, (hourLoad.get(h) ?? 0) + 1);
  }

  // Horizon: HORIZON_DAYS out, stretched to the furthest deadline, capped.
  const cap = addDays(startOfDay(now), cfg.HORIZON_CAP_DAYS);
  const base = addDays(startOfDay(now), cfg.HORIZON_DAYS);
  const furthest = input.tasks.reduce((m, t) => (t.deadline > m ? t.deadline : m), base);
  const horizonEnd = new Date(Math.min(furthest.getTime(), cap.getTime()));

  const free = buildFreeIntervals(now, horizonEnd, input.busy, prefs);

  // Urgency order: earliest deadline first, then larger effort, then id.
  const tasks = [...input.tasks].sort(
    (a, b) =>
      a.deadline.getTime() - b.deadline.getTime() ||
      (b.totalMinutes ?? 0) - (a.totalMinutes ?? 0) ||
      a.id.localeCompare(b.id)
  );

  const out: PlannedBlock[] = [];

  // Place ONE session of `minutes` for a task, scoring days across [firstDay,
  // lastDay] and choosing the best (spread + leveling + quality). Books it against
  // free + dayLoad. Returns the placed slot or null (couldn't fit under capacity).
  const placeSession = (
    minutes: number,
    idealOffset: number,
    firstDay: number,
    lastDay: number,
    deadline: Date
  ): BusyInterval | null => {
    let best: { day: Date; key: number; slot: { start: Date; end: Date; quality: number }; score: number } | null =
      null;
    for (let d = firstDay; d <= lastDay; d++) {
      const day = offsetToDay(now, d);
      const key = dayKeyOf(day);
      const remaining = dayCapacity(day, prefs) - (dayLoad.get(key) ?? 0);
      if (remaining < minutes) continue; // leveling: this day is full
      const slot = bestSlotInDay(free, key, minutes, now, deadline, prefs, cfg, hourLoad);
      if (!slot) continue;
      const spread = -Math.abs(d - idealOffset);
      const level = dayCapacity(day, prefs) > 0 ? remaining / dayCapacity(day, prefs) : 0;
      const score =
        cfg.PLACEMENT.WEIGHT_SPREAD * spread +
        cfg.PLACEMENT.WEIGHT_LEVEL * level +
        cfg.PLACEMENT.WEIGHT_QUALITY * slot.quality;
      if (best === null || score > best.score + EPS) best = { day, key, slot, score };
    }
    if (!best) return null;
    const placed = { start: best.slot.start, end: best.slot.end };
    takeSpecificSlot(free, placed);
    dayLoad.set(best.key, (dayLoad.get(best.key) ?? 0) + minutes);
    const h = placed.start.getHours();
    hourLoad.set(h, (hourLoad.get(h) ?? 0) + 1); // feed the time-of-day rotation
    return placed;
  };

  // Place a small MARKER (reserved / needs-input) near the deadline, in real free
  // time, without counting it against capacity. Scans days deadline-first.
  const placeMarker = (
    minutes: number,
    firstDay: number,
    lastDay: number,
    deadline: Date
  ): BusyInterval | null => {
    for (let d = lastDay; d >= firstDay; d--) {
      const key = dayKeyOf(offsetToDay(now, d));
      const slot = bestSlotInDay(free, key, minutes, now, deadline, prefs, cfg, hourLoad);
      if (slot) {
        const placed = { start: slot.start, end: slot.end };
        takeSpecificSlot(free, placed);
        return placed;
      }
    }
    return null;
  };

  for (const task of tasks) {
    if (task.deadline <= now) continue;

    const archetype = effectiveArchetype(task);
    const spacingSchedule = task.spacingSchedule ?? null;
    const lockedForTask = lockedByTask.get(`${task.kind}:${task.id}`) ?? [];
    const lastDay = daysUntil(now, task.deadline);

    // --- Unknown type → one needs-input placeholder near the deadline ---------
    if (task.needsInput || task.totalMinutes == null) {
      if (lockedForTask.length > 0) continue; // already has a moved block
      const firstDay = Math.max(0, lastDay - leadDaysFor(cfg.PLACEHOLDER_MINUTES, cfg));
      const slot = placeSession(cfg.PLACEHOLDER_MINUTES, lastDay, firstDay, lastDay, task.deadline);
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
          archetype,
          spacingSchedule,
        });
      }
      continue;
    }

    // --- Sessions + reconciliation of moved blocks ----------------------------
    const sessions =
      archetype === "completion" ? [task.totalMinutes] : splitSessions(task.totalMinutes, cfg);
    const count = sessions.length;

    const takenIndices = new Set(
      lockedForTask
        .map((l) => l.sessionIndex)
        .filter((n): n is number => n != null && n >= 1 && n <= count)
    );
    let openSlots = sessions
      .map((minutes, i) => ({ index: i + 1, minutes }))
      .filter((s) => !takenIndices.has(s.index));
    const untracked = lockedForTask.length - takenIndices.size;
    if (untracked > 0) openSlots = openSlots.slice(untracked);

    // Smoothing window: [deadline − leadDays, deadline]. Sessions FAN from the
    // start of the window (session 1) to the deadline (last session); a SINGLE
    // session targets the deadline day. This deadline-biased ideal (not a middle
    // bias) means a lone task lands near its due date, while the cross-task LEVEL
    // pressure in placeSession pushes a CLUSTER of same-deadline work onto
    // earlier days as the near-deadline days fill — spreading, and reaching back.
    const total = sessions.reduce((a, b) => a + b, 0);
    const firstDay = Math.max(0, lastDay - leadDaysFor(total, cfg));
    const span = lastDay - firstDay;
    const n = openSlots.length;
    const idealFor = (j: number) =>
      n <= 1 ? lastDay : clamp(firstDay + Math.round((j * span) / (n - 1)), firstDay, lastDay);

    let placedCount = 0;
    openSlots.forEach((s, j) => {
      const slot = placeSession(s.minutes, idealFor(j), firstDay, lastDay, task.deadline);
      if (slot) {
        placedCount++;
        out.push({
          sourceKind: task.kind,
          taskId: task.id,
          title: task.title,
          start: slot.start,
          end: slot.end,
          state: "scheduled",
          reason: reasonFor(archetype, s.index, count, slot.start),
          sessionIndex: s.index,
          sessionCount: count,
          archetype,
          spacingSchedule,
        });
      }
    });

    // --- Honest shortfall: overflow → ONE reserved marker, never crammed ------
    if (placedCount < openSlots.length) {
      const missing = openSlots.slice(placedCount).reduce((a, b) => a + b.minutes, 0);
      const firstUnplacedIndex = openSlots[placedCount].index;
      const slot =
        placeMarker(cfg.MIN_CHUNK_MINUTES, firstDay, lastDay, task.deadline) ??
        placeMarker(cfg.MIN_CHUNK_MINUTES, 0, lastDay, task.deadline);
      if (slot) {
        out.push({
          sourceKind: task.kind,
          taskId: task.id,
          title: task.title,
          start: slot.start,
          end: slot.end,
          state: "reserved",
          reason: `Not enough capacity before the deadline for ~${missing} more min — held as a reminder.`,
          sessionIndex: firstUnplacedIndex,
          sessionCount: count,
          archetype,
          spacingSchedule,
        });
      }
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function reasonFor(archetype: Archetype | null, index: number, count: number, start: Date): string {
  const when = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (archetype === "memorization") {
    return `Study session ${index} of ${count} for your test — spaced out to help it stick (${when}).`;
  }
  if (archetype === "completion") {
    return `Time to finish and submit this (${when}).`;
  }
  return `Work session ${index} of ${count}, spread out before the due date (${when}).`;
}
