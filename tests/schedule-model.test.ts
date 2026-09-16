import { describe, it, expect } from "vitest";
import {
  buildAssignmentTasks,
  buildExamTasks,
  buildCommitments,
  commitmentsToBusy,
  taskToPlannable,
  movedBlocksToLocked,
  type RawAssignment,
  type RawExam,
  type RawMovedBlock,
  type RawOverride,
} from "@/lib/schedule-model";

const now = new Date(2026, 0, 5, 8, 0, 0, 0); // Mon Jan 5, 08:00
const iso = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo, d, h, mi, 0, 0).toISOString();

const assignment = (over: Partial<RawAssignment>): RawAssignment => ({
  canvas_assignment_id: 1,
  title: "Thing",
  due_at: iso(2026, 0, 15, 23, 59),
  points_possible: 40,
  submission_types: [],
  assignment_group_name: null,
  submitted: false,
  graded: false,
  ...over,
});

describe("buildAssignmentTasks", () => {
  it("skips assignments that aren't schedulable (no due / past / submitted / graded / opted-out)", () => {
    const overrides = new Map<number, RawOverride>([
      [5, { canvas_assignment_id: 5, task_category: null, archetype: null, est_minutes: null, skip: true }],
    ]);
    const rows = [
      assignment({ canvas_assignment_id: 1, due_at: null }),
      assignment({ canvas_assignment_id: 2, due_at: iso(2026, 0, 1) }), // past
      assignment({ canvas_assignment_id: 3, submitted: true }),
      assignment({ canvas_assignment_id: 4, graded: true }),
      assignment({ canvas_assignment_id: 5 }), // skip override
    ];
    expect(buildAssignmentTasks(rows, overrides, now)).toHaveLength(0);
  });

  it("classifies + sizes a production essay and records estimate provenance", () => {
    const t = buildAssignmentTasks([assignment({ title: "Argument Essay" })], new Map(), now)[0];
    expect(t.archetype).toBe("production");
    expect(t.needsInput).toBe(false);
    expect(t.totalMinutes).toBe(180); // essay base
    expect(t.spacingSchedule).toBeNull(); // production isn't spaced
    expect(t.estimateBasis).toBe("archetype_default:production:essay");
  });

  it("marks a genuinely ambiguous task as needs-input", () => {
    const t = buildAssignmentTasks([assignment({ title: "TBD", points_possible: null })], new Map(), now)[0];
    expect(t.archetype).toBeNull();
    expect(t.needsInput).toBe(true);
    expect(t.totalMinutes).toBeNull();
    expect(t.estimateBasis).toBeNull();
  });

  it("lets a saved archetype answer win and honors a student estimate", () => {
    const overrides = new Map<number, RawOverride>([
      [1, { canvas_assignment_id: 1, task_category: null, archetype: "completion", est_minutes: null, skip: false }],
    ]);
    const t = buildAssignmentTasks([assignment({ title: "Argument Essay" })], overrides, now)[0];
    expect(t.archetype).toBe("completion"); // override beats the "essay" inference
    expect(t.totalMinutes).toBe(15);

    const withEst = new Map<number, RawOverride>([
      [1, { canvas_assignment_id: 1, task_category: null, archetype: "production", est_minutes: 100, skip: false }],
    ]);
    const t2 = buildAssignmentTasks([assignment({})], withEst, now)[0];
    expect(t2.totalMinutes).toBe(150); // 100 × production buffer 1.5
    expect(t2.estimateBasis).toBe("student_estimate");
  });

  it("records a spacing schedule for a memorization assignment", () => {
    const t = buildAssignmentTasks(
      [assignment({ title: "Binary Numbers Exam", due_at: iso(2026, 0, 12, 10, 0), points_possible: 100 })],
      new Map(),
      now
    )[0];
    expect(t.archetype).toBe("memorization");
    expect(t.spacingSchedule).toBe("2-3-5-7"); // ≤ 2 weeks out
  });
});

