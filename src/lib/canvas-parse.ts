// ============================================================================
// CANVAS PARSING HELPERS — turn raw Canvas JSON into our tidy row shapes
//
// Pure functions (no network, no database), which makes them easy to unit-test
// (see tests/canvas-parse.test.ts). They never invent data: a missing due date
// stays null rather than being guessed.
// ============================================================================

// Pure helpers for reading Canvas API responses.
//
// These have NO network and NO database code, on purpose: they are the parts
// most likely to have subtle bugs (pagination, missing fields), so we keep them
// pure and cover them with unit tests (see tests/canvas-parse.test.ts).

// --- Pagination ---------------------------------------------------------------
//
// Canvas splits long lists across pages and tells you the URL of the next page
// in the HTTP `Link` header, e.g.:
//   <https://.../assignments?page=2>; rel="next", <https://.../?page=1>; rel="first"
// We follow rel="next" until there isn't one. This function pulls the "next"
// URL out of a Link header, or returns null when we're on the last page.
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") {
      return match[1];
    }
  }
  return null;
}

// --- Row mappers --------------------------------------------------------------
//
// Turn raw Canvas JSON objects into the plain shapes we store. We only keep the
// fields we actually use, and we never invent a value that Canvas didn't send:
// a missing due date stays null.

export type CourseRow = {
  canvas_course_id: number;
  name: string;
};

export function mapCourse(raw: unknown): CourseRow | null {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== "number") return null;

  // Canvas can return "restricted" courses with no name/access. Skip those
  // rather than storing a blank row.
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!name) return null;

  return { canvas_course_id: id, name };
}

export type AssignmentRow = {
  canvas_assignment_id: number;
  canvas_course_id: number;
  title: string;
  due_at: string | null;
  unlock_at: string | null;
  lock_at: string | null;
  points_possible: number | null;
  submission_types: string[];
  assignment_group_id: number | null;
  html_url: string | null;
};

export function mapAssignment(raw: unknown): AssignmentRow | null {
  if (!isObject(raw)) return null;
  const id = raw.id;
  const courseId = raw.course_id;
  if (typeof id !== "number" || typeof courseId !== "number") return null;

  return {
    canvas_assignment_id: id,
    canvas_course_id: courseId,
    title: typeof raw.name === "string" ? raw.name : "(untitled)",
    due_at: asIsoOrNull(raw.due_at),
    unlock_at: asIsoOrNull(raw.unlock_at),
    lock_at: asIsoOrNull(raw.lock_at),
    points_possible:
      typeof raw.points_possible === "number" ? raw.points_possible : null,
    submission_types: Array.isArray(raw.submission_types)
      ? raw.submission_types.filter((s): s is string => typeof s === "string")
      : [],
    assignment_group_id:
      typeof raw.assignment_group_id === "number"
        ? raw.assignment_group_id
        : null,
    html_url: typeof raw.html_url === "string" ? raw.html_url : null,
  };
}

export type ClassEventRow = {
  canvas_event_id: string;
  canvas_course_id: number | null;
  title: string;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  html_url: string | null;
};

// Canvas calendar events carry a "context_code" like "course_1234". We pull the
// numeric course id out of it when present.
export function courseIdFromContextCode(code: unknown): number | null {
  if (typeof code !== "string") return null;
  const match = code.match(/^course_(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function mapClassEvent(raw: unknown): ClassEventRow | null {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== "number" && typeof id !== "string") return null;

  return {
    canvas_event_id: String(id),
    canvas_course_id: courseIdFromContextCode(raw.context_code),
    title: typeof raw.title === "string" ? raw.title : "(untitled event)",
    start_at: asIsoOrNull(raw.start_at),
    end_at: asIsoOrNull(raw.end_at),
    location_name:
      typeof raw.location_name === "string" && raw.location_name.length > 0
        ? raw.location_name
        : null,
    html_url: typeof raw.html_url === "string" ? raw.html_url : null,
  };
}

// --- small internal utilities -------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Canvas sends timestamps as ISO strings (or null). We pass valid strings
// through untouched and turn anything else into null — never a guessed date.
function asIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}
