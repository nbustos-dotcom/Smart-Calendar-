import { describe, it, expect } from "vitest";
import {
  expandOccurrencesForRange,
  ymd,
  type UserEventRow,
  type OverrideRow,
} from "@/lib/recurrence";

// A base recurring series: Mon/Wed/Fri, 9:00–10:00, no start anchor.
function series(overrides: Partial<UserEventRow> = {}): UserEventRow {
  return {
    id: "ev1",
    title: "Gym",
    color: "green",
    is_recurring: true,
    starts_at: null,
    ends_at: null,
    weekdays: [1, 3, 5], // Mon, Wed, Fri
    start_minute: 540, // 9:00
    end_minute: 600, // 10:00
    series_start_date: null,
    ...overrides,
  };
}

// The week of Sun 2026-09-06 .. Sun 2026-09-13 (exclusive).
const weekStart = new Date(2026, 8, 6, 0, 0, 0, 0); // Sun
const weekEnd = new Date(2026, 8, 13, 0, 0, 0, 0); // next Sun

function startDates(occs: { start: Date }[]): string[] {
  return occs.map((o) => ymd(o.start)).sort();
}

describe("single events", () => {
  it("includes a single event inside the range and excludes outside", () => {
    const inRange: UserEventRow = {
      id: "s1",
      title: "Dentist",
      color: "blue",
      is_recurring: false,
      starts_at: new Date(2026, 8, 8, 14, 0).toISOString(),
      ends_at: new Date(2026, 8, 8, 15, 0).toISOString(),
      weekdays: [],
      start_minute: null,
      end_minute: null,
      series_start_date: null,
    };
    const outOfRange: UserEventRow = {
      ...inRange,
      id: "s2",
      starts_at: new Date(2026, 8, 20, 14, 0).toISOString(),
      ends_at: new Date(2026, 8, 20, 15, 0).toISOString(),
    };
    const occ = expandOccurrencesForRange(
      [inRange, outOfRange],
      [],
      weekStart,
      weekEnd
    );
    expect(occ).toHaveLength(1);
    expect(occ[0].eventId).toBe("s1");
    expect(occ[0].isRecurring).toBe(false);
  });
});

describe("recurring expansion", () => {
  it("produces an occurrence on each chosen weekday in the range", () => {
    const occ = expandOccurrencesForRange([series()], [], weekStart, weekEnd);
    // Mon 9/7, Wed 9/9, Fri 9/11
    expect(startDates(occ)).toEqual(["2026-09-07", "2026-09-09", "2026-09-11"]);
    expect(occ.every((o) => o.isRecurring)).toBe(true);
    expect(occ[0].start.getHours()).toBe(9);
    expect(occ[0].end.getHours()).toBe(10);
  });

  it("does not render before series_start_date", () => {
    const occ = expandOccurrencesForRange(
      [series({ series_start_date: "2026-09-10" })],
      [],
      weekStart,
      weekEnd
    );
    // Only Fri 9/11 is on/after the 10th (Mon 7th and Wed 9th are before).
    expect(startDates(occ)).toEqual(["2026-09-11"]);
  });
});

describe("per-instance overrides", () => {
  it("cancelled override hides only that occurrence; the rest remain", () => {
    const cancel: OverrideRow = {
      id: "o1",
      event_id: "ev1",
      occurrence_date: "2026-09-09", // the Wednesday
      status: "cancelled",
      starts_at: null,
      ends_at: null,
      title: null,
      color: null,
    };
    const occ = expandOccurrencesForRange(
      [series()],
      [cancel],
      weekStart,
      weekEnd
    );
    expect(startDates(occ)).toEqual(["2026-09-07", "2026-09-11"]);
  });

  it("modified override moves ONE occurrence; siblings keep the pattern", () => {
    const moved: OverrideRow = {
      id: "o2",
      event_id: "ev1",
      occurrence_date: "2026-09-09",
      status: "modified",
      starts_at: new Date(2026, 8, 9, 14, 0).toISOString(), // same day, 2pm
      ends_at: new Date(2026, 8, 9, 15, 30).toISOString(),
      title: "Gym (moved)",
      color: null,
    };
    const occ = expandOccurrencesForRange(
      [series()],
      [moved],
      weekStart,
      weekEnd
    );
    expect(startDates(occ)).toEqual(["2026-09-07", "2026-09-09", "2026-09-11"]);
    const wed = occ.find((o) => ymd(o.start) === "2026-09-09")!;
    expect(wed.start.getHours()).toBe(14); // moved to 2pm
    expect(wed.end.getHours()).toBe(15);
    expect(wed.title).toBe("Gym (moved)");
    // Siblings keep the 9:00 pattern and original title.
    const mon = occ.find((o) => ymd(o.start) === "2026-09-07")!;
    expect(mon.start.getHours()).toBe(9);
    expect(mon.title).toBe("Gym");
  });

  it("an occurrence dragged to another week leaves this week and appears there", () => {
    const movedNextWeek: OverrideRow = {
      id: "o3",
      event_id: "ev1",
      occurrence_date: "2026-09-09", // pattern date is in THIS week
      status: "modified",
      starts_at: new Date(2026, 8, 16, 9, 0).toISOString(), // moved to next Wed
      ends_at: new Date(2026, 8, 16, 10, 0).toISOString(),
      title: null,
      color: null,
    };

    // This week: the 9/9 slot is gone, only Mon + Fri remain.
    const thisWeek = expandOccurrencesForRange(
      [series()],
      [movedNextWeek],
      weekStart,
      weekEnd
    );
    expect(startDates(thisWeek)).toEqual(["2026-09-07", "2026-09-11"]);

    // Next week: the moved instance shows up (keyed to its original pattern date).
    const nextWeek = expandOccurrencesForRange(
      [series()],
      [movedNextWeek],
      new Date(2026, 8, 13, 0, 0, 0, 0),
      new Date(2026, 8, 20, 0, 0, 0, 0)
    );
    const moved = nextWeek.find((o) => o.occurrenceDate === "2026-09-09");
    expect(moved).toBeDefined();
    expect(ymd(moved!.start)).toBe("2026-09-16");
    expect(moved!.start.getHours()).toBe(9);
  });
});
