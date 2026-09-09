// ============================================================================
// UPCOMING ASSIGNMENTS — slim, full-width bar (URL "/", top of the dashboard)
//
// A single compact horizontal row of the soonest deadlines, pinned across the
// full width above the calendar + to-do columns. It takes minimal vertical
// space and scrolls sideways when there are many.
//
// DISPLAY ONLY: it renders the `assignments` already fetched by the dashboard
// and passed in as a prop — no data fetching, storage, or logic of its own.
// ============================================================================
import type { AssignmentItem } from "@/lib/types";

const MAX_SHOWN = 20;

// Compact, e.g. "Tue 11:59 PM".
function formatShortDue(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} ${time}`;
}

export function UpcomingAssignments({
  assignments,
}: {
  assignments: AssignmentItem[];
}) {
  // Only dated assignments belong on a "due soon" bar; the calendar's
  // "no due date" section still lists the rest. They arrive already sorted by
  // due date (ascending) from the dashboard query.
  const upcoming = assignments.filter((a) => a.due_at).slice(0, MAX_SHOWN);

  if (upcoming.length === 0) return null;

  return (
    <section
      aria-label="Upcoming assignments"
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-1.5"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-tight">
        <span className="size-2 rounded-full bg-amber-500" />
        Upcoming
      </span>

      {/* One horizontal row; scrolls sideways if there are many. */}
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {upcoming.map((a) => {
          const chip = (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs">
              <span className="max-w-[180px] truncate font-medium text-amber-900 dark:text-amber-100 hyper-focus:text-amber-100">
                {a.title}
              </span>
              <span className="text-amber-700/80 dark:text-amber-200/70 hyper-focus:text-amber-200/80">
                {a.due_at ? formatShortDue(a.due_at) : ""}
              </span>
            </span>
          );

          return (
            <span key={a.id} className="shrink-0">
              {a.html_url ? (
                <a
                  href={a.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md transition-opacity hover:opacity-80"
                >
                  {chip}
                </a>
              ) : (
                chip
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}
