// ============================================================================
// SHARED TYPES — the data shapes the calendar UI works with
// ============================================================================

// Plain shapes the calendar UI works with. These mirror what we store, trimmed
// to what the screen actually needs.

export type AssignmentItem = {
  id: string;
  canvas_assignment_id: number;
  title: string;
  due_at: string | null;
  points_possible: number | null;
  submission_types: string[];
  html_url: string | null;
  course_name: string | null;
  submitted: boolean; // Canvas: the user has submitted this assignment
  graded: boolean; // Canvas: this assignment has been graded (score not shown)
};

// A student-entered exam (spacing-driven). Rendered as a read-only marker.
export type ExamItem = {
  id: string;
  title: string;
  course_name: string | null;
  exam_at: string; // ISO
  est_prep_minutes: number | null;
};

// A scheduler-produced study block, as the calendar needs it. Read-mostly:
// the only edit is dragging it to a new time (accepted silently).
export type StudyBlockItem = {
  id: string;
  source_kind: "assignment" | "exam";
  canvas_assignment_id: number | null;
  exam_id: string | null;
  title: string;
  starts_at: string; // ISO
  ends_at: string; // ISO
  state: "scheduled" | "reserved" | "needs_input";
  reason: string | null;
  moved_by_user: boolean;
};

export type ClassEventItem = {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  html_url: string | null;
  course_name: string | null;
  // Where the event came from. Canvas class events omit this (treated as
  // "canvas"); Google Calendar events set "google" so the UI can mark them as
  // read-only-from-Google. Both are equally non-interactive in this app.
  source?: "canvas" | "google";
  // Google-only extras (used by the read-only Google detail view + colouring).
  // Canvas events leave these unset.
  description?: string | null; // event description / notes
  meeting_url?: string | null; // e.g. a Google Meet link (hangoutLink)
  google_color?: string | null; // resolved hex for the event's colorId
};
