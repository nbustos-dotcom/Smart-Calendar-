import { describe, it, expect } from "vitest";
import { inferCategory, inferArchetype } from "@/lib/task-inference";

const base = { submissionTypes: [] as string[], assignmentGroupName: null };
const abase = { submissionTypes: [] as string[], assignmentGroupName: null, pointsPossible: null };

describe("inferCategory", () => {
  it("detects a Canvas quiz from submission type or title", () => {
    expect(inferCategory({ ...base, title: "Chapter 3", submissionTypes: ["online_quiz"] })).toBe("quiz");
    expect(inferCategory({ ...base, title: "Quiz 4" })).toBe("quiz");
  });

  it("detects reading", () => {
    expect(inferCategory({ ...base, title: "Reading: chapter 5" })).toBe("reading");
    expect(inferCategory({ ...base, title: "Ch. 2 notes" })).toBe("reading");
  });

  it("detects labs, projects, and essays", () => {
    expect(inferCategory({ ...base, title: "Lab 6 writeup" })).toBe("lab");
    expect(inferCategory({ ...base, title: "Final Project milestone" })).toBe("project");
    expect(inferCategory({ ...base, title: "Argument essay" })).toBe("essay");
    expect(inferCategory({ ...base, title: "Reflection paper" })).toBe("essay");
  });

  it("uses the assignment group when the title is generic", () => {
    expect(
      inferCategory({ ...base, title: "Week 3", assignmentGroupName: "Homework" })
    ).toBe("problem_set");
  });

  it("treats a plain upload/text-entry as generic homework", () => {
    expect(inferCategory({ ...base, title: "Week 3", submissionTypes: ["online_upload"] })).toBe(
      "problem_set"
    );
  });

  it("returns null when the type is genuinely uncertain", () => {
    expect(inferCategory({ ...base, title: "Week 3", submissionTypes: ["none"] })).toBeNull();
    expect(inferCategory({ ...base, title: "TBD" })).toBeNull();
  });
});

describe("inferArchetype (Stage 1)", () => {
  it("classifies a Canvas exam as memorization (the motivating bug)", () => {
    expect(inferArchetype({ ...abase, title: "Binary Numbers Exam", pointsPossible: 100 }).archetype).toBe(
      "memorization"
    );
    expect(inferArchetype({ ...abase, title: "Midterm 2" }).archetype).toBe("memorization");
    expect(inferArchetype({ ...abase, title: "Vocab", submissionTypes: ["online_quiz"] }).archetype).toBe(
      "memorization"
    );
  });

  it("classifies a final PROJECT as production, not memorization", () => {
    // Production keyword ("project") is checked before the memorization "final".
    const r = inferArchetype({ ...abase, title: "Final Project", pointsPossible: 200 });
    expect(r.archetype).toBe("production");
    expect(r.subtype).toBe("project");
  });

  it("classifies a step submission as completion (the tiny-task bug)", () => {
    expect(inferArchetype({ ...abase, title: "Week 13 Step Submission" }).archetype).toBe("completion");
    expect(inferArchetype({ ...abase, title: "Reading Reflection" }).archetype).toBe("completion");
    expect(
      inferArchetype({ ...abase, title: "Intro", assignmentGroupName: "Discussion" }).archetype
    ).toBe("completion");
  });

  it("demotes a trivial (low-points) quiz to completion, but not a real exam", () => {
    expect(
      inferArchetype({ ...abase, title: "Daily Quiz", submissionTypes: ["online_quiz"], pointsPossible: 5 })
        .archetype
    ).toBe("completion");
    // A low-point EXAM still stays memorization (exam is a strong signal).
    expect(inferArchetype({ ...abase, title: "Exam 1", pointsPossible: 5 }).archetype).toBe("memorization");
  });

  it("classifies real production work (essay/paper/lab), and folds reading into production", () => {
    expect(inferArchetype({ ...abase, title: "Argument Essay" }).subtype).toBe("essay");
    expect(inferArchetype({ ...abase, title: "Lab 6 writeup" }).archetype).toBe("production");
    expect(inferArchetype({ ...abase, title: "Reading: Chapter 5" }).archetype).toBe("production");
    // Upload work with a generic title is production.
    expect(
      inferArchetype({ ...abase, title: "Week 3", submissionTypes: ["online_upload"] }).archetype
    ).toBe("production");
  });

  it("uses points only as a soft tiebreaker (never overrides a strong keyword)", () => {
    // Very low points with NO other signal → completion.
    expect(inferArchetype({ ...abase, title: "Week 3 thing", pointsPossible: 2 }).archetype).toBe(
      "completion"
    );
    // But a project stays production even at low points.
    expect(inferArchetype({ ...abase, title: "Group Project", pointsPossible: 2 }).archetype).toBe(
      "production"
    );
  });

  it("returns null (needs-input) when genuinely ambiguous", () => {
    expect(inferArchetype({ ...abase, title: "TBD" }).archetype).toBeNull();
  });
});
