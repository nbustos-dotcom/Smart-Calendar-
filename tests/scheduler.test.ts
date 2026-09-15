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

describe("planSchedule — deadline-aware placement (anti-flood)", () => {
  const now = at(2026, 0, 5, 8, 0); // Mon Jan 5, 08:00
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  it("does NOT place a far-future small assignment in the near term", () => {
    // 60-min task (lead ≈ 2 days) due 25 days out → work belongs at the END.
    const task: PlannableTask = {
      kind: "assignment",
      id: "1",
      title: "Quiz",
      deadline: at(2026, 0, 30, 23, 59),
      totalMinutes: 60,
      needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks.length).toBeGreaterThan(0);
    // Nothing lands anywhere near "now" — every block sits inside the lead window
    // just before the due date (here, on/after Jan 28), not on Jan 5/6.
    const windowStart = at(2026, 0, 28, 0, 0);
    for (const b of blocks) {
      expect(b.start.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
      expect(b.end.getTime()).toBeLessThanOrEqual(task.deadline.getTime());
    }
  });

  it("surfaces a large far-future assignment only within its lead window", () => {
    // 480-min task (lead ≈ 2 weeks) due 25 days out → nothing before Jan 16.
    const task: PlannableTask = {
      kind: "assignment",
      id: "1",
      title: "Project",
      deadline: at(2026, 0, 30, 23, 59),
      totalMinutes: 480,
      needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks.filter((b) => b.state === "scheduled").length).toBe(6); // 6×80
    const windowStart = at(2026, 0, 16, 0, 0); // due − 14 days
    for (const b of blocks) {
      expect(b.start.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
    }
  });

  it("caps real placement at MAX_STUDY_MINUTES_PER_DAY (never crams)", () => {
    // 540 min (six 90-min sessions) due tomorrow → only two days in range and a
    // 180-min/day cap ⇒ exactly 4 fit (2/day); the rest is NOT crammed in.
    const task: PlannableTask = {
      kind: "assignment",
      id: "1",
      title: "Cram",
      deadline: at(2026, 0, 6, 22, 0),
      totalMinutes: 540,
      needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks.filter((b) => b.state === "scheduled")).toHaveLength(4);
    const perDay = new Map<number, number>();
    for (const b of blocks) {
      const key = startOfDay(b.start).getTime();
      perDay.set(key, (perDay.get(key) ?? 0) + (b.end.getTime() - b.start.getTime()) / 60000);
    }
    for (const total of perDay.values()) {
      expect(total).toBeLessThanOrEqual(SCHEDULER_CONFIG.MAX_STUDY_MINUTES_PER_DAY);
    }
  });

  it("defers an overflow reserved block rather than dumping it on a full day", () => {
    // Same saturating load: both in-range days hit the cap with real sessions, so
    // the leftover work has nowhere to go under the cap. Per policy it is DEFERRED
    // — nothing is dumped onto an already-full (or earlier) day.
    const task: PlannableTask = {
      kind: "assignment",
      id: "1",
      title: "Cram",
      deadline: at(2026, 0, 6, 22, 0),
      totalMinutes: 540,
      needsInput: false,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks.some((b) => b.state === "reserved")).toBe(false);
    // Every day still within the cap across ALL block states.
    const perDay = new Map<number, number>();
    for (const b of blocks) {
      const key = startOfDay(b.start).getTime();
      perDay.set(key, (perDay.get(key) ?? 0) + (b.end.getTime() - b.start.getTime()) / 60000);
    }
    for (const total of perDay.values()) {
      expect(total).toBeLessThanOrEqual(SCHEDULER_CONFIG.MAX_STUDY_MINUTES_PER_DAY);
    }
  });

  it("(a) keeps far-future work — scheduled, reserved AND needs_input — out of the current week", () => {
    // Two tasks due ~11 weeks out (Mar 23): one sized (2-week lead), one unknown
    // type. Neither's lead window has opened, so NOTHING appears this week.
    const due = at(2026, 2, 23, 23, 59);
    const tasks: PlannableTask[] = [
      { kind: "assignment", id: "1", title: "Final Project", deadline: due, totalMinutes: 480, needsInput: false },
      { kind: "assignment", id: "2", title: "Week 14 ???", deadline: due, totalMinutes: null, needsInput: true },
    ];
    const blocks = planSchedule({ now, tasks, busy: [] });
    const endOfWeek = at(2026, 0, 12, 0, 0); // start Jan 5 → the week ends Jan 12
    const thisWeek = blocks.filter((b) => b.start.getTime() < endOfWeek.getTime());
    expect(thisWeek).toHaveLength(0);
    // Belt and suspenders: no near-term block of ANY state slipped through.
    for (const b of blocks) {
      expect(b.start.getTime()).toBeGreaterThanOrEqual(endOfWeek.getTime());
    }
  });

  it("(b) places a needs_input placeholder inside its lead window, never at `now`", () => {
    // Unknown-type task due Jan 20 (15 days out). The placeholder must appear near
    // the deadline (inside the lead window), not dumped on today.
    const due = at(2026, 0, 20, 23, 59);
    const task: PlannableTask = {
      kind: "assignment", id: "1", title: "???", deadline: due, totalMinutes: null, needsInput: true,
    };
    const blocks = planSchedule({ now, tasks: [task], busy: [] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].state).toBe("needs_input");
    const windowStart = at(2026, 0, 18, 0, 0); // due − 2 days (placeholder lead)
    expect(blocks[0].start.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
    expect(blocks[0].start.getTime()).toBeLessThanOrEqual(due.getTime());
    // Emphatically not at/near now.
    expect(blocks[0].start.getTime()).toBeGreaterThan(at(2026, 0, 15, 0, 0).getTime());
  });

  it("(c) placeholders respect the daily cap and don't stack past it", () => {
    // Two 180-min tasks saturate today + tomorrow to the cap; a third, unknown-type
    // task shares that window. Its placeholder must NOT push either day over the cap.
    const deadline = at(2026, 0, 6, 22, 0);
    const tasks: PlannableTask[] = [
      { kind: "assignment", id: "A", title: "A", deadline, totalMinutes: 180, needsInput: false },
      { kind: "assignment", id: "B", title: "B", deadline, totalMinutes: 180, needsInput: false },
      { kind: "assignment", id: "C", title: "C ???", deadline, totalMinutes: null, needsInput: true },
    ];
    const blocks = planSchedule({ now, tasks, busy: [] });
    expect(blocks.filter((b) => b.state === "scheduled")).toHaveLength(4); // 2 tasks × 2
    // The needs_input placeholder found no room under the cap → deferred, not stacked.
    expect(blocks.some((b) => b.state === "needs_input")).toBe(false);
    const perDay = new Map<number, number>();
    for (const b of blocks) {
      const key = startOfDay(b.start).getTime();
      perDay.set(key, (perDay.get(key) ?? 0) + (b.end.getTime() - b.start.getTime()) / 60000);
    }
    for (const total of perDay.values()) {
      expect(total).toBeLessThanOrEqual(SCHEDULER_CONFIG.MAX_STUDY_MINUTES_PER_DAY);
    }
  });
});

describe("planSchedule — moved-block reconciliation (no N+1 duplication)", () => {
  const now = at(2026, 0, 5, 8, 0);

  it("counts a moved block as one of its task's sessions (3 → 3, not 4)", () => {
    // A 3-session task where the student already moved session 2 by hand.
    const task: PlannableTask = {
      kind: "assignment",
      id: "1",
      title: "PSet",
      deadline: at(2026, 0, 12, 23, 59),
      totalMinutes: 270, // three 90-min sessions
      needsInput: false,
    };
    const movedStart = at(2026, 0, 8, 10, 0);
    const movedEnd = at(2026, 0, 8, 11, 30);
    const locked = [
      { sourceKind: "assignment" as const, taskId: "1", sessionIndex: 2, start: movedStart, end: movedEnd },
    ];
    const busy: BusyInterval[] = [{ start: movedStart, end: movedEnd }];

    const blocks = planSchedule({ now, tasks: [task], busy, locked });
    const scheduled = blocks.filter((b) => b.state === "scheduled");

    // Only the TWO remaining sessions are regenerated (not three).
    expect(scheduled).toHaveLength(2);
    for (const b of scheduled) expect(b.sessionCount).toBe(3);
    // They fill the open slots (1 and 3); the moved block keeps slot 2.
    expect(new Set(scheduled.map((b) => b.sessionIndex))).toEqual(new Set([1, 3]));
    // Regenerated (2) + kept moved block (1) = 3 total — never 4.
    expect(scheduled.length + locked.length).toBe(3);
    // None of the regenerated work collides with the moved block.
    for (const b of scheduled) expect(overlaps(b, busy[0])).toBe(false);
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
