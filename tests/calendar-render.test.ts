import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UserEventRow } from "@/lib/recurrence";

// The calendar imports server actions (which pull in next/headers); we only
// exercise rendering, so stub them out.
vi.mock("@/app/events/actions", () => ({
  createEventAction: async () => ({ ok: true }),
  updateSeriesAction: async () => ({ ok: true }),
  deleteEventAction: async () => ({ ok: true }),
  setSingleEventTimeAction: async () => ({ ok: true }),
  setOccurrenceOverrideAction: async () => ({ ok: true }),
  deleteOccurrenceAction: async () => ({ ok: true }),
}));

import { CalendarView } from "@/components/calendar-view";

// Regression: a user event whose day falls in the currently-shown week must
// actually render on the grid. This once broke because the Monday-first week
// was built by rotating a Sunday-first array, which put the WRONG Sunday last
// and collapsed the week's date range to zero width — so every user event was
// filtered out (on load and after saving).
describe("calendar renders the user's own events", () => {
  function render(userEvents: UserEventRow[]): string {
    return renderToStaticMarkup(
      React.createElement(CalendarView, {
        assignments: [],
        events: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userEvents: userEvents as any,
        overrides: [],
      })
    );
  }

  it("shows a single event that lands in the current week", () => {
    const now = new Date();
    const iso = (h: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0).toISOString();
    const html = render([
      {
        id: "u1",
        title: "Study group",
        color: "blue",
        is_recurring: false,
        starts_at: iso(14),
        ends_at: iso(15),
        weekdays: [],
        start_minute: null,
        end_minute: null,
        series_start_date: null,
      },
    ]);
    expect(html).toContain("Study group");
  });

  it("shows a weekly-recurring event (it repeats through the current week)", () => {
    const html = render([
      {
        id: "u2",
        title: "Morning gym",
        color: "green",
        is_recurring: true,
        starts_at: null,
        ends_at: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6], // every day, so any week has it
        start_minute: 540,
        end_minute: 600,
        series_start_date: null,
      },
    ]);
    expect(html).toContain("Morning gym");
  });
});
