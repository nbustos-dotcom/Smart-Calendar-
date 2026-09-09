"use client";

// ============================================================================
// DUE TODAY BUBBLE — a small always-visible floating pill on the dashboard
//
// Reads the assignment data the dashboard already has (no fetching, no new
// data). Shows how many Canvas assignments are due TODAY; clicking expands a
// compact list (title + due time). When nothing is due, it stays visible with a
// calm "Nothing due today" state rather than disappearing.
//
// Deterministic: it just filters + sorts the assignments by their due date.
//
// Styling note: colors come ONLY from the theme tokens (bg-primary, bg-popover,
// text-muted-foreground, border, …), the same tokens light / dark / hyper-focus
// all override — so this renders correctly in every theme with no hardcoded
// colors.
// ============================================================================

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { isSameDay } from "@/lib/calendar";
import type { AssignmentItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type DueItem = { id: string; title: string; href: string | null; at: string };

// The assignments due today, earliest first. Pure: same input → same output.
function dueTodayFrom(assignments: AssignmentItem[], now: Date): DueItem[] {
  return assignments
    .filter((a) => a.due_at && isSameDay(new Date(a.due_at), now))
    .sort(
      (a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime()
    )
    .map((a) => ({
      id: a.id,
      title: a.title,
      href: a.html_url,
      at: a.due_at!,
    }));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DueTodayBubble({
  assignments,
}: {
  assignments: AssignmentItem[];
}) {
  const [open, setOpen] = useState(false);

  // "Today" is the viewer's local day — matches how the calendar reads it.
  const due = dueTodayFrom(assignments, new Date());
  const count = due.length;
  const hasDue = count > 0;

  // Close the expanded list on Escape, like a small popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Nothing due → a calm, non-interactive pill. Still visible, never hidden.
  if (!hasDue) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground shadow-lg">
          <CalendarDays className="size-4" />
          Nothing due today
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div
          role="dialog"
          aria-label="Assignments due today"
          className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">
              Due today · {count}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:underline"
            >
              close
            </button>
          </div>
          <ul className="max-h-72 overflow-auto p-2">
            {due.map((d) => (
              <li
                key={d.id}
                className="rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <div className="text-sm font-medium leading-tight">
                  {d.href ? (
                    <a
                      href={d.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Due {formatTime(d.at)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${count} assignment${count === 1 ? "" : "s"} due today`}
        className={cn(
          "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg transition",
          "bg-primary text-primary-foreground hover:opacity-90"
        )}
      >
        <CalendarDays className="size-4" />
        {count} due today
      </button>
    </div>
  );
}
