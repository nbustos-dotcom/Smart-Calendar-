// ============================================================================
// OVERLAP LAYOUT — split a day column into side-by-side lanes (Google-Calendar)
//
// Pure, deterministic geometry. Given time spans (minutes from midnight) that
// share one day column, assign each a LANE (column index) and the number of
// lanes it must share the width with. A block only shares width with the other
// blocks it actually overlaps in time — grouped into connected overlap CLUSTERS
// — so a busy 9am group never squeezes an unrelated 3pm group. Separate clusters
// each get the full column width.
//
// No React, no DOM, no data model → trivially unit-testable (see
// tests/overlap-layout.test.ts).
// ============================================================================

export type Span = { startMin: number; endMin: number };

export type Positioned<T> = T & {
  lane: number; // 0-based column index within this block's overlap cluster
  laneCount: number; // how many columns that cluster is divided into
};

/**
 * Lay overlapping spans out into side-by-side lanes.
 *
 * Algorithm (the standard interval-graph / calendar packing):
 *  1. Sort by start, then end, so lane assignment is deterministic.
 *  2. Walk the spans, breaking them into clusters: a span that starts at or
 *     after everything seen so far has ended begins a NEW cluster (it overlaps
 *     nobody before it).
 *  3. Within a cluster, greedily place each span in the first lane whose
 *     previous block has already ended; otherwise open a new lane.
 *  4. laneCount for the whole cluster = the number of lanes opened = the peak
 *     number of blocks overlapping at once. Every block in the cluster reports
 *     that same laneCount, so they tile the width evenly with no gaps.
 *
 * Blocks that merely touch at an edge (one's end === the other's start) are
 * treated as NOT overlapping, so back-to-back events each keep full width.
 */
export function layoutOverlaps<T extends Span>(items: T[]): Positioned<T>[] {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin
  );

  const out: Positioned<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -1; // latest end minute seen in the current cluster

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = []; // end minute currently occupying each lane
    const assigned: { item: T; lane: number }[] = [];
    for (const it of cluster) {
      // Reuse the first lane free by this block's start; else open a new one.
      let lane = laneEnds.findIndex((end) => end <= it.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.endMin);
      } else {
        laneEnds[lane] = it.endMin;
      }
      assigned.push({ item: it, lane });
    }
    const laneCount = laneEnds.length;
    for (const a of assigned) {
      out.push({ ...a.item, lane: a.lane, laneCount });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();

  return out;
}
