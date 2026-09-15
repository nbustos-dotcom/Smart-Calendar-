// ============================================================================
// PLAN FINGERPRINT — a cheap, deterministic hash of the scheduler's INPUTS
//
// The planner runs automatically on dashboard load, but only when its inputs
// actually changed since the last run. We fingerprint exactly the inputs the
// spec cares about — Canvas assignments, entered exams, the student's saved
// answers, and study blocks they've MOVED — and compare it to the stored hash.
// Same fingerprint → skip the run (don't waste work, don't disturb blocks).
//
// Deliberately does NOT include ordinary busy time (class/own/Google events):
// per the trigger spec, a new personal event alone doesn't force a reflow.
//
// Pure + order-independent so it's deterministic and unit-testable.
// ============================================================================

export type FingerprintInput = {
  assignments: {
    canvasAssignmentId: number;
    dueAt: string | null;
    submitted: boolean;
    graded: boolean;
    title: string;
    submissionTypes: string[];
    assignmentGroupName: string | null;
  }[];
  exams: {
    id: string;
    examAt: string;
    estPrepMinutes: number | null;
    title: string;
  }[];
  overrides: {
    canvasAssignmentId: number;
    taskCategory: string | null;
    archetype: string | null;
    estMinutes: number | null;
    skip: boolean;
  }[];
  movedBlocks: { id: string; startsAt: string; endsAt: string }[];
};

// Small, fast, deterministic string hash (djb2, xor variant) → hex. No crypto
// dependency; identical strings always hash identically.
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  // >>> 0 keeps it an unsigned 32-bit int.
  return (h >>> 0).toString(16);
}

// Build a canonical, order-independent string of all inputs, then hash it.
export function fingerprintInputs(input: FingerprintInput): string {
  const a = [...input.assignments]
    .sort((x, y) => x.canvasAssignmentId - y.canvasAssignmentId)
    .map((x) =>
      [
        x.canvasAssignmentId,
        x.dueAt ?? "",
        x.submitted ? 1 : 0,
        x.graded ? 1 : 0,
        x.title,
        [...x.submissionTypes].sort().join(","),
        x.assignmentGroupName ?? "",
      ].join("|")
    );

  const e = [...input.exams]
    .sort((x, y) => x.id.localeCompare(y.id))
    .map((x) => [x.id, x.examAt, x.estPrepMinutes ?? "", x.title].join("|"));

  const o = [...input.overrides]
    .sort((x, y) => x.canvasAssignmentId - y.canvasAssignmentId)
    .map((x) =>
      [
        x.canvasAssignmentId,
        x.taskCategory ?? "",
        x.archetype ?? "",
        x.estMinutes ?? "",
        x.skip ? 1 : 0,
      ].join("|")
    );

  const m = [...input.movedBlocks]
    .sort((x, y) => x.id.localeCompare(y.id))
    .map((x) => [x.id, x.startsAt, x.endsAt].join("|"));

  const canonical = ["A", ...a, "E", ...e, "O", ...o, "M", ...m].join("\n");
  return djb2(canonical);
}
