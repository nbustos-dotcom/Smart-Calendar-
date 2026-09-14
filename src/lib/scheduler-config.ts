// ============================================================================
// SCHEDULER CONFIG — every tunable knob for the deterministic study scheduler
//
// ONE place for all the numbers the scheduler uses, so they're easy to adjust
// later instead of being scattered as magic numbers. These are v1 fixed defaults
// (confirmed sensible); the self-correcting learning loop that will eventually
// tune some of them is a LATER phase and is deliberately not built yet.
//
// Deterministic: same inputs + same config → same plan. No AI, no randomness.
// ============================================================================

export const SCHEDULER_CONFIG = {
  // Daily window that blocks may be placed in (local clock hours). Never overnight.
  DAY_WINDOW_START_HOUR: 8, // 08:00
  DAY_WINDOW_END_HOUR: 22, // 22:00

  // How far ahead we plan. We plan HORIZON_DAYS out, extended to reach the
  // furthest deadline, but never beyond HORIZON_CAP_DAYS.
  HORIZON_DAYS: 28,
  HORIZON_CAP_DAYS: 60,

  // Focus chunking: split long work into sessions no longer than the cap, and
  // never place a session shorter than the minimum.
  CHUNK_CAP_MINUTES: 90,
  MIN_CHUNK_MINUTES: 30,

  // Planning-fallacy buffer. Applied to the STUDENT'S OWN raw estimate only
  // (category defaults below are already padded, so they're used as-is). The
  // self-correcting version of this is a later phase.
  ESTIMATE_BUFFER: 1.4,

  // Exam spacing effect: gap between study sessions ≈ this fraction of the
  // days-until-test. See DESIGN.md §7 — this is a deliberate v1 APPROXIMATION of
  // the spacing-effect research (the literature's "retention interval" is longer
  // than days-until-test), to be revisited, not a literal model of the science.
  SPACING_FRACTION: 0.2,

  // Fixed per-category default TOTAL work minutes. Used as-is (already padded).
  // The duration ladder falls back to these when the student gave no estimate.
  CATEGORY_DEFAULT_MINUTES: {
    reading: 60,
    quiz: 60,
    problem_set: 120,
    lab: 120,
    essay: 180,
    project: 240,
  } as Record<string, number>,

  // Default total prep for an exam when the student gave no estimate.
  EXAM_DEFAULT_PREP_MINUTES: 180,

  // Length of the small placeholder we hold for a needs-input / no-fit item so
  // it's visible and clickable on the calendar.
  PLACEHOLDER_MINUTES: 30,
} as const;

// The categories the inference step can assign to a Canvas assignment. `null`
// means "genuinely uncertain" → the scheduler asks the student once.
export const KNOWN_CATEGORIES = [
  "reading",
  "quiz",
  "problem_set",
  "lab",
  "essay",
  "project",
] as const;
export type TaskCategory = (typeof KNOWN_CATEGORIES)[number];
