// ============================================================================
// UPCOMING ASSIGNMENTS — always-visible strip (URL "/", top of the main column)
//
// Assignments are the point of this app, and most Canvas due times are late at
// night, so they can fall below the fold on the time-grid. This strip keeps the
// soonest deadlines in view WITHOUT scrolling.
//
// DISPLAY ONLY: it renders the `assignments` already fetched by the dashboard
// and passed in as a prop — no data fetching, storage, or logic of its own.
// ============================================================================
import type { AssignmentItem } from "@/lib/types";

const MAX_SHOWN = 8;

function formatDue(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

export function UpcomingAssignments({
  assignments,
}: {
  assignments: AssignmentItem[];
}) {
  // Only dated assignments belong on a "due soon" strip; the calendar's
  // "no due date" section still lists the rest. Assignments arrive already
  // sorted by due date (ascending) from the dashboard query.
  const upcoming = assignments.filter((a) => a.due_at).slice(0, MAX_SHOWN);

  if (upcoming.length === 0) return null;

  return (
    <section
      aria-label="Upcoming assignments"
      className="rounded-xl border bg-card p-3"
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="inline-block size-2 rounded-full bg-amber-500" />
        <h2 className="text-sm font-semibold tracking-tight">
          Upcoming assignments
        </h2>
      </div>

      {/* Horizontal strip so it stays a single always-visible row and uses the
          full width; it scrolls sideways if there are many. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {upcoming.map((a) => {
          const card = (
            <div className="flex h-full flex-col gap-1 rounded-lg border-l-[3px] border-amber-500 bg-amber-500/10 px-3 py-2">
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-amber-900 dark:text-amber-100">
                {a.title}
              </p>
              <p className="text-xs font-medium text-amber-800/90 dark:text-amber-200/90">
                {a.due_at ? formatDue(a.due_at) : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {a.course_name ?? "Course"}
                {a.points_possible != null ? ` · ${a.points_possible} pts` : ""}
              </p>
            </div>
          );

          return (
            <div key={a.id} className="w-52 shrink-0">
              {a.html_url ? (
                <a
                  href={a.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-full rounded-lg transition-shadow hover:shadow-sm"
                >
                  {card}
                </a>
              ) : (
                card
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
