// ============================================================================
// RECURRENCE — expand user events into concrete occurrences for a date range
//
// Pure functions, no network/DB, so the tricky per-occurrence override behavior
// is easy to unit-test (see tests/recurrence.test.ts).
//
// Scope (deliberately small — see the Phase 2 scope fence):
//  * Repeats are WEEKLY on chosen weekdays only. No monthly/every-N/until/count.
//  * A single occurrence can be overridden (moved/edited) or cancelled without
//    touching the rest of the series.
// ============================================================================

// The small preset colour palette offered in the event form.
export const EVENT_COLORS = [
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "red",
] as const;
export type EventColor = (typeof EVENT_COLORS)[number];

// What the create/edit form and the server actions pass around. Concrete times
// (startsAt/endsAt) are computed on the CLIENT from the user's local wall clock,
// so the stored instant matches what they picked regardless of server timezone.
export type EventPayload = {
  title: string;
  color: string;
  isRecurring: boolean;
  startsAt: string | null; // ISO — single events
  endsAt: string | null; // ISO — single events
  weekdays: number[]; // recurring
  startMinute: number | null; // recurring
  endMinute: number | null; // recurring
  seriesStartDate: string | null; // YYYY-MM-DD — recurring
};

// A row from public.user_events (single event OR recurring series master).
export type UserEventRow = {
  id: string;
  title: string;
  color: string;
  is_recurring: boolean;
  starts_at: string | null; // ISO — single events only
  ends_at: string | null; // ISO — single events only
  weekdays: number[]; // 0=Sun..6=Sat — recurring only
  start_minute: number | null; // minutes from midnight — recurring only
  end_minute: number | null; // recurring only
  series_start_date: string | null; // YYYY-MM-DD — recurring only
};

// A row from public.user_event_overrides (a per-occurrence exception).
export type OverrideRow = {
  id: string;
  event_id: string;
  occurrence_date: string; // YYYY-MM-DD — the pattern date being overridden
  status: "modified" | "cancelled";
  starts_at: string | null; // ISO — the moved/edited time (modified only)
  ends_at: string | null;
  title: string | null;
  color: string | null;
};

// One concrete thing to draw on the calendar.
export type EventOccurrence = {
  key: string; // stable React key
  eventId: string;
  isRecurring: boolean;
  // The pattern date this occurrence came from (recurring only). This is what a
  // per-instance edit/delete is keyed on — NOT where it was dragged to.
  occurrenceDate: string | null;
  title: string;
  color: string;
  start: Date;
  end: Date;
};

// Local YYYY-MM-DD for a Date (uses the browser's local day, matching the grid).
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// A Date at local midnight for the given day, plus `minutes` into the day.
function dateAtMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

/**
 * Expand every user event into the occurrences that fall inside
 * [rangeStart, rangeEnd) (rangeStart inclusive, rangeEnd exclusive).
 *
 * Rules that make per-instance overrides work, including moves across weeks:
 *  - A recurring pattern date that HAS an override is skipped in the pattern
 *    pass (cancelled → gone; modified → re-added below at its moved time).
 *  - Every "modified" override is placed by its OWN start time, so an occurrence
 *    dragged into another week shows up in that week and disappears from this one.
 */
export function expandOccurrencesForRange(
  events: UserEventRow[],
  overrides: OverrideRow[],
  rangeStart: Date,
  rangeEnd: Date
): EventOccurrence[] {
  const result: EventOccurrence[] = [];
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const overrideByKey = new Map<string, OverrideRow>();
  for (const o of overrides) {
    overrideByKey.set(`${o.event_id}|${o.occurrence_date}`, o);
  }

  // --- Single events + recurring pattern occurrences --------------------------
  for (const ev of events) {
    if (!ev.is_recurring) {
      if (!ev.starts_at) continue;
      const start = new Date(ev.starts_at);
      if (start < rangeStart || start >= rangeEnd) continue;
      const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start);
      result.push({
        key: `single-${ev.id}`,
        eventId: ev.id,
        isRecurring: false,
        occurrenceDate: null,
        title: ev.title,
        color: ev.color,
        start,
        end,
      });
      continue;
    }

    // Recurring: walk each day in the range.
    if (
      ev.start_minute == null ||
      ev.end_minute == null ||
      ev.weekdays.length === 0
    ) {
      continue;
    }
    for (
      let d = startOfDay(rangeStart);
      d < rangeEnd;
      d = addDays(d, 1)
    ) {
      const dateStr = ymd(d);
      if (ev.series_start_date && dateStr < ev.series_start_date) continue;
      if (!ev.weekdays.includes(d.getDay())) continue;
      // Overridden pattern dates are handled in the overrides pass below.
      if (overrideByKey.has(`${ev.id}|${dateStr}`)) continue;

      result.push({
        key: `rec-${ev.id}-${dateStr}`,
        eventId: ev.id,
        isRecurring: true,
        occurrenceDate: dateStr,
        title: ev.title,
        color: ev.color,
        start: dateAtMinutes(d, ev.start_minute),
        end: dateAtMinutes(d, ev.end_minute),
      });
    }
  }

  // --- Modified overrides, placed by their own (moved) start time -------------
  for (const o of overrides) {
    if (o.status !== "modified" || !o.starts_at) continue;
    const start = new Date(o.starts_at);
    if (start < rangeStart || start >= rangeEnd) continue;
    const ev = eventsById.get(o.event_id);
    // Only a still-recurring series has occurrences to override. If the series
    // was edited down to a single event, its old overrides are stale — skip them
    // so no ghost block appears.
    if (!ev || !ev.is_recurring) continue;
    const end = o.ends_at ? new Date(o.ends_at) : new Date(start);
    result.push({
      key: `rec-${o.event_id}-${o.occurrence_date}-override`,
      eventId: o.event_id,
      isRecurring: true,
      occurrenceDate: o.occurrence_date,
      title: o.title ?? ev.title,
      color: o.color ?? ev.color,
      start,
      end,
    });
  }

  return result;
}

// --- tiny date helpers (kept local so this file stays pure/testable) ---------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
