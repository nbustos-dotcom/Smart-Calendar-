import "server-only";
import { parseNextLink } from "./canvas-parse";

// Read-only Canvas API client.
//
// HARD RULE (see CLAUDE.md): this client only ever makes GET requests. There is
// deliberately no post/put/delete helper here, so there is no code path that can
// write back to Canvas.

export type CanvasCredentials = {
  baseUrl: string; // e.g. https://mtu.instructure.com
  token: string; // the user's personal access token (already decrypted)
};

// A friendly error we can show the user verbatim instead of a raw stack trace.
export class CanvasError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

// Trim trailing slashes so we can safely append "/api/v1/...".
export function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

async function canvasGet(
  creds: CanvasCredentials,
  url: string
): Promise<Response> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Accept: "application/json",
    },
    // We always want fresh data from Canvas at sync time.
    cache: "no-store",
  });

  if (res.status === 401) {
    throw new CanvasError(
      "Canvas rejected the token (401). It may be wrong, expired, or revoked.",
      401
    );
  }
  if (!res.ok) {
    throw new CanvasError(
      `Canvas request failed (${res.status}).`,
      res.status
    );
  }
  return res;
}

// Follow Canvas pagination via the Link header until there are no more pages.
// A safety cap stops us from ever looping forever on a misbehaving response.
async function getAllPages<T>(
  creds: CanvasCredentials,
  firstUrl: string,
  maxPages = 50
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;

  while (url && pages < maxPages) {
    const res: Response = await canvasGet(creds, url);
    const page = (await res.json()) as T[];
    if (Array.isArray(page)) {
      results.push(...page);
    }
    url = parseNextLink(res.headers.get("link"));
    pages += 1;
  }
  return results;
}

function apiBase(creds: CanvasCredentials): string {
  return `${normalizeBaseUrl(creds.baseUrl)}/api/v1`;
}

// Fetch the current user. Used to test a token before saving it: if this
// succeeds, the token works.
export async function getSelf(
  creds: CanvasCredentials
): Promise<{ id: number; name: string }> {
  const res = await canvasGet(creds, `${apiBase(creds)}/users/self`);
  const data = (await res.json()) as { id: number; name: string };
  return data;
}

// Active courses for the current user.
export async function getCourses(
  creds: CanvasCredentials
): Promise<unknown[]> {
  const url = `${apiBase(creds)}/courses?enrollment_state=active&per_page=100`;
  return getAllPages<unknown>(creds, url);
}

// Assignments for one course.
export async function getAssignmentsForCourse(
  creds: CanvasCredentials,
  canvasCourseId: number
): Promise<unknown[]> {
  const url =
    `${apiBase(creds)}/courses/${canvasCourseId}/assignments` +
    `?per_page=100&order_by=due_at`;
  return getAllPages<unknown>(creds, url);
}

// Calendar events (class meetings, office hours, etc.) for a set of courses
// within a date window. Canvas limits context_codes to 10 per request, so we
// batch. `start`/`end` are YYYY-MM-DD strings.
export async function getCalendarEvents(
  creds: CanvasCredentials,
  canvasCourseIds: number[],
  start: string,
  end: string
): Promise<unknown[]> {
  const all: unknown[] = [];

  for (let i = 0; i < canvasCourseIds.length; i += 10) {
    const batch = canvasCourseIds.slice(i, i + 10);
    const params = new URLSearchParams({
      type: "event",
      start_date: start,
      end_date: end,
      per_page: "100",
    });
    for (const id of batch) {
      params.append("context_codes[]", `course_${id}`);
    }
    const url = `${apiBase(creds)}/calendar_events?${params.toString()}`;
    const events = await getAllPages<unknown>(creds, url);
    all.push(...events);
  }
  return all;
}
