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

  // Transition buffer around FIXED COMMITMENTS (classes, Google/class events, the
  // student's own events) — walk/settle time. Treated as busy on BOTH sides of a
  // commitment when computing free time, so no study block is placed within this
  // many minutes before or after one. NOT applied around moved study blocks.
  CLASS_BUFFER_MINUTES: 20,

  // Planning-fallacy buffer. Applied to the STUDENT'S OWN raw estimate only
  // (category defaults below are already padded, so they're used as-is). The
  // self-correcting version of this is a later phase.
  ESTIMATE_BUFFER: 1.4,

  // Exam spacing effect: gap between study sessions ≈ this fraction of the
  // days-until-test. See DESIGN.md §7 — this is a deliberate v1 APPROXIMATION of
  // the spacing-effect research (the literature's "retention interval" is longer
  // than days-until-test), to be revisited, not a literal model of the science.
  SPACING_FRACTION: 0.2,

  // "Don't start too early" — assignment START-OFFSET ladder. WHY: without this,
  // the engine placed every future assignment's work into the next free days,
  // flooding today/tomorrow with weeks of work. Each assignment is only placed
  // inside a lead window [due − leadDays, due]; bigger tasks earn a longer lead.
  // Matched top-down against the task's total (already-buffered) minutes; first
  // tier whose maxMinutes covers the total wins. Tunable knob.
  // These are how far back the SMOOTHING WINDOW may reach — NOT where work
  // starts. A task's ideal is the deadline day, so a lone task still lands near
  // its due date; the window only needs to be wide enough that a CLUSTER of work
  // can fan back onto earlier days when the near-deadline days fill up (Stage B
  // fix: "spread heavy clusters earlier / anti-cramming"). Hence generous leads.
  LEAD_DAYS: [
    { maxMinutes: 60, leadDays: 7 }, // tiny (≤1h): up to a week of room to fan back
    { maxMinutes: 120, leadDays: 10 }, // small (≤2h)
    { maxMinutes: 240, leadDays: 14 }, // medium (≤4h): ~2 weeks
    { maxMinutes: 480, leadDays: 21 }, // large (≤8h): ~3 weeks
    { maxMinutes: Number.POSITIVE_INFINITY, leadDays: 28 }, // huge: ~4 weeks
  ] as { maxMinutes: number; leadDays: number }[],

  // Honesty backstop (LEGACY — superseded in Stage B by per-day capacities in
  // AVAILABILITY_DEFAULTS / student_preferences; kept only for back-compat).
  MAX_STUDY_MINUTES_PER_DAY: 180, // 3 hours/day

  // ==========================================================================
  // AVAILABILITY & PLACEMENT (Stage B) — the "reasonable hours" model + the
  // scoring weights for the unified placement engine. These are the DEFAULTS
  // used when a student has no `student_preferences` row yet.
  // ==========================================================================

  // Per-day work windows (minute-of-day) and daily study capacity, weekday vs
  // weekend. Weekends start later and never touch early morning — this is what
  // stops the old "8am Saturday stacking". Never overnight: windows sit inside a
  // single day. Mirror the student_preferences column defaults (migration 0011).
  AVAILABILITY_DEFAULTS: {
    weekdayStartMinute: 540, // 09:00
    weekdayEndMinute: 1320, // 22:00
    weekendStartMinute: 600, // 10:00
    weekendEndMinute: 1200, // 20:00
    maxWeekdayMinutes: 180, // daily study cap (weekday)
    maxWeekendMinutes: 240, // daily study cap (weekend)
  },

  // Time-of-day QUALITY: how good each part of the day is for studying. WIDE and
  // GENTLE (Stage B fix) — a broad afternoon plateau with usable morning and
  // evening shoulders, instead of one narrow prime band, so blocks vary across
  // the day instead of funneling into 15:00–21:00. The availability WINDOW (not
  // this curve) enforces reasonable hours: nothing before 09:00 weekday / 10:00
  // weekend, nothing after 22:00, never overnight — quality only ranks WITHIN it.
  // First band covering a minute-of-day wins; bands span the full clock.
  QUALITY_BANDS: [
    { startMin: 0, endMin: 540, weight: 0.15 }, // before 09:00 — mostly outside windows
    { startMin: 540, endMin: 660, weight: 0.55 }, // 09:00–11:00 — usable morning
    { startMin: 660, endMin: 840, weight: 0.8 }, // 11:00–14:00 — good
    { startMin: 840, endMin: 1140, weight: 1.0 }, // 14:00–19:00 — prime (broad)
    { startMin: 1140, endMin: 1320, weight: 0.7 }, // 19:00–22:00 — usable evening
    { startMin: 1320, endMin: 1440, weight: 0.15 }, // after 22:00 — winding down
  ] as { startMin: number; endMin: number; weight: number }[],

  // Scoring weights for choosing a DAY for each session:
  //   score = SPREAD·(−|day − idealDay|) + LEVEL·(remaining/capacity) + QUALITY·q
  // LEVEL is the CROSS-TASK spreading pressure: it reads the shared day-load
  // ledger, so days already populated by EARLIER tasks become less attractive to
  // later ones — a real spreading force, not just the capacity hard-stop. It is
  // weighted to out-pull SPREAD once a day is partly full, so a cluster of
  // same-deadline work fans across days (and earlier) instead of piling on one.
  // SPREAD still orders empty days by nearness to the ideal (deadline) day, so a
  // lone task lands near its due date. QUALITY nudges toward good hours. Within a
  // day, the best-quality free slot is chosen.
  PLACEMENT: {
    GRANULARITY_MINUTES: 30, // candidate-start step when scanning a day
    WEIGHT_SPREAD: 2,
    WEIGHT_LEVEL: 3,
    WEIGHT_QUALITY: 1,
  },

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

  // ==========================================================================
  // ARCHETYPES (Stage 1 of the scheduler rewrite)
  //
  // Every task classifies into one of three SCHEDULING ARCHETYPES, each placed
  // differently. This replaces the old coarse "everything is a problem_set"
  // funnel. Classification is deterministic keyword/signal matching (see
  // src/lib/task-inference.ts); all the words + numbers it uses live here.
  // ==========================================================================

  // Keyword lists for classification. Matched case-insensitively against the
  // title + assignment-group text. Order of the RULES (not these lists) resolves
  // overlaps like "final project" — see inferArchetype. Word-ish boundaries are
  // applied by the matcher so "lab" doesn't match "syllabus".
  PRODUCTION_KEYWORDS: [
    "project", "paper", "essay", "report", "lab", "thesis", "portfolio",
    "presentation", "milestone", "draft", "problem set", "pset",
  ] as string[],
  // Readings fold into production, but only as a WEAK signal checked AFTER
  // memorization/completion — so "Reading Quiz" is memorization and "Reading
  // Reflection" is completion, while a plain "Reading: Chapter 5" is production.
  READING_KEYWORDS: ["reading", "chapter"] as string[],
  MEMORIZATION_KEYWORDS: ["exam", "test", "midterm", "final", "quiz", "quizzes"] as string[],
  COMPLETION_KEYWORDS: [
    "submission", "submit", "log", "reflection", "discussion", "step",
    "attendance", "check in", "check-in", "checkin", "survey", "peer review",
    "participation", "warm up", "warm-up", "warmup", "response", "journal entry",
  ] as string[],
  // Generic homework wording — a weak, last-resort production signal.
  GENERIC_PRODUCTION_KEYWORDS: ["homework", "assignment", "hw", "exercise"] as string[],
  // Canvas submission types that indicate real work to produce and hand in.
  PRODUCTION_SUBMISSION_TYPES: ["online_upload", "online_text_entry", "media_recording"] as string[],

  // Planning-fallacy buffer applied to the STUDENT'S OWN estimate, per archetype.
  // Structured per-archetype so the Stage 4 learning loop can self-correct each
  // independently later; NOT learned yet (fixed values for now).
  ESTIMATE_BUFFER_BY_ARCHETYPE: {
    memorization: 1.4,
    production: 1.5,
    completion: 1.1,
  } as Record<string, number>,

  // COMPLETION: one small block, never chunked. Points at or below this nudge an
  // otherwise-ambiguous item toward completion (soft tiebreaker).
  COMPLETION_DEFAULT_MINUTES: 15,
  COMPLETION_MAX_POINTS: 10,

  // PRODUCTION: per-subtype base minutes (already padded), gently scaled by the
  // points signal when present (soft — point scales vary across courses).
  PRODUCTION_BASE_MINUTES: {
    essay: 180, paper: 180, project: 480, portfolio: 480, presentation: 180,
    report: 150, lab: 120, problem_set: 120, pset: 120, draft: 120,
    reading: 60, chapter: 60, // readings/chapters are production, sized small
    default: 120,
  } as Record<string, number>,
  // First tier whose maxPoints covers points_possible wins; multiplies the base.
  POINTS_SIZE_MULTIPLIER: [
    { maxPoints: 9, multiplier: 0.6 },
    { maxPoints: 49, multiplier: 1.0 },
    { maxPoints: 99, multiplier: 1.3 },
    { maxPoints: Number.POSITIVE_INFINITY, multiplier: 1.6 },
  ] as { maxPoints: number; multiplier: number }[],
  PRODUCTION_MIN_MINUTES: 30,
  PRODUCTION_MAX_MINUTES: 480,

  // MEMORIZATION: total prep minutes by subtype (points soft-adjust these too).
  MEMORIZATION_BASE_MINUTES: {
    quiz: 45, test: 120, midterm: 180, exam: 360, final: 360, default: 180,
  } as Record<string, number>,

  // Spaced-repetition schedules, RECORDED in Stage 1 and PLACED precisely in
  // Stage 2. Each value lists how many days BEFORE the date to review. Selection
  // by distance: short retention (soon) → tight gaps, long retention → wider
  // gaps (Cepeda et al.). Stage 1 placement still uses the existing placeExam
  // approximation (SPACING_FRACTION) so the app keeps working.
  SPACING_SCHEDULES: {
    "2-3-5-7": [7, 5, 3, 2],
    "1-3-7-21": [21, 7, 3, 1],
  } as Record<string, number[]>,
  SPACING_SCHEDULE_LONG_THRESHOLD_DAYS: 14,
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

// The three scheduling archetypes (Stage 1). `null` from inference means
// "genuinely uncertain" → the scheduler asks the student once and stores the
// answer (assignment_overrides.archetype), so it never re-asks.
export const ARCHETYPES = ["memorization", "production", "completion"] as const;
export type Archetype = (typeof ARCHETYPES)[number];
