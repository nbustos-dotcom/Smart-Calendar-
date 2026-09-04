import { describe, it, expect } from "vitest";
import {
  startOfWeek,
  weekDays,
  monthGrid,
  isSameDay,
  addDays,
} from "@/lib/calendar";

describe("startOfWeek", () => {
  it("returns the Sunday on or before the date", () => {
    // 2026-09-09 is a Wednesday; the Sunday before is 2026-09-06.
    const wed = new Date(2026, 8, 9);
    const sun = startOfWeek(wed);
    expect(sun.getDay()).toBe(0);
    expect(sun.getDate()).toBe(6);
  });
});

describe("weekDays", () => {
  it("returns 7 consecutive days starting on Sunday", () => {
    const days = weekDays(new Date(2026, 8, 9));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
    expect(days[6].getDay()).toBe(6);
    expect(isSameDay(days[3], new Date(2026, 8, 9))).toBe(true);
  });
});

describe("monthGrid", () => {
  it("is a 6x7 grid covering the whole month", () => {
    const weeks = monthGrid(2026, 8); // September 2026
    expect(weeks).toHaveLength(6);
    weeks.forEach((w) => expect(w).toHaveLength(7));
    // First cell is a Sunday, last cell is a Saturday.
    expect(weeks[0][0].getDay()).toBe(0);
    expect(weeks[5][6].getDay()).toBe(6);
    // The 1st of the month appears somewhere in the first row.
    const firstRowDates = weeks[0].map((d) => d.getDate());
    expect(firstRowDates).toContain(1);
  });
});

describe("addDays / isSameDay", () => {
  it("adds days across a month boundary", () => {
    const d = addDays(new Date(2026, 8, 30), 2); // Sep 30 + 2 = Oct 2
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(2);
  });

  it("isSameDay ignores the time of day", () => {
    const morning = new Date(2026, 8, 9, 8, 0);
    const evening = new Date(2026, 8, 9, 20, 30);
    expect(isSameDay(morning, evening)).toBe(true);
  });
});
