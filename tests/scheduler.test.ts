import { describe, it, expect } from "vitest";
import {
  planSchedule,
  resolveDurationMinutes,
  resolveArchetypeDuration,
  spacingScheduleFor,
  type BusyInterval,
  type LockedSession,
  type PlannableTask,
} from "@/lib/scheduler";
import { SCHEDULER_CONFIG } from "@/lib/scheduler-config";

// Dates use LOCAL constructors and the engine uses local hours, so assertions on
// windows/ordering hold regardless of the runner's timezone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi, 0, 0);
const now = at(2026, 0, 5, 9, 0); // Mon Jan 5 2026, 09:00 (Jan 10 = Sat, Jan 11 = Sun)

const A = SCHEDULER_CONFIG.AVAILABILITY_DEFAULTS;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const winStart = (d: Date) => (isWeekend(d) ? A.weekendStartMinute : A.weekdayStartMinute);
const winEnd = (d: Date) => (isWeekend(d) ? A.weekendEndMinute : A.weekdayEndMinute);
const capOf = (d: Date) => (isWeekend(d) ? A.maxWeekendMinutes : A.maxWeekdayMinutes);
const dayKey = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const mins = (b: { start: Date; end: Date }) => (b.end.getTime() - b.start.getTime()) / 60000;
const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) =>
  a.start < b.end && b.start < a.end;

const task = (o: Partial<PlannableTask> & { id: string; deadline: Date; totalMinutes: number | null }): PlannableTask => ({
  kind: "assignment",
  title: `Task ${o.id}`,
  needsInput: o.totalMinutes == null,
  archetype: o.totalMinutes == null ? null : "production",
  spacingSchedule: null,
  ...o,
});

// ---------------------------------------------------------------------------
// Pure duration helpers (unchanged by Stage B).
// ---------------------------------------------------------------------------
describe("duration helpers", () => {
  it("applies the 1.4x buffer and category defaults (legacy ladder)", () => {
    expect(resolveDurationMinutes(100, null)).toBe(140);
    expect(resolveDurationMinutes(null, "reading")).toBe(60);
    expect(resolveDurationMinutes(null, "mystery")).toBeNull();
  });
  it("sizes archetypes and applies per-archetype buffers", () => {
    expect(resolveArchetypeDuration({ estMinutes: null, archetype: "completion", subtype: null, points: 99 })).toBe(15);
    expect(resolveArchetypeDuration({ estMinutes: null, archetype: "production", subtype: "project", points: 30 })).toBe(480);
    expect(resolveArchetypeDuration({ estMinutes: null, archetype: "memorization", subtype: "exam", points: null })).toBe(360);
    expect(resolveArchetypeDuration({ estMinutes: 100, archetype: "production", subtype: null, points: null })).toBe(150);
  });
  it("picks a spacing schedule by distance", () => {
    expect(spacingScheduleFor(10)).toBe("2-3-5-7");
    expect(spacingScheduleFor(30)).toBe("1-3-7-21");
  });
});

