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

// --- Week time-grid sizing (all display only) --------------------------------
const HOUR_PX = 48; // vertical pixels per hour row
const TIME_COL_PX = 60; // width of the left time axis
const GRID_PAD_TOP = 10; // top padding so the first hour label isn't clipped
const MIN_BLOCK_PX = 26; // smallest a block can render, so its label still fits
const DEFAULT_EVENT_MIN = 60; // assume 1 hour when an event has no end time
const DUE_BLOCK_MIN = 30; // a deadline is a moment; show it as a short block
const MAX_SIDE_BY_SIDE = 2; // beyond this many overlapping items, collapse them

// One positioned block on the week grid (an event or an assignment deadline).
type GridBlock = {
  id: string;
  kind: "event" | "assignment";
  title: string;
  href: string | null;
  subtitle: string;
  startMin: number; // minutes from midnight
  endMin: number; // minutes from midnight
};

// A set of blocks that overlap in time and must share a day column's width.
type Cluster = {
  key: string;
  startMin: number;
  items: GridBlock[];
};

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

// --- Week view: a time-grid, like Google Calendar ----------------------------
//
// 7 day columns (Mon–Sun) across the full width, hours down the left side, and
// each event/assignment placed at its real start time and sized to its duration
// (not stretched to fill the day). Items with no time-of-day — Canvas "all-day"
// events — go in the all-day strip on top; we never invent a clock time for them.

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
  // Which collapsed overlap-cluster (if any) is currently expanded.
  const [openCluster, setOpenCluster] = useState<string | null>(null);

  // Monday-first order. The shared weekDays() helper is Sunday-first (and the
  // month view relies on that), so we reorder locally instead of changing it.
  const days = mondayFirst(weekDays(anchor));

  // For each day, split items into timed blocks (placed on the grid) and all-day
  // events (placed in the strip). Assignments always carry a due time, so they
  // are always timed.
  const perDay = days.map((day) => {
    const allDay = events.filter(
      (e) => e.start_at && isSameDay(new Date(e.start_at), day) && isAllDay(e)
    );

    const timed: GridBlock[] = [];

    for (const e of events) {
      if (!e.start_at) continue;
      const start = new Date(e.start_at);
      if (!isSameDay(start, day) || isAllDay(e)) continue;
      const startMin = minutesOfDay(start);
      const endMin = e.end_at
        ? Math.max(minutesOfDay(new Date(e.end_at)), startMin + 15)
        : startMin + DEFAULT_EVENT_MIN;
      timed.push({
        id: e.id,
        kind: "event",
        title: e.title,
        href: e.html_url,
        subtitle: [formatTimeRange(e.start_at, e.end_at), e.location_name]
          .filter((s): s is string => Boolean(s))
          .join(" · "),
        startMin,
        endMin,
      });
    }

    for (const a of assignments) {
      if (!a.due_at) continue;
      const due = new Date(a.due_at);
      if (!isSameDay(due, day)) continue;
      const startMin = minutesOfDay(due);
      timed.push({
        id: a.id,
        kind: "assignment",
        title: a.title,
        href: a.html_url,
        subtitle: `Due ${formatTime(a.due_at)}${
          a.points_possible != null ? ` · ${a.points_possible} pts` : ""
        }`,
        startMin,
        endMin: startMin + DUE_BLOCK_MIN,
      });
    }

    return { day, allDay, timed };
  });

  // One shared hour range for the whole week so every column lines up.
  const { minHour, maxHour } = hourRange(perDay.flatMap((d) => d.timed));
  const totalHeight = (maxHour - minHour) * HOUR_PX;
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const hasAllDay = perDay.some((d) => d.allDay.length > 0);
  const gridCols = `${TIME_COL_PX}px repeat(7, minmax(0, 1fr))`;

  // Convert minutes-from-midnight into a vertical pixel offset on the grid.
  const yFor = (min: number) => ((min - minHour * 60) / 60) * HOUR_PX;

  return (
    <div className="w-full overflow-x-auto">
      <div className="w-full min-w-[720px] overflow-hidden rounded-lg border">
        {/* One vertical scroll container holds BOTH the header and the grid, so
            the scrollbar narrows them by the same amount and the columns stay
            perfectly aligned. The header is sticky so it stays in view. */}
        <div className="max-h-[72vh] overflow-y-auto">
          {/* Day headers (sticky) */}
          <div
            className="sticky top-0 z-20 grid border-b bg-background"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="border-r" />
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "border-r px-2 py-1.5 text-center last:border-r-0",
                    isToday && "bg-primary/5"
                  )}
                >
                  <div className="text-xs text-muted-foreground">
                    {WEEKDAY_LABELS[day.getDay()]}
                  </div>
                  <div
                    className={cn(
                      "text-sm font-medium",
                      isToday && "text-primary"
                    )}
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* All-day strip — only shown when there are all-day events */}
          {hasAllDay && (
            <div
              className="grid border-b"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="flex items-center justify-end border-r px-1 py-1 text-[10px] text-muted-foreground">
                all-day
              </div>
              {perDay.map(({ day, allDay }) => (
                <div
                  key={day.toISOString()}
                  className="border-r p-1 last:border-r-0"
                >
                  <div className="flex flex-col gap-1">
                    {allDay.map((e) => (
                      <div
                        key={e.id}
                        className="truncate rounded border-l-2 border-blue-500 bg-blue-500/10 px-1 py-0.5 text-[11px]"
                        title={e.title}
                      >
                        <ItemLink href={e.html_url}>{e.title}</ItemLink>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Time grid */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: gridCols,
              paddingTop: GRID_PAD_TOP,
            }}
          >
            {/* Left time axis — labels centered on each hour line. The grid's
                top padding keeps the first label from being clipped. */}
            <div className="relative border-r" style={{ height: totalHeight }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                  style={{ top: yFor(h * 60) }}
                >
                  {formatHour(h)}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {perDay.map(({ day, timed }) => {
              const isToday = isSameDay(day, today);
              const clusters = clusterOverlaps(timed);
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "relative border-r last:border-r-0",
                    isToday && "bg-primary/5"
                  )}
                  style={{
                    height: totalHeight,
                    // Faint horizontal line at the top of every hour, aligned
                    // with the hour labels on the axis.
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                  }}
                >
                  {isToday && <NowLine minHour={minHour} maxHour={maxHour} />}

                  {clusters.map((cluster) => {
                    const clusterKey = `${day.toISOString()}::${cluster.key}`;
                    const top = yFor(cluster.startMin);

                    // 3+ overlapping items would be unreadable slivers, so we
                    // collapse them into one block that expands on click.
                    if (cluster.items.length > MAX_SIDE_BY_SIDE) {
                      return (
                        <CollapsedCluster
                          key={clusterKey}
                          top={top}
                          totalHeight={totalHeight}
                          items={cluster.items}
                          open={openCluster === clusterKey}
                          onToggle={() =>
                            setOpenCluster((k) =>
                              k === clusterKey ? null : clusterKey
                            )
                          }
                        />
                      );
                    }

                    // 1 or 2 items: place them side by side, each readable.
                    const lanes = cluster.items.length;
                    return cluster.items.map((b, lane) => {
                      const height = Math.max(
                        MIN_BLOCK_PX,
                        Math.min(yFor(b.endMin) - top, totalHeight - top)
                      );
                      const widthPct = 100 / lanes;
                      return (
                        <div
                          key={b.id}
                          className={cn(
                            "absolute overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-[11px] leading-tight",
                            b.kind === "event"
                              ? "border-blue-500 bg-blue-500/10 text-blue-900 dark:text-blue-100"
                              : "border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                          )}
                          style={{
                            top: yFor(b.startMin),
                            height,
                            left: `calc(${lane * widthPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                          }}
                          title={`${b.title} — ${b.subtitle}`}
                        >
                          <div className="truncate font-medium">
                            <ItemLink href={b.href}>{b.title}</ItemLink>
                          </div>
                          {height > 34 && (
                            <div className="truncate text-muted-foreground">
                              {b.subtitle}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// A collapsed stack of 3+ overlapping items. Shows a single readable summary
// block ("N due · 9:00 AM"); clicking it expands a full-width list so every
// title is legible instead of crushing them into slivers.
function CollapsedCluster({
  top,
  totalHeight,
  items,
  open,
  onToggle,
}: {
  top: number;
  totalHeight: number;
  items: GridBlock[];
  open: boolean;
  onToggle: () => void;
}) {
  const allAssignments = items.every((b) => b.kind === "assignment");
  const startLabel = formatMinutes(items[0].startMin);
  const height = Math.max(MIN_BLOCK_PX, Math.min(HOUR_PX, totalHeight - top));

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "absolute left-0.5 right-0.5 flex flex-col justify-center overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px] leading-tight",
          allAssignments
            ? "border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-100"
            : "border-blue-500 bg-blue-500/15 text-blue-900 dark:text-blue-100"
        )}
        style={{ top, height }}
        title={`${items.length} items at ${startLabel} — click to expand`}
      >
        <span className="truncate font-medium">
          {items.length} {allAssignments ? "due" : "items"} · {startLabel}
        </span>
        <span className="truncate text-muted-foreground">
          {open ? "click to collapse" : "click to expand"}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0.5 right-0.5 z-30 max-h-64 overflow-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg"
          style={{ top }}
        >
          <div className="mb-1 flex items-center justify-between px-0.5">
            <span className="text-[11px] font-medium">
              {items.length} at {startLabel}
            </span>
            <button
              type="button"
              onClick={onToggle}
              className="text-[11px] text-muted-foreground hover:underline"
            >
              close
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {items.map((b) => (
              <li
                key={b.id}
                className={cn(
                  "rounded border-l-2 px-1.5 py-1 text-[11px] leading-tight",
                  b.kind === "event"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-amber-500 bg-amber-500/10"
                )}
              >
                <div className="font-medium">
                  <ItemLink href={b.href}>{b.title}</ItemLink>
                </div>
                <div className="text-muted-foreground">{b.subtitle}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// A thin red line marking the current time on today's column (like Google
// Calendar). Hidden when "now" is outside the visible hour range.
function NowLine({ minHour, maxHour }: { minHour: number; maxHour: number }) {
  const nowMin = minutesOfDay(new Date());
  if (nowMin < minHour * 60 || nowMin > maxHour * 60) return null;
  const top = ((nowMin - minHour * 60) / 60) * HOUR_PX;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 border-t border-red-500"
      style={{ top }}
    >
      <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
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

// --- week time-grid helpers (pure) -------------------------------------------

// weekDays() returns Sunday..Saturday; rotate so Monday leads and Sunday trails.
function mondayFirst(days: Date[]): Date[] {
  return [...days.slice(1), days[0]];
}

// Minutes since midnight for a local Date (e.g. 9:30am -> 570).
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// A Canvas "all-day" event has no meaningful clock time. We don't store an
// explicit all-day flag, so we treat an event as all-day when it starts exactly
// at midnight and either has no end or also ends at midnight. Those go in the
// all-day strip instead of being pinned to 12:00 AM on the grid.
function isAllDay(e: ClassEventItem): boolean {
  if (!e.start_at) return false;
  if (minutesOfDay(new Date(e.start_at)) !== 0) return false;
  if (!e.end_at) return true;
  return minutesOfDay(new Date(e.end_at)) === 0;
}

// Pick the hour range the grid should show, from the actual items (so we don't
// render a wall of empty early-morning hours). Falls back to a daytime default.
function hourRange(blocks: GridBlock[]): { minHour: number; maxHour: number } {
  if (blocks.length === 0) return { minHour: 8, maxHour: 20 };
  let min = 24 * 60;
  let max = 0;
  for (const b of blocks) {
    min = Math.min(min, b.startMin);
    max = Math.max(max, b.endMin);
  }
  const minHour = Math.max(0, Math.floor(min / 60));
  const maxHour = Math.min(24, Math.max(minHour + 1, Math.ceil(max / 60)));
  return { minHour, maxHour };
}

// Group blocks that overlap in time into clusters. Blocks in a cluster must
// share the day column's width; separate clusters each get the full width.
// (The renderer draws small clusters side by side and collapses big ones.)
function clusterOverlaps(blocks: GridBlock[]): Cluster[] {
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin
  );
  const clusters: Cluster[] = [];
  let current: GridBlock[] = [];
  let currentEnd = -1;

  const flush = () => {
    if (current.length === 0) return;
    const startMin = Math.min(...current.map((b) => b.startMin));
    clusters.push({
      key: `${startMin}-${currentEnd}-${current.length}`,
      startMin,
      items: current,
    });
    current = [];
    currentEnd = -1;
  };

  for (const b of sorted) {
    // A gap with everything so far ends the current overlap cluster.
    if (current.length > 0 && b.startMin >= currentEnd) flush();
    current.push(b);
    currentEnd = Math.max(currentEnd, b.endMin);
  }
  flush();
  return clusters;
}

// "8 AM", "12 PM", "11 PM" for an hour number 0..23.
function formatHour(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

// "9:00 AM" from minutes-since-midnight (used by the collapsed-cluster label).
function formatMinutes(min: number): string {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
