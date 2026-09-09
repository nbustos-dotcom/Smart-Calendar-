import { describe, it, expect } from "vitest";
import { layoutOverlaps, type Span } from "@/lib/overlap-layout";

type Block = Span & { id: string };

// Look up the placement for a given id.
function place(out: (Block & { lane: number; laneCount: number })[], id: string) {
  const b = out.find((o) => o.id === id);
  if (!b) throw new Error(`no placement for ${id}`);
  return { lane: b.lane, laneCount: b.laneCount };
}

describe("layoutOverlaps", () => {
  it("gives a lone event the full width", () => {
    const out = layoutOverlaps<Block>([{ id: "a", startMin: 540, endMin: 600 }]);
    expect(place(out, "a")).toEqual({ lane: 0, laneCount: 1 });
  });

  it("splits two overlapping events into two lanes", () => {
    const out = layoutOverlaps<Block>([
      { id: "a", startMin: 540, endMin: 600 }, // 9:00–10:00
      { id: "b", startMin: 570, endMin: 630 }, // 9:30–10:30
    ]);
    expect(place(out, "a")).toEqual({ lane: 0, laneCount: 2 });
    expect(place(out, "b")).toEqual({ lane: 1, laneCount: 2 });
  });

  it("splits three mutually overlapping events into three lanes", () => {
    const out = layoutOverlaps<Block>([
      { id: "a", startMin: 540, endMin: 660 },
      { id: "b", startMin: 550, endMin: 660 },
      { id: "c", startMin: 560, endMin: 660 },
    ]);
    for (const id of ["a", "b", "c"]) {
      expect(place(out, id).laneCount).toBe(3);
    }
    // Distinct lanes (0,1,2 in some order).
    const lanes = ["a", "b", "c"].map((id) => place(out, id).lane).sort();
    expect(lanes).toEqual([0, 1, 2]);
  });

  it("handles a partial-overlap chain: peak concurrency is 2, and a freed lane is reused", () => {
    // A 9:00–10:00, B 9:30–10:30, C 10:15–11:00.
    // A–B overlap, B–C overlap, but A–C do NOT. Peak overlap = 2, and C reuses
    // A's lane once A has ended.
    const out = layoutOverlaps<Block>([
      { id: "a", startMin: 540, endMin: 600 },
      { id: "b", startMin: 570, endMin: 630 },
      { id: "c", startMin: 615, endMin: 660 },
    ]);
    expect(place(out, "a")).toEqual({ lane: 0, laneCount: 2 });
    expect(place(out, "b")).toEqual({ lane: 1, laneCount: 2 });
    expect(place(out, "c")).toEqual({ lane: 0, laneCount: 2 }); // reused A's lane
  });

  it("does NOT squeeze unrelated groups — separate clusters each keep full width", () => {
    const out = layoutOverlaps<Block>([
      { id: "morning1", startMin: 540, endMin: 600 },
      { id: "morning2", startMin: 570, endMin: 610 }, // overlaps morning1
      { id: "afternoon", startMin: 900, endMin: 960 }, // 3pm, alone
    ]);
    expect(place(out, "morning1").laneCount).toBe(2);
    expect(place(out, "morning2").laneCount).toBe(2);
    // The afternoon event is in its own cluster, so it keeps the full width.
    expect(place(out, "afternoon")).toEqual({ lane: 0, laneCount: 1 });
  });

  it("treats back-to-back (touching) events as non-overlapping", () => {
    const out = layoutOverlaps<Block>([
      { id: "a", startMin: 540, endMin: 600 }, // 9–10
      { id: "b", startMin: 600, endMin: 660 }, // 10–11 (touches a's end)
    ]);
    expect(place(out, "a")).toEqual({ lane: 0, laneCount: 1 });
    expect(place(out, "b")).toEqual({ lane: 0, laneCount: 1 });
  });

  it("is order-independent (unsorted input lays out the same)", () => {
    const items: Block[] = [
      { id: "c", startMin: 615, endMin: 660 },
      { id: "a", startMin: 540, endMin: 600 },
      { id: "b", startMin: 570, endMin: 630 },
    ];
    const out = layoutOverlaps<Block>(items);
    expect(place(out, "a")).toEqual({ lane: 0, laneCount: 2 });
    expect(place(out, "b")).toEqual({ lane: 1, laneCount: 2 });
    expect(place(out, "c")).toEqual({ lane: 0, laneCount: 2 });
  });
});