// ---------------------------------------------------------------------------
// The 10 acceptance criteria (the definition of done for the placement engine).
// ---------------------------------------------------------------------------
describe("placement engine — acceptance criteria", () => {
  // A spread of realistic tasks used by several criteria.
  const mixedTasks: PlannableTask[] = [
    task({ id: "1", deadline: at(2026, 0, 12, 23, 59), totalMinutes: 180 }),
    task({ id: "2", deadline: at(2026, 0, 13, 23, 59), totalMinutes: 240 }),
    task({ id: "3", deadline: at(2026, 0, 14, 23, 59), totalMinutes: 120 }),
    { ...task({ id: "e1", deadline: at(2026, 0, 15, 10, 0), totalMinutes: 360 }), kind: "exam", archetype: "memorization", spacingSchedule: "2-3-5-7" },
  ];
  // A recurring weekday class 10:00–11:00 as a fixed commitment.
  const classes: BusyInterval[] = [0, 1, 2, 5, 6, 7].map((off) => ({
    start: at(2026, 0, 5 + off, 10, 0),
    end: at(2026, 0, 5 + off, 11, 0),
  }));

  it("(1) no session overlaps a commitment or another session", () => {
    const blocks = planSchedule({ now, tasks: mixedTasks, busy: classes });
    for (const b of blocks) for (const c of classes) expect(overlaps(b, c)).toBe(false);
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) expect(overlaps(blocks[i], blocks[j])).toBe(false);
  });

  it("(2)/(3) every block is inside allowed hours, never overnight, no 8am weekend", () => {
    const blocks = planSchedule({ now, tasks: mixedTasks, busy: classes });
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.start.getDate()).toBe(b.end.getDate()); // never overnight
      expect(minuteOfDay(b.start)).toBeGreaterThanOrEqual(winStart(b.start));
      expect(minuteOfDay(b.end)).toBeLessThanOrEqual(winEnd(b.start));
    }
    // The specific symptom: nothing stacked at 8am on Sat/Sun (or any weekend
    // time before the 10:00 weekend start).
    const weekendEarly = blocks.filter((b) => isWeekend(b.start) && minuteOfDay(b.start) < A.weekendStartMinute);
    expect(weekendEarly).toHaveLength(0);
    expect(blocks.filter((b) => isWeekend(b.start) && b.start.getHours() === 8)).toHaveLength(0);
  });

  it("(4) daily study capacity holds across ALL tasks combined", () => {
    const blocks = planSchedule({ now, tasks: mixedTasks, busy: classes });
    const perDay = new Map<number, number>();
    for (const b of blocks.filter((x) => x.state === "scheduled")) {
      perDay.set(dayKey(b.start), (perDay.get(dayKey(b.start)) ?? 0) + mins(b));
    }
    for (const [key, total] of perDay) {
      expect(total).toBeLessThanOrEqual(capOf(new Date(key)));
    }
  });

  it("(5) a multi-session task is SPREAD across days, not massed on one day", () => {
    const big = task({ id: "1", deadline: at(2026, 0, 20, 23, 59), totalMinutes: 360 }); // 4×90
    const blocks = planSchedule({ now, tasks: [big], busy: [] }).filter((b) => b.state === "scheduled");
    expect(blocks.length).toBe(4);
    const days = new Set(blocks.map((b) => dayKey(b.start)));
    expect(days.size).toBeGreaterThanOrEqual(3); // spread out, not all on day one
  });

  it("(6) deterministic + idempotent (same inputs → identical output)", () => {
    const shape = (bs: ReturnType<typeof planSchedule>) =>
      bs.map((b) => `${b.taskId}|${b.sessionIndex}/${b.sessionCount}|${b.state}|${b.start.toISOString()}|${b.end.toISOString()}`);
    const a = planSchedule({ now, tasks: mixedTasks, busy: classes });
    const b = planSchedule({ now, tasks: mixedTasks, busy: classes });
    expect(shape(a)).toEqual(shape(b));
  });

  it("(7) moved blocks are respected — fixed, not overlapped, no N+1", () => {
    const t = task({ id: "1", deadline: at(2026, 0, 14, 23, 59), totalMinutes: 270 }); // 3×90
    const movedStart = at(2026, 0, 8, 15, 0);
    const movedEnd = at(2026, 0, 8, 16, 30);
    const locked: LockedSession[] = [
      { sourceKind: "assignment", taskId: "1", sessionIndex: 2, start: movedStart, end: movedEnd },
    ];
    const busy: BusyInterval[] = [{ start: movedStart, end: movedEnd }];
    const blocks = planSchedule({ now, tasks: [t], busy, locked });
    const scheduled = blocks.filter((b) => b.state === "scheduled");
    expect(scheduled).toHaveLength(2); // 3 total − 1 already moved (never 4)
    expect(new Set(scheduled.map((b) => b.sessionIndex))).toEqual(new Set([1, 3]));
    for (const b of scheduled) {
      expect(b.sessionCount).toBe(3);
      expect(overlaps(b, busy[0])).toBe(false);
    }
  });

  it("(8) overflow becomes reserved, never crammed past capacity", () => {
    // Five large tasks all due in two days — far more than 2 weekdays' capacity.
    const heavy = [1, 2, 3, 4, 5].map((i) =>
      task({ id: `${i}`, deadline: at(2026, 0, 7, 21, 0), totalMinutes: 480 })
    );
    const blocks = planSchedule({ now, tasks: heavy, busy: [] });
    expect(blocks.some((b) => b.state === "reserved")).toBe(true);
    const perDay = new Map<number, number>();
    for (const b of blocks.filter((x) => x.state === "scheduled")) {
      perDay.set(dayKey(b.start), (perDay.get(dayKey(b.start)) ?? 0) + mins(b));
    }
    for (const [key, total] of perDay) expect(total).toBeLessThanOrEqual(capOf(new Date(key)));
  });

  it("(9) every block carries a plain-language reason", () => {
    const withUnknown = [...mixedTasks, task({ id: "u1", deadline: at(2026, 0, 12, 23, 59), totalMinutes: null })];
    const blocks = planSchedule({ now, tasks: withUnknown, busy: classes });
    for (const b of blocks) expect(typeof b.reason === "string" && b.reason.length > 0).toBe(true);
  });

  it("(10) exam/memorization study spreads across distinct days before the date", () => {
    const exam: PlannableTask = {
      kind: "exam", id: "e1", title: "Final", deadline: at(2026, 0, 15, 10, 0),
      totalMinutes: 360, needsInput: false, archetype: "memorization", spacingSchedule: "2-3-5-7",
    };
    const blocks = planSchedule({ now, tasks: [exam], busy: [] }).filter((b) => b.state === "scheduled");
    for (const b of blocks) expect(b.end.getTime()).toBeLessThanOrEqual(exam.deadline.getTime());
    const days = new Set(blocks.map((b) => dayKey(b.start)));
    expect(days.size).toBeGreaterThanOrEqual(3);
  });

  it("real-world symptom gone: a normal week places NOTHING at 8am on Sat/Sun", () => {
    // A realistic-ish load: several assignments + an exam + weekday classes.
    const load: PlannableTask[] = [
      task({ id: "a", deadline: at(2026, 0, 12, 23, 59), totalMinutes: 120 }),
      task({ id: "b", deadline: at(2026, 0, 13, 23, 59), totalMinutes: 180 }),
      task({ id: "c", deadline: at(2026, 0, 14, 23, 59), totalMinutes: 240 }),
      task({ id: "d", deadline: at(2026, 0, 16, 23, 59), totalMinutes: 300 }),
    ];
    const blocks = planSchedule({ now, tasks: load, busy: classes });
    const badWeekend = blocks.filter(
      (b) => isWeekend(b.start) && minuteOfDay(b.start) < A.weekendStartMinute
    );
    expect(badWeekend).toHaveLength(0);
  });
});
