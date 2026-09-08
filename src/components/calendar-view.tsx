"use client";

// ============================================================================
// CALENDAR VIEW — the week/month calendar grid (display only)
//
// Takes the assignments + class events passed in from the dashboard and lays
// them out on a Week or Month calendar. Pure display: it never fetches data and
// never schedules anything. The date math lives in src/lib/calendar.ts.
// ============================================================================

import { useMemo, useState } from "react";
import {
  addDays,
  isSameDay,
  monthGrid,
  weekDays,
} from "@/lib/calendar";
import type { AssignmentItem, ClassEventItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "week" | "month";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView({
  assignments,
  events,
}: {
  assignments: AssignmentItem[];
  events: ClassEventItem[];
}) {
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const today = new Date();

  // Assignments with no due date are shown separately — we never guess a date.
  const noDueDate = useMemo(
    () => assignments.filter((a) => !a.due_at),
    [assignments]
  );

  function move(step: number) {
    setAnchor((prev) => addDays(prev, step * (mode === "week" ? 7 : 30)));
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => move(-1)}>
            ← Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => move(1)}>
            Next →
          </Button>
          <span className="ml-2 text-sm font-medium">
            {anchor.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={mode === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("week")}
          >
            Week
          </Button>
          <Button
            variant={mode === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("month")}
          >
            Month
          </Button>
        </div>
      </div>

      <Legend />

      {mode === "week" ? (
        <WeekView
          anchor={anchor}
          today={today}
          assignments={assignments}
          events={events}
        />
      ) : (
        <MonthView
          anchor={anchor}
          today={today}
          assignments={assignments}
          events={events}
        />
      )}

      {noDueDate.length > 0 && (
        <section className="rounded-lg border p-4">
          <h3 className="mb-1 font-medium">No due date</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Canvas didn’t give these a due date, so they don’t appear on the
            calendar. We show them here rather than guessing when they’re due.
          </p>
          <ul className="flex flex-col gap-1">
            {noDueDate.map((a) => (
              <li key={a.id} className="text-sm">
                <ItemLink href={a.html_url}>{a.title}</ItemLink>
                {a.course_name && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {a.course_name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />
        Class / event
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
        Assignment due
      </span>
    </div>
  );
}

// --- Week view: 7 day columns, each listing timed items ----------------------

function WeekView({
  anchor,
  today,
  assignments,
  events,
}: {
  anchor: Date;
  today: Date;
  assignments: AssignmentItem[];
  events: ClassEventItem[];
}) {
  const days = weekDays(anchor);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
      {days.map((day) => {
        const dayEvents = events
          .filter((e) => e.start_at && isSameDay(new Date(e.start_at), day))
          .sort(byTime((e) => e.start_at));
        const dayAssignments = assignments
          .filter((a) => a.due_at && isSameDay(new Date(a.due_at), day))
          .sort(byTime((a) => a.due_at));
        const isToday = isSameDay(day, today);

        return (
          <div
            key={day.toISOString()}
            className={cn(
              "rounded-lg border p-2",
              isToday && "border-primary ring-1 ring-primary"
            )}
          >
            <div className="mb-2 text-xs font-medium">
              {WEEKDAY_LABELS[day.getDay()]} {day.getDate()}
            </div>
            <div className="flex flex-col gap-1.5">
              {dayEvents.length === 0 && dayAssignments.length === 0 && (
                <span className="text-xs text-muted-foreground">—</span>
              )}
              {dayEvents.map((e) => (
                <EventChip key={e.id} event={e} />
              ))}
              {dayAssignments.map((a) => (
                <AssignmentChip key={a.id} assignment={a} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Month view: full grid, compact chips ------------------------------------

function MonthView({
  anchor,
  today,
  assignments,
  events,
}: {
  anchor: Date;
  today: Date;
  assignments: AssignmentItem[];
  events: ClassEventItem[];
}) {
  const weeks = monthGrid(anchor.getFullYear(), anchor.getMonth());
  const currentMonth = anchor.getMonth();

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="p-2 text-center text-xs font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {weeks.flat().map((day) => {
            const inMonth = day.getMonth() === currentMonth;
            const isToday = isSameDay(day, today);
            const dayEvents = events.filter(
              (e) => e.start_at && isSameDay(new Date(e.start_at), day)
            );
            const dayAssignments = assignments.filter(
              (a) => a.due_at && isSameDay(new Date(a.due_at), day)
            );

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-24 bg-background p-1.5",
                  !inMonth && "bg-muted/40 text-muted-foreground"
                )}
              >
                <div
                  className={cn(
                    "mb-1 text-xs",
                    isToday &&
                      "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-1">
                  {dayEvents.slice(0, 2).map((e) => (
                    <MiniChip key={e.id} color="blue" label={e.title} />
                  ))}
                  {dayAssignments.slice(0, 2).map((a) => (
                    <MiniChip key={a.id} color="amber" label={a.title} />
                  ))}
                  {dayEvents.length + dayAssignments.length > 4 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{dayEvents.length + dayAssignments.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- Small pieces ------------------------------------------------------------

function EventChip({ event }: { event: ClassEventItem }) {
  return (
    <div className="rounded-md border-l-2 border-blue-500 bg-blue-500/5 px-2 py-1 text-xs">
      <div className="font-medium">
        <ItemLink href={event.html_url}>{event.title}</ItemLink>
      </div>
      <div className="text-muted-foreground">
        {formatTimeRange(event.start_at, event.end_at)}
        {event.location_name ? ` · ${event.location_name}` : ""}
      </div>
    </div>
  );
}

function AssignmentChip({ assignment }: { assignment: AssignmentItem }) {
  return (
    <div className="rounded-md border-l-2 border-amber-500 bg-amber-500/5 px-2 py-1 text-xs">
      <div className="font-medium">
        <ItemLink href={assignment.html_url}>{assignment.title}</ItemLink>
      </div>
      <div className="text-muted-foreground">
        Due {formatTime(assignment.due_at)}
        {assignment.points_possible != null
          ? ` · ${assignment.points_possible} pts`
          : ""}
      </div>
    </div>
  );
}

function MiniChip({
  color,
  label,
}: {
  color: "blue" | "amber";
  label: string;
}) {
  return (
    <span
      className={cn(
        "truncate rounded px-1 py-0.5 text-[10px] leading-tight",
        color === "blue"
          ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      )}
      title={label}
    >
      {label}
    </span>
  );
}

function ItemLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {children}
    </a>
  );
}

// --- formatting + sorting ----------------------------------------------------

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return "Time not set";
  const startStr = formatTime(start);
  return end ? `${startStr}–${formatTime(end)}` : startStr;
}

// Sort helper: order items by the time of the given ISO field (nulls last).
function byTime<T>(get: (item: T) => string | null) {
  return (a: T, b: T) => {
    const av = get(a);
    const bv = get(b);
    if (!av) return 1;
    if (!bv) return -1;
    return new Date(av).getTime() - new Date(bv).getTime();
  };
}
