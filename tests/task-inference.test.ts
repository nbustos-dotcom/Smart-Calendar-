import { describe, it, expect } from "vitest";
import { inferCategory } from "@/lib/task-inference";

const base = { submissionTypes: [] as string[], assignmentGroupName: null };

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
