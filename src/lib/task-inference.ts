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
import { type TaskCategory } from "@/lib/scheduler-config";

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
