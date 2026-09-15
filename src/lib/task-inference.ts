// ============================================================================
// TASK INFERENCE — deterministically guess a Canvas assignment's category
//
// Pure, no network/DB, fully unit-testable. Given the Canvas fields we already
// store (submission types, assignment group, title, points), pick a category
// from KNOWN_CATEGORIES. If NOTHING matches confidently, return null — the
// scheduler treats that as "genuinely uncertain" and asks the student once.
//
// No guessing beyond these plain rules, no AI. First match wins; order matters.
// ============================================================================
import { type TaskCategory, type Archetype, SCHEDULER_CONFIG } from "@/lib/scheduler-config";

export type InferenceInput = {
  title: string;
  submissionTypes: string[];
  assignmentGroupName: string | null;
};

// Case-insensitive word/substring test against title + group together.
function matches(text: string, re: RegExp): boolean {
  return re.test(text);
}

// Returns a confident category, or null when the type is genuinely unclear.
export function inferCategory(input: InferenceInput): TaskCategory | null {
  const hay = `${input.title} ${input.assignmentGroupName ?? ""}`.toLowerCase();
  const types = input.submissionTypes.map((t) => t.toLowerCase());

  // Canvas quizzes are unambiguous.
  if (types.includes("online_quiz") || matches(hay, /\bquiz(zes)?\b/)) {
    return "quiz";
  }
  // Reading assignments.
  if (matches(hay, /\bread(ing|ings)?\b|\bchapter\b|\bch\.?\s*\d/)) {
    return "reading";
  }
  // Labs.
  if (matches(hay, /\blab\b|\blaboratory\b/)) {
    return "lab";
  }
  // Projects.
  if (matches(hay, /\bproject\b|\bmilestone\b/)) {
    return "project";
  }
  // Writing-heavy work.
  if (matches(hay, /\bessay\b|\bpaper\b|\breport\b|\bwriting\b|\bjournal\b/)) {
    return "essay";
  }
  // Generic homework / problem sets / discussions, or a plain upload/text-entry.
  if (
    matches(hay, /\bhomework\b|\bhw\b|\bassignment\b|\bproblem set\b|\bpset\b|\bexercise\b|\bdiscussion\b/) ||
    types.includes("online_upload") ||
    types.includes("online_text_entry") ||
    types.includes("discussion_topic")
  ) {
    return "problem_set";
  }

  // Nothing matched with confidence — let the scheduler ask.
  return null;
}

// ============================================================================
// ARCHETYPE INFERENCE (Stage 1) — classify a task into one of three scheduling
// archetypes. Deterministic keyword + signal rules, first-match, no AI.
//   - memorization → exams/tests/quizzes (spaced review)
//   - production   → essays/projects/labs/papers/problem sets (work before due)
//   - completion   → submissions/logs/discussions/step check-ins/trivial quizzes
// `subtype` names the matched bucket (drives duration sizing). `archetype: null`
// means genuinely uncertain → the scheduler asks the student once.
// All keyword lists + thresholds live in scheduler-config.ts.
// ============================================================================

export type ArchetypeInput = {
  title: string;
  submissionTypes: string[];
  assignmentGroupName: string | null;
  pointsPossible: number | null;
};

export type ArchetypeResult = { archetype: Archetype | null; subtype: string | null };

// Word-boundary, case-insensitive test for ANY of the phrases. Returns the first
// phrase (in list order) that matches, or null. Boundaries stop "lab" matching
// "syllabus"; phrases with spaces/hyphens match literally.
function firstKeyword(hay: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(hay)) return kw;
  }
  return null;
}

// Normalize a matched keyword to a duration-table key (spaces → underscores).
function subtypeKey(keyword: string): string {
  return keyword.toLowerCase().replace(/\s+/g, "_");
}

export function inferArchetype(
  input: ArchetypeInput,
  cfg = SCHEDULER_CONFIG
): ArchetypeResult {
  const hay = `${input.title} ${input.assignmentGroupName ?? ""}`.toLowerCase();
  const types = input.submissionTypes.map((t) => t.toLowerCase());
  const points = input.pointsPossible;
  const lowPoints = points != null && points <= cfg.COMPLETION_MAX_POINTS;

  // 1. Production strong keyword FIRST, so "final project" / "lab report" beat
  //    the memorization "final".
  const prod = firstKeyword(hay, cfg.PRODUCTION_KEYWORDS);
  if (prod) return { archetype: "production", subtype: subtypeKey(prod) };

  // 2. Memorization: exam/test/midterm/final always; quiz/online_quiz too — but a
  //    trivial (low-points) quiz with no stronger signal is really completion.
  const memo = firstKeyword(hay, cfg.MEMORIZATION_KEYWORDS);
  const onlineQuiz = types.includes("online_quiz");
  if (memo || onlineQuiz) {
    const quizOnly = !memo || memo === "quiz" || memo === "quizzes";
    if (quizOnly && lowPoints) return { archetype: "completion", subtype: "quiz" };
    const subtype = !memo || memo === "quizzes" ? "quiz" : subtypeKey(memo);
    return { archetype: "memorization", subtype };
  }

  // 3. Completion strong keyword (submission / log / discussion / step / …).
  const comp = firstKeyword(hay, cfg.COMPLETION_KEYWORDS);
  if (comp) return { archetype: "completion", subtype: subtypeKey(comp) };

  // 4. A real-work submission type → produce & hand in.
  if (types.some((t) => cfg.PRODUCTION_SUBMISSION_TYPES.includes(t))) {
    return { archetype: "production", subtype: "default" };
  }

  // 5. Soft points tiebreaker: very low points with no other signal → completion.
  if (lowPoints) return { archetype: "completion", subtype: "low_points" };

  // 6. Readings/chapters (weak signal, only reached after memo & completion) →
  //    production, sized small.
  const reading = firstKeyword(hay, cfg.READING_KEYWORDS);
  if (reading) return { archetype: "production", subtype: "reading" };

  // 7. Generic homework wording → production (safe default for real work).
  const gen = firstKeyword(hay, cfg.GENERIC_PRODUCTION_KEYWORDS);
  if (gen) return { archetype: "production", subtype: "default" };

  // 8. Genuinely ambiguous — ask the student once.
  return { archetype: null, subtype: null };
}
