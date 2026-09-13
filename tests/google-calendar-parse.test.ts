import { describe, it, expect } from "vitest";
import { mapGoogleEvent } from "@/lib/google-calendar-parse";

describe("mapGoogleEvent", () => {
  it("maps a normal timed event", () => {
    const row = mapGoogleEvent({
      id: "abc123",
      status: "confirmed",
      summary: "Dentist",
      location: "Main St Clinic",
      htmlLink: "https://calendar.google.com/event?eid=abc123",
      start: { dateTime: "2026-09-10T14:00:00Z" },
      end: { dateTime: "2026-09-10T15:00:00Z" },
    });
    expect(row).toEqual({
      id: "google:abc123",
      title: "Dentist",
      start_at: new Date("2026-09-10T14:00:00Z").toISOString(),
      end_at: new Date("2026-09-10T15:00:00Z").toISOString(),
      location_name: "Main St Clinic",
      html_url: "https://calendar.google.com/event?eid=abc123",
      course_name: null,
      source: "google",
    });
  });

  it("maps an all-day event (date) to local midnight so it reads as all-day", () => {
    const row = mapGoogleEvent({
      id: "d1",
      summary: "Holiday",
      start: { date: "2026-09-10" },
      end: { date: "2026-09-11" },
    });
    // Local midnight of the start date → minutes-of-day is 0 (all-day).
    const midnight = new Date(2026, 8, 10);
    expect(row?.start_at).toBe(midnight.toISOString());
    expect(new Date(row!.start_at!).getHours()).toBe(0);
    expect(new Date(row!.start_at!).getMinutes()).toBe(0);
  });

  it("namespaces the id so it can't collide with Canvas/user ids", () => {
    expect(mapGoogleEvent({ id: "x", start: { dateTime: "2026-09-10T14:00:00Z" } })?.id).toBe(
      "google:x"
    );
  });

  it("falls back to a placeholder title when summary is missing", () => {
    const row = mapGoogleEvent({
      id: "x",
      start: { dateTime: "2026-09-10T14:00:00Z" },
    });
    expect(row?.title).toBe("(busy)");
  });

  it("drops cancelled events", () => {
    expect(
      mapGoogleEvent({
        id: "x",
        status: "cancelled",
        start: { dateTime: "2026-09-10T14:00:00Z" },
      })
    ).toBeNull();
  });

  it("drops events with no id and events with no start", () => {
    expect(mapGoogleEvent({ start: { dateTime: "2026-09-10T14:00:00Z" } })).toBeNull();
    expect(mapGoogleEvent({ id: "x" })).toBeNull();
  });

  it("never invents an end time", () => {
    const row = mapGoogleEvent({
      id: "x",
      summary: "Open-ended",
      start: { dateTime: "2026-09-10T14:00:00Z" },
    });
    expect(row?.end_at).toBeNull();
  });
});
