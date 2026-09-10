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

export type ClassEventItem = {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  html_url: string | null;
  course_name: string | null;
};
