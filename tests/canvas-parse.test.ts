import { describe, it, expect } from "vitest";
import {
  parseNextLink,
  mapCourse,
  mapAssignment,
  mapClassEvent,
  courseIdFromContextCode,
} from "@/lib/canvas-parse";

describe("parseNextLink", () => {
  it("returns the URL marked rel=next", () => {
    const header =
      '<https://mtu.instructure.com/api/v1/courses?page=2>; rel="next", ' +
      '<https://mtu.instructure.com/api/v1/courses?page=1>; rel="first"';
    expect(parseNextLink(header)).toBe(
      "https://mtu.instructure.com/api/v1/courses?page=2"
    );
  });

  it("returns null when there is no next page", () => {
    const header =
      '<https://mtu.instructure.com/api/v1/courses?page=1>; rel="current"';
    expect(parseNextLink(header)).toBeNull();
  });

  it("returns null for a missing header", () => {
    expect(parseNextLink(null)).toBeNull();
  });
});

describe("mapCourse", () => {
  it("keeps id and name", () => {
    expect(mapCourse({ id: 101, name: "Calculus" })).toEqual({
      canvas_course_id: 101,
      name: "Calculus",
    });
  });

  it("skips courses with no name (e.g. restricted access)", () => {
    expect(mapCourse({ id: 101 })).toBeNull();
    expect(mapCourse({ name: "no id" })).toBeNull();
  });
});

describe("mapAssignment", () => {
  it("maps all the fields we store", () => {
    const raw = {
      id: 5,
      course_id: 101,
      name: "Homework 1",
      due_at: "2026-09-10T23:59:00Z",
      unlock_at: "2026-09-01T00:00:00Z",
      lock_at: "2026-09-11T00:00:00Z",
      points_possible: 45,
      submission_types: ["online_upload"],
      assignment_group_id: 9,
      html_url: "https://mtu.instructure.com/courses/101/assignments/5",
    };
    expect(mapAssignment(raw)).toEqual({
      canvas_assignment_id: 5,
      canvas_course_id: 101,
      title: "Homework 1",
      due_at: "2026-09-10T23:59:00Z",
      unlock_at: "2026-09-01T00:00:00Z",
      lock_at: "2026-09-11T00:00:00Z",
      points_possible: 45,
      submission_types: ["online_upload"],
      assignment_group_id: 9,
      html_url: "https://mtu.instructure.com/courses/101/assignments/5",
    });
  });

  it("keeps a missing due date as null — never guesses one", () => {
    const row = mapAssignment({ id: 5, course_id: 101, name: "No due date" });
    expect(row?.due_at).toBeNull();
    expect(row?.points_possible).toBeNull();
    expect(row?.submission_types).toEqual([]);
  });

  it("turns an invalid due date string into null", () => {
    const row = mapAssignment({
      id: 5,
      course_id: 101,
      name: "Bad date",
      due_at: "not-a-date",
    });
    expect(row?.due_at).toBeNull();
  });
});

describe("courseIdFromContextCode", () => {
  it("extracts the numeric course id", () => {
    expect(courseIdFromContextCode("course_1234")).toBe(1234);
  });
  it("returns null for other context codes", () => {
    expect(courseIdFromContextCode("user_7")).toBeNull();
    expect(courseIdFromContextCode(undefined)).toBeNull();
  });
});

describe("mapClassEvent", () => {
  it("maps an event and links it to its course", () => {
    const raw = {
      id: 900,
      title: "Lecture",
      context_code: "course_101",
      start_at: "2026-09-08T14:00:00Z",
      end_at: "2026-09-08T15:00:00Z",
      location_name: "Fisher 135",
      html_url: "https://mtu.instructure.com/calendar",
    };
    expect(mapClassEvent(raw)).toEqual({
      canvas_event_id: "900",
      canvas_course_id: 101,
      title: "Lecture",
      start_at: "2026-09-08T14:00:00Z",
      end_at: "2026-09-08T15:00:00Z",
      location_name: "Fisher 135",
      html_url: "https://mtu.instructure.com/calendar",
    });
  });

  it("handles a missing location and times without inventing values", () => {
    const row = mapClassEvent({ id: 900, title: "TBD", context_code: "x" });
    expect(row?.location_name).toBeNull();
    expect(row?.start_at).toBeNull();
    expect(row?.canvas_course_id).toBeNull();
  });
});
