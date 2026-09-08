// ============================================================================
// CALENDAR DATE HELPERS — the week/month grid math
//
// Pure date-in / date-out functions used by the calendar UI. Kept separate and
// unit-tested (see tests/calendar.test.ts) so the calendar component stays simple.
// ============================================================================

// Pure date helpers for building calendar grids. No React, no data fetching —
// just dates in, dates out — so they are easy to read and to unit-test.
//
// Weeks start on Sunday (0), matching how MTU/Canvas calendars usually read.

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// The Sunday on or before `date`.
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  return addDays(d, -d.getDay());
}

// The 7 days of the week containing `date` (Sunday → Saturday).
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// A month laid out as full weeks: leading days from the previous month and
// trailing days from the next month fill the grid so every row has 7 cells.
// Returns an array of weeks, each an array of 7 Dates.
export function monthGrid(year: number, month: number): Date[][] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = startOfWeek(firstOfMonth);

  const weeks: Date[][] = [];
  let cursor = gridStart;

  // Six weeks (42 cells) always covers any month layout.
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}