describe("buildExamTasks", () => {
  it("buffers a student estimate and defaults otherwise; always memorization + spaced; skips past exams", () => {
    const rows: RawExam[] = [
      { id: "e1", title: "Midterm", exam_at: iso(2026, 0, 20, 10, 0), est_prep_minutes: 100 },
      { id: "e2", title: "Final", exam_at: iso(2026, 0, 30, 10, 0), est_prep_minutes: null },
      { id: "e3", title: "Past", exam_at: iso(2026, 0, 1, 10, 0), est_prep_minutes: null },
    ];
    const tasks = buildExamTasks(rows, now);
    expect(tasks.map((t) => t.id)).toEqual(["e1", "e2"]); // past exam dropped
    expect(tasks[0].totalMinutes).toBe(140); // 100 × 1.4
    expect(tasks[0].estimateBasis).toBe("student_estimate");
    expect(tasks[1].totalMinutes).toBe(180); // default
    expect(tasks[1].estimateBasis).toBe("exam_default");
    for (const t of tasks) {
      expect(t.archetype).toBe("memorization");
      expect(t.spacingSchedule).not.toBeNull();
    }
  });
});

describe("buildCommitments + projections", () => {
  it("gathers all sources, drops zero-length, and projects to busy intervals", () => {
    const commitments = buildCommitments({
      classEvents: [
        { start_at: iso(2026, 0, 5, 9, 0), end_at: iso(2026, 0, 5, 10, 0) },
        { start_at: iso(2026, 0, 5, 12, 0), end_at: iso(2026, 0, 5, 12, 0) }, // zero-length → dropped
      ],
      googleEvents: [{ start_at: iso(2026, 0, 6, 9, 0), end_at: iso(2026, 0, 6, 10, 0) }],
      movedBlocks: [
        {
          source_kind: "assignment",
          canvas_assignment_id: 1,
          exam_id: null,
          starts_at: iso(2026, 0, 7, 9, 0),
          ends_at: iso(2026, 0, 7, 10, 0),
          session_index: 1,
        },
      ],
      userOccurrences: [{ start: new Date(2026, 0, 8, 9, 0), end: new Date(2026, 0, 8, 10, 0) }],
    });
    expect(commitments.map((c) => c.source)).toEqual(["class", "google", "moved_study", "user_event"]);
    const busy = commitmentsToBusy(commitments);
    expect(busy).toHaveLength(4);
    for (const b of busy) expect(b.end.getTime()).toBeGreaterThan(b.start.getTime());
  });

  it("taskToPlannable maps source→kind and preserves the schedulable fields", () => {
    const t = buildAssignmentTasks([assignment({ title: "Argument Essay" })], new Map(), now)[0];
    const p = taskToPlannable(t);
    expect(p.kind).toBe("assignment");
    expect(p.id).toBe(t.id);
    expect(p.totalMinutes).toBe(t.totalMinutes);
    expect(p.archetype).toBe(t.archetype);
    expect("estimateBasis" in p).toBe(false); // provenance stays in the model, not the engine input
  });
});

describe("movedBlocksToLocked", () => {
  it("ties moved blocks to their task and skips unlinkable/zero-length ones", () => {
    const moved: RawMovedBlock[] = [
      { source_kind: "assignment", canvas_assignment_id: 7, exam_id: null, starts_at: iso(2026, 0, 7, 9, 0), ends_at: iso(2026, 0, 7, 10, 0), session_index: 2 },
      { source_kind: "exam", canvas_assignment_id: null, exam_id: "e1", starts_at: iso(2026, 0, 8, 9, 0), ends_at: iso(2026, 0, 8, 10, 0), session_index: 1 },
      { source_kind: "assignment", canvas_assignment_id: null, exam_id: null, starts_at: iso(2026, 0, 9, 9, 0), ends_at: iso(2026, 0, 9, 10, 0), session_index: 1 }, // unlinkable
      { source_kind: "assignment", canvas_assignment_id: 9, exam_id: null, starts_at: iso(2026, 0, 10, 9, 0), ends_at: iso(2026, 0, 10, 9, 0), session_index: 1 }, // zero-length
    ];
    const locked = movedBlocksToLocked(moved);
    expect(locked.map((l) => l.taskId)).toEqual(["7", "e1"]);
    expect(locked[0].sessionIndex).toBe(2);
  });
});
