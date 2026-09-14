import { describe, it, expect } from "vitest";
import {
  planSchedule,
  resolveDurationMinutes,
  type BusyInterval,
  type PlannableTask,
} from "@/lib/scheduler";
import { SCHEDULER_CONFIG } from "@/lib/scheduler-config";

// Dates are built with LOCAL constructors and the engine uses local hours, so
// assertions on window/ordering hold regardless of the runner's timezone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi, 0, 0);

function withinWindow(b: { start: Date; end: Date }): boolean {
  const sh = b.start.getHours() + b.start.getMinutes() / 60;
  const eh = b.end.getHours() + b.end.getMinutes() / 60;
  // end may land exactly on END_HOUR; both must sit inside [start,end] hours.
  return sh >= SCHEDULER_CONFIG.DAY_WINDOW_START_HOUR && eh <= SCHEDULER_CONFIG.DAY_WINDOW_END_HOUR + 0.001;
}

function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}

describe("resolveDurationMinutes (ladder + buffer)", () => {
  it("applies the 1.4x buffer to the student's own estimate", () => {
    expect(resolveDurationMinutes(100, null)).toBe(140);
  });
  it("uses the category default as-is when there's no estimate", () => {
    expect(resolveDurationMinutes(null, "reading")).toBe(60);
    expect(resolveDurationMinutes(null, "project")).toBe(240);
  });
  it("returns null when neither estimate nor a known category exists", () => {
    expect(resolveDurationMinutes(null, null)).toBeNull();
    expect(resolveDurationMinutes(null, "mystery")).toBeNull();
  });
});

describe("planSchedule — assignments", () => {
  const now = at(2026, 0, 5, 8, 0); // Mon Jan 5, 08:00

  it("chunks into ≤90-min sessions, spreads earlier, and finishes before the due date", () => {
    const task: PlannableTask = {
      kind: "assignment",
      id: "1",
      title: "Essay",
      deadline: at(2026, 0, 10, 23, 59), // 5 days out
      totalMinutes: 180,
      needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks).toHaveLength(2); // 180 → two 90-min sessions
    for (const b of blocks) {
      expect(b.state).toBe("scheduled");
      expect(b.end.getTime()).toBeLessThanOrEqual(task.deadline.getTime());
      expect(withinWindow(b)).toBe(true);
      expect((b.end.getTime() - b.start.getTime()) / 60000).toBe(90);
    }
    // Spread across different days (one per day, earliest-first).
    expect(blocks[0].start.getDate()).not.toBe(blocks[1].start.getDate());
    expect(blocks[0].start.getTime()).toBeLessThan(blocks[1].start.getTime());
  });

  it("never double-books competing deadlines", () => {
    const tasks: PlannableTask[] = [
      { kind: "assignment", id: "1", title: "A", deadline: at(2026, 0, 6, 23, 59), totalMinutes: 90, needsInput: false },
      { kind: "assignment", id: "2", title: "B", deadline: at(2026, 0, 6, 23, 59), totalMinutes: 90, needsInput: false },
    ];
    const blocks = planSchedule({ now, tasks, busy: [] });
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        expect(overlaps(blocks[i], blocks[j])).toBe(false);
      }
    }
  });

  it("never overlaps existing busy time", () => {
    const busy: BusyInterval[] = [{ start: at(2026, 0, 5, 8, 0), end: at(2026, 0, 5, 12, 0) }];
    const task: PlannableTask = {
      kind: "assignment", id: "1", title: "HW", deadline: at(2026, 0, 5, 22, 0), totalMinutes: 60, needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy });
    for (const b of blocks) expect(overlaps(b, busy[0])).toBe(false);
  });

  it("holds a needs_input placeholder when the type is unknown", () => {
    const task: PlannableTask = {
      kind: "assignment", id: "1", title: "???", deadline: at(2026, 0, 8, 23, 59), totalMinutes: null, needsInput: true,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].state).toBe("needs_input");
    expect((blocks[0].end.getTime() - blocks[0].start.getTime()) / 60000).toBe(
      SCHEDULER_CONFIG.PLACEHOLDER_MINUTES
    );
  });

  it("flags a reserved shortfall when the work can't fully fit before the deadline", () => {
    // Only ~100 min free today (08:00–09:40); rest of the day is busy; due today.
    const busy: BusyInterval[] = [{ start: at(2026, 0, 5, 9, 40), end: at(2026, 0, 5, 22, 0) }];
    const task: PlannableTask = {
      kind: "assignment", id: "1", title: "Big", deadline: at(2026, 0, 5, 22, 0), totalMinutes: 120, needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy });
    expect(blocks.some((b) => b.state === "scheduled")).toBe(true);
    expect(blocks.some((b) => b.state === "reserved")).toBe(true);
  });
});

describe("planSchedule — exams (spacing effect)", () => {
  it("spaces a 2-day test into ~one session per day, all before the exam", () => {
    const now = at(2026, 0, 5, 8, 0);
    const exam: PlannableTask = {
      kind: "exam", id: "e1", title: "Midterm", deadline: at(2026, 0, 7, 10, 0), totalMinutes: 120, needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [exam], busy: [] });
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) expect(b.end.getTime()).toBeLessThanOrEqual(exam.deadline.getTime());
    const days = new Set(blocks.map((b) => b.start.getDate()));
    expect(days.size).toBeGreaterThanOrEqual(2); // spread, not massed in one block
  });
});
