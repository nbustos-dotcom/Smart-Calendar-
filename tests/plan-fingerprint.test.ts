import { describe, it, expect } from "vitest";
import { fingerprintInputs, type FingerprintInput } from "@/lib/plan-fingerprint";

const baseInput = (): FingerprintInput => ({
  assignments: [
    {
      canvasAssignmentId: 2,
      dueAt: "2026-09-10T23:59:00Z",
      submitted: false,
      graded: false,
      title: "HW 2",
      submissionTypes: ["online_upload"],
      assignmentGroupName: "Homework",
    },
    {
      canvasAssignmentId: 1,
      dueAt: "2026-09-08T23:59:00Z",
      submitted: false,
      graded: false,
      title: "HW 1",
      submissionTypes: ["online_quiz"],
      assignmentGroupName: "Quizzes",
    },
  ],
  exams: [{ id: "e1", examAt: "2026-09-20T10:00:00Z", estPrepMinutes: null, title: "Midterm" }],
  overrides: [
    { canvasAssignmentId: 1, taskCategory: "quiz", archetype: "memorization", estMinutes: null, skip: false },
  ],
  movedBlocks: [{ id: "b1", startsAt: "2026-09-07T18:00:00Z", endsAt: "2026-09-07T19:00:00Z" }],
});

describe("fingerprintInputs", () => {
  it("is order-independent (same inputs in any order → same hash)", () => {
    const a = fingerprintInputs(baseInput());
    const shuffled = baseInput();
    shuffled.assignments.reverse();
    expect(fingerprintInputs(shuffled)).toBe(a);
  });

  it("changes when a Canvas assignment changes (new due date / submitted)", () => {
    const a = fingerprintInputs(baseInput());
    const edited = baseInput();
    edited.assignments[0].dueAt = "2026-09-11T23:59:00Z";
    expect(fingerprintInputs(edited)).not.toBe(a);

    const submitted = baseInput();
    submitted.assignments[0].submitted = true;
    expect(fingerprintInputs(submitted)).not.toBe(a);
  });

  it("changes when an exam is added or edited", () => {
    const a = fingerprintInputs(baseInput());
    const added = baseInput();
    added.exams.push({ id: "e2", examAt: "2026-09-25T10:00:00Z", estPrepMinutes: 300, title: "Final" });
    expect(fingerprintInputs(added)).not.toBe(a);
  });

  it("changes when a study block is moved", () => {
    const a = fingerprintInputs(baseInput());
    const moved = baseInput();
    moved.movedBlocks[0].startsAt = "2026-09-07T20:00:00Z";
    expect(fingerprintInputs(moved)).not.toBe(a);
  });

  it("changes when the student answers a needs-input question (override)", () => {
    const a = fingerprintInputs(baseInput());
    const answered = baseInput();
    answered.overrides.push({
      canvasAssignmentId: 2,
      taskCategory: "essay",
      archetype: "production",
      estMinutes: 120,
      skip: false,
    });
    expect(fingerprintInputs(answered)).not.toBe(a);
  });

  it("changes when the student's archetype answer changes", () => {
    const a = fingerprintInputs(baseInput());
    const changed = baseInput();
    changed.overrides[0].archetype = "completion";
    expect(fingerprintInputs(changed)).not.toBe(a);
  });

  it("is stable when nothing relevant changed", () => {
    expect(fingerprintInputs(baseInput())).toBe(fingerprintInputs(baseInput()));
  });
});
