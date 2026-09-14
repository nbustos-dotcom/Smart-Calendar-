"use client";

// ============================================================================
// CALENDAR VIEW — the week/month calendar grid
//
// Two layers live here:
//   1. READ-ONLY: Canvas assignments + synced class events. These are never
//      draggable, editable, or deletable — they mirror Canvas, which we only
//      ever read. (See CLAUDE.md: "Read-only Canvas. Never write back.")
//   2. THE USER'S OWN EVENTS: create / edit / move / resize / delete, including
//      weekly-repeating series with per-occurrence exceptions. This is the only
//      layer the pointer interactions and the event dialog ever touch.
//
// Writes go through the server actions in src/app/events/actions.ts. We keep a
// local optimistic copy of the user's events/overrides (seeded once from props)
// so edits feel instant; on a failed save we revert that copy.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, isSameDay, monthGrid, startOfDay, weekDays } from "@/lib/calendar";
import type {
  AssignmentItem,
  ClassEventItem,
  ExamItem,
  StudyBlockItem,
} from "@/lib/types";
import {
  expandOccurrencesForRange,
  ymd,
  type EventOccurrence,
  type EventPayload,
  type OverrideRow,
  type UserEventRow,
} from "@/lib/recurrence";
import { colorStyle, type EventColor } from "@/lib/event-colors";
import { hexToRgba } from "@/lib/google-colors";
import { layoutOverlaps } from "@/lib/overlap-layout";
import { DayDueDropdown } from "@/components/day-due-dropdown";
import {
  EventDialog,
  type EditTarget,
  type EventFormValues,
  type EventScope,
} from "@/components/event-dialog";
import { GoogleEventDialog } from "@/components/google-event-dialog";
import { ExamDialog } from "@/components/exam-dialog";
import { StudyNeedsInputDialog } from "@/components/study-needs-input-dialog";
import { setStudyBlockTimeAction } from "@/app/scheduler/actions";
import { GraduationCap, Menu } from "lucide-react";
import {
  createEventAction,
  deleteEventAction,
  deleteOccurrenceAction,
  setOccurrenceOverrideAction,
  setSingleEventTimeAction,
  updateSeriesAction,
} from "@/app/events/actions";
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
const SNAP_MIN = 15; // drag/resize snaps to a 15-minute grid
const CLICK_SLOP_PX = 4; // movement under this counts as a click, not a drag

// One positioned block on the week grid (an event or an assignment deadline).
type GridBlock = {
  id: string;
  kind: "event" | "assignment";
  title: string;
  href: string | null;
  subtitle: string;
  startMin: number; // minutes from midnight
  endMin: number; // minutes from midnight
  google?: boolean; // read-only event sourced from Google Calendar
  googleColor?: string | null; // the event's Google colour (hex), if any
  googleEvent?: ClassEventItem; // the source event, for the read-only detail view
};

// What the create/edit dialog is currently working on. `target` is null for a
// brand-new event; `originalEvent` is kept so a whole-series edit can preserve
// the series' anchor date instead of overwriting it with the clicked day.
type DialogState = {
  initial: EventFormValues;
  target: EditTarget | null;
  originalEvent: UserEventRow | null;
};

export function CalendarView({
  assignments,
  events,
  userEvents,
  overrides,
  exams = [],
  studyBlocks = [],
}: {
  assignments: AssignmentItem[];
  events: ClassEventItem[];
  userEvents: UserEventRow[];
  overrides: OverrideRow[];
  exams?: ExamItem[];
  studyBlocks?: StudyBlockItem[];
}) {
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const today = new Date();

  // Optimistic local copy of the user's own events + overrides. Seeded ONCE
  // from the server props (a plain initializer, so a background revalidation
  // can't snap an in-progress edit back). A full reload re-seeds from the DB.
  const [localEvents, setLocalEvents] = useState<UserEventRow[]>(() => userEvents);
  const [localOverrides, setLocalOverrides] = useState<OverrideRow[]>(
    () => overrides
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // The clicked Google event (read-only detail view). Separate from `dialog`,
  // which is the editable dialog for the user's OWN events.
  const [googleDetail, setGoogleDetail] = useState<ClassEventItem | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Study scheduler UI state ---------------------------------------------
  // Optimistic local copy of study blocks, seeded once (like localEvents), so a
  // drag-move shows instantly and a background revalidation can't snap it back.
  const [localStudyBlocks, setLocalStudyBlocks] = useState<StudyBlockItem[]>(
    () => studyBlocks
  );
  const [examOpen, setExamOpen] = useState(false);
  // The "+ create" hamburger menu (holds + Event and + Add exam).
  const [menuOpen, setMenuOpen] = useState(false);
  const [needsInput, setNeedsInput] = useState<{
    canvasAssignmentId: number;
    title: string;
  } | null>(null);

  // Accept a study-block move: update local state immediately, persist, revert on
  // failure. No confirmation — moving is always accepted (per the spec).
  function commitStudyMove(id: string, start: Date, end: Date) {
    const prev = localStudyBlocks;
    setLocalStudyBlocks((list) =>
      list.map((b) =>
        b.id === id
          ? { ...b, starts_at: start.toISOString(), ends_at: end.toISOString(), moved_by_user: true }
          : b
      )
    );
    setStudyBlockTimeAction(id, start.toISOString(), end.toISOString()).then((res) => {
      if (!res.ok) {
        setLocalStudyBlocks(prev);
        setErrorMsg(res.error);
      }
    });
  }

  // Open the one-question dialog for a needs-input study block.
  function openNeedsInput(block: StudyBlockItem) {
    if (block.source_kind !== "assignment" || block.canvas_assignment_id == null) return;
    setNeedsInput({ canvasAssignmentId: block.canvas_assignment_id, title: block.title });
  }

  function move(step: number) {
    setAnchor((prev) => addDays(prev, step * (mode === "week" ? 7 : 30)));
  }

  // --- Open the dialog --------------------------------------------------------

  // Click an empty slot (or the "+ Event" button) → create a new event there.
  function openCreate(day: Date, startMin: number) {
    const endMin = Math.min(startMin + DEFAULT_EVENT_MIN, 24 * 60 - 1);
    setDialog({
      initial: {
        title: "",
        color: "blue",
        date: ymd(day),
        startTime: minToTime(startMin),
        endTime: minToTime(endMin),
        isRecurring: false,
        weekdays: [day.getDay()],
      },
      target: null,
      originalEvent: null,
    });
  }

  // Click one of the user's own blocks → edit it (single, or one occurrence).
  function openEdit(occ: EventOccurrence) {
    const ev = localEvents.find((e) => e.id === occ.eventId);
    if (!ev) return;
    setDialog({
      initial: {
        title: occ.title,
        color: (occ.color as EventColor) ?? "blue",
        date: ymd(occ.start),
        startTime: minToTime(minutesOfDay(occ.start)),
        endTime: minToTime(minutesOfDay(occ.end)),
        isRecurring: ev.is_recurring,
        weekdays: ev.weekdays ?? [],
      },
      target: {
        eventId: occ.eventId,
        isRecurring: occ.isRecurring,
        occurrenceDate: occ.occurrenceDate,
      },
      originalEvent: ev,
    });
  }

  // --- Persist (optimistic local update + server action + revert on error) ----

  async function onDialogSubmit(values: EventFormValues, scope: EventScope) {
    const d = dialog;
    setDialog(null);
    if (!d) return;

    if (!d.target) {
      await createEvent(values);
    } else if (
      d.target.isRecurring &&
      d.target.occurrenceDate &&
      scope === "occurrence"
    ) {
      await editOccurrence(d.target.eventId, d.target.occurrenceDate, values);
    } else {
      await editSeries(d.target.eventId, d.originalEvent, values);
    }
  }

  async function onDialogDelete(scope: EventScope) {
    const d = dialog;
    setDialog(null);
    if (!d || !d.target) return;

    if (
      d.target.isRecurring &&
      d.target.occurrenceDate &&
      scope === "occurrence"
    ) {
      await deleteOccurrence(d.target.eventId, d.target.occurrenceDate);
    } else {
      await deleteEvent(d.target.eventId);
    }
  }

  async function createEvent(values: EventFormValues) {
    const payload = payloadFromForm(values);
    const tempId = tempId_();
    const prev = localEvents;
    setLocalEvents([...prev, rowFromPayload(tempId, payload)]);

    const res = await createEventAction(payload);
    if (!res.ok) {
      setLocalEvents(prev);
      setErrorMsg("Couldn’t create that event — nothing was saved.");
      return;
    }
    // Swap the temporary id for the real one from the database.
    if (res.id) {
      const realId = res.id;
      setLocalEvents((evs) =>
        evs.map((e) => (e.id === tempId ? { ...e, id: realId } : e))
      );
    }
  }

  async function editSeries(
    eventId: string,
    original: UserEventRow | null,
    values: EventFormValues
  ) {
    const payload = payloadFromForm(values);
    // Whole-series edit: keep the original series start date (the form's date
    // field is just the clicked occurrence's day, not the series anchor).
    if (payload.isRecurring && original?.series_start_date) {
      payload.seriesStartDate = original.series_start_date;
    }
    const prev = localEvents;
    setLocalEvents(
      prev.map((e) => (e.id === eventId ? rowFromPayload(eventId, payload) : e))
    );

    const res = await updateSeriesAction(eventId, payload);
    if (!res.ok) {
      setLocalEvents(prev);
      setErrorMsg("Couldn’t save your changes — they’ve been reverted.");
    }
  }

  async function editOccurrence(
    eventId: string,
    occurrenceDate: string,
    values: EventFormValues
  ) {
    const startsAt = isoFromDateTime(values.date, values.startTime);
    const endsAt = isoFromDateTime(values.date, values.endTime);
    const prev = localOverrides;
    upsertLocalOverride({
      event_id: eventId,
      occurrence_date: occurrenceDate,
      status: "modified",
      starts_at: startsAt,
      ends_at: endsAt,
      title: values.title,
      color: values.color,
    });

    const res = await setOccurrenceOverrideAction(eventId, occurrenceDate, {
      startsAt,
      endsAt,
      title: values.title,
      color: values.color,
    });
    if (!res.ok) {
      setLocalOverrides(prev);
      setErrorMsg("Couldn’t save that change — it’s been reverted.");
    }
  }

  async function deleteEvent(eventId: string) {
    const prevEvents = localEvents;
    const prevOverrides = localOverrides;
    setLocalEvents(prevEvents.filter((e) => e.id !== eventId));
    setLocalOverrides(prevOverrides.filter((o) => o.event_id !== eventId));

    const res = await deleteEventAction(eventId);
    if (!res.ok) {
      setLocalEvents(prevEvents);
      setLocalOverrides(prevOverrides);
      setErrorMsg("Couldn’t delete that event — it’s been restored.");
    }
  }

  async function deleteOccurrence(eventId: string, occurrenceDate: string) {
    const prev = localOverrides;
    upsertLocalOverride({
      event_id: eventId,
      occurrence_date: occurrenceDate,
      status: "cancelled",
      starts_at: null,
      ends_at: null,
      title: null,
      color: null,
    });

    const res = await deleteOccurrenceAction(eventId, occurrenceDate);
    if (!res.ok) {
      setLocalOverrides(prev);
      setErrorMsg("Couldn’t remove that occurrence — it’s been restored.");
    }
  }

  // Drag/resize drop: move or resize ONE occurrence. A recurring occurrence
  // becomes a per-instance override (silent, this instance only); a single
  // event just updates its own time.
  async function commitTimes(occ: EventOccurrence, start: Date, end: Date) {
    const startsAt = start.toISOString();
    const endsAt = end.toISOString();

    if (occ.isRecurring && occ.occurrenceDate) {
      const prev = localOverrides;
      // Preserve any title/colour already overridden for this occurrence.
      const existing = prev.find(
        (o) =>
          o.event_id === occ.eventId && o.occurrence_date === occ.occurrenceDate
      );
      upsertLocalOverride({
        event_id: occ.eventId,
        occurrence_date: occ.occurrenceDate,
        status: "modified",
        starts_at: startsAt,
        ends_at: endsAt,
        title: existing?.title ?? null,
        color: existing?.color ?? null,
      });

      const res = await setOccurrenceOverrideAction(
        occ.eventId,
        occ.occurrenceDate,
        {
          startsAt,
          endsAt,
          title: existing?.title ?? null,
          color: existing?.color ?? null,
        }
      );
      if (!res.ok) {
        setLocalOverrides(prev);
        setErrorMsg("Couldn’t move that event — it’s been put back.");
      }
    } else {
      const prev = localEvents;
      setLocalEvents(
        prev.map((e) =>
          e.id === occ.eventId
            ? { ...e, starts_at: startsAt, ends_at: endsAt }
            : e
        )
      );

      const res = await setSingleEventTimeAction(occ.eventId, startsAt, endsAt);
      if (!res.ok) {
        setLocalEvents(prev);
        setErrorMsg("Couldn’t move that event — it’s been put back.");
      }
    }
  }

  // Replace-or-insert an override for (event_id, occurrence_date) in local state.
  function upsertLocalOverride(o: Omit<OverrideRow, "id">) {
    setLocalOverrides((prev) => {
      const idx = prev.findIndex(
        (x) =>
          x.event_id === o.event_id && x.occurrence_date === o.occurrence_date
      );
      const row: OverrideRow = {
        id: idx >= 0 ? prev[idx].id : tempId_(),
        ...o,
      };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = row;
        return copy;
      }
      return [...prev, row];
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        {/* Bare date-nav controls: chevron-only arrows with "Today" as plain
            clickable text between them (no button "bubbles"). Each arrow keeps
            a small icon but gets generous padding so the click target is
            comfortably larger than the glyph. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label="Previous"
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next"
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className="size-5" />
          </button>
          <span className="ml-1 text-sm font-medium">
            {anchor.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Manual creation lives in a hamburger menu — the scheduler places
              study time automatically, so the toolbar stays clean (just view
              toggle + this menu). Manual entry is here for exams Canvas misses
              and for the student's own events. */}
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              aria-label="Add"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Menu className="size-4" />
            </Button>
            {menuOpen && (
              <>
                {/* Click-away backdrop. */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden
                />
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setMenuOpen(false);
                      const now = new Date();
                      openCreate(now, (now.getHours() + 1) * 60);
                    }}
                  >
                    + Event
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setMenuOpen(false);
                      setExamOpen(true);
                    }}
                  >
                    + Add exam
                  </button>
                </div>
              </>
            )}
          </div>
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

      {/* Transient error banner — we surface failed saves, never hide them. */}
      {errorMsg && (
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Calendar fills the remaining height; only its grid scrolls internally. */}
      <div className="min-h-0 flex-1">
        {mode === "week" ? (
          <WeekView
            anchor={anchor}
            today={today}
            assignments={assignments}
            events={events}
            userEvents={localEvents}
            overrides={localOverrides}
            onSlotClick={openCreate}
            onOccurrenceClick={openEdit}
            onCommitTimes={commitTimes}
            onGoogleEventClick={setGoogleDetail}
            exams={exams}
            studyBlocks={localStudyBlocks}
            onStudyMove={commitStudyMove}
            onNeedsInput={openNeedsInput}
          />
        ) : (
          <MonthView
            anchor={anchor}
            today={today}
            assignments={assignments}
            events={events}
            userEvents={localEvents}
            overrides={localOverrides}
            onGoogleEventClick={setGoogleDetail}
            exams={exams}
            studyBlocks={localStudyBlocks}
            onNeedsInput={openNeedsInput}
          />
        )}
      </div>

      {dialog && (
        <EventDialog
          initial={dialog.initial}
          target={dialog.target}
          onSubmit={onDialogSubmit}
          onDelete={onDialogDelete}
          onClose={() => setDialog(null)}
        />
      )}

      {googleDetail && (
        <GoogleEventDialog
          event={googleDetail}
          onClose={() => setGoogleDetail(null)}
        />
      )}

      {examOpen && <ExamDialog onClose={() => setExamOpen(false)} />}

      {needsInput && (
        <StudyNeedsInputDialog
          canvasAssignmentId={needsInput.canvasAssignmentId}
          title={needsInput.title}
          onClose={() => setNeedsInput(null)}
        />
      )}
    </div>
  );
}

// --- Week view: a time-grid, like Google Calendar ----------------------------
//
// 7 day columns (Mon–Sun) across the full width, hours down the left side, and
// each event/assignment placed at its real start time and sized to its duration.
// The user's own events sit on top as an interactive layer (click to edit, drag
// to move, drag the bottom edge to resize). Assignments/class events underneath
// are read-only and carry no pointer handlers, so they can't be moved or edited.

type UserBlock = {
  occ: EventOccurrence;
  startMin: number;
  endMin: number;
};

// One block placed in a day column, tagged by which layer it belongs to. The
// read-only Canvas items and the user's own events are laid out TOGETHER (one
// layoutOverlaps pass), so anything overlapping in time splits the column
// side-by-side instead of stacking — but each still renders with its own layer's
// styling and interactivity.
type ColumnBlock =
  | {
      key: string;
      layer: "readonly";
      startMin: number;
      endMin: number;
      block: GridBlock;
    }
  | {
      key: string;
      layer: "user";
      startMin: number;
      endMin: number;
      occ: EventOccurrence;
    };

// A live drag in progress (move or resize of ONE user occurrence).
type DragState = {
  occ: EventOccurrence;
  mode: "move" | "resize";
  pointerStart: { x: number; y: number };
  origStartMin: number;
  origEndMin: number;
  origDayIndex: number;
  // Live preview position, updated as the pointer moves.
  dayIndex: number;
  startMin: number;
  endMin: number;
  moved: boolean; // crossed the click/drag threshold?
};

// A live MOVE of one study block. Study blocks are move-only (no resize): the
// student can drag them to a different time/day and we accept it silently. Kept
// separate from the user-event drag so that machinery stays untouched.
type StudyDragState = {
  block: StudyBlockItem;
  pointerStart: { x: number; y: number };
  origStartMin: number;
  origEndMin: number;
  origDayIndex: number;
  dayIndex: number;
  startMin: number;
  endMin: number;
  moved: boolean;
};

function WeekView({
  anchor,
  today,
  assignments,
  events,
  userEvents,
  overrides,
  onSlotClick,
  onOccurrenceClick,
  onCommitTimes,
  onGoogleEventClick,
  exams,
  studyBlocks,
  onStudyMove,
  onNeedsInput,
}: {
  anchor: Date;
  today: Date;
  assignments: AssignmentItem[];
  events: ClassEventItem[];
  userEvents: UserEventRow[];
  overrides: OverrideRow[];
  onSlotClick: (day: Date, startMin: number) => void;
  onOccurrenceClick: (occ: EventOccurrence) => void;
  onCommitTimes: (occ: EventOccurrence, start: Date, end: Date) => void;
  onGoogleEventClick: (event: ClassEventItem) => void;
  exams: ExamItem[];
  studyBlocks: StudyBlockItem[];
  onStudyMove: (id: string, start: Date, end: Date) => void;
  onNeedsInput: (block: StudyBlockItem) => void;
}) {

  // Refs used to auto-scroll the grid to the user's day on load (see effect).
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // The 7 days Sun..Sat of the week containing the anchor (Sunday leftmost).
  // Uses the shared, Sunday-first helper so the column order, the date range
  // below, and the header labels all derive from one source of truth.
  const days = weekDays(anchor);

  // Read-only layer: split synced items into timed blocks + all-day events.
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
        google: e.source === "google",
        googleColor: e.source === "google" ? e.google_color ?? null : null,
        googleEvent: e.source === "google" ? e : undefined,
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

  // Interactive layer: expand the user's own events into this week's concrete
  // occurrences (single + recurring + per-occurrence overrides).
  const rangeStart = startOfDay(days[0]);
  const rangeEnd = addDays(rangeStart, 7); // full Sun..Sat week (exclusive end)
  const userOccurrences = expandOccurrencesForRange(
    userEvents,
    overrides,
    rangeStart,
    rangeEnd
  );

  // --- Drag/resize state + geometry -------------------------------------------
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Refs mirror the values the (mount-once) pointer listeners need, so the
  // listeners always read fresh values without being re-registered mid-drag.
  const daysRef = useRef(days);
  daysRef.current = days;
  const rangeRef = useRef({ minHour: 1, maxHour: 21 });
  const onOccClickRef = useRef(onOccurrenceClick);
  onOccClickRef.current = onOccurrenceClick;
  const onCommitRef = useRef(onCommitTimes);
  onCommitRef.current = onCommitTimes;
  // Set true right after a drag drop so the trailing click event doesn't also
  // fire the empty-slot "create" handler.
  const suppressClickRef = useRef(false);

  // Map a pointer's X to a day-column index (0..6), clamped to the grid.
  function pointerDayIndex(clientX: number, fallback: number): number {
    const grid = gridRef.current;
    if (!grid) return fallback;
    const rect = grid.getBoundingClientRect();
    const colW = (rect.width - TIME_COL_PX) / 7;
    const idx = Math.floor((clientX - rect.left - TIME_COL_PX) / colW);
    return Math.max(0, Math.min(6, idx));
  }

  // Window-level pointer listeners, registered once. They drive the live drag
  // preview and commit on release. Reading everything through refs keeps this
  // effect from re-subscribing on every render.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.pointerStart.x;
      const dy = e.clientY - d.pointerStart.y;
      const deltaMin = Math.round((dy / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
      const moved =
        d.moved || Math.abs(dx) > CLICK_SLOP_PX || Math.abs(dy) > CLICK_SLOP_PX;
      const { minHour, maxHour } = rangeRef.current;
      const dayMin = minHour * 60;
      const dayMax = maxHour * 60;

      let startMin = d.origStartMin;
      let endMin = d.origEndMin;
      let dayIndex = d.origDayIndex;

      if (d.mode === "move") {
        const dur = d.origEndMin - d.origStartMin;
        startMin = Math.max(dayMin, Math.min(d.origStartMin + deltaMin, dayMax - dur));
        endMin = startMin + dur;
        dayIndex = pointerDayIndex(e.clientX, d.origDayIndex);
      } else {
        // Resize the bottom edge only; keep at least a 15-minute block.
        endMin = Math.max(
          d.origStartMin + SNAP_MIN,
          Math.min(d.origEndMin + deltaMin, dayMax)
        );
      }

      const next = { ...d, moved, startMin, endMin, dayIndex };
      dragRef.current = next;
      setDrag(next);
    }

    function onUp() {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDrag(null);
      if (!d.moved) {
        // No real movement → treat as a plain click to edit.
        onOccClickRef.current(d.occ);
        return;
      }
      suppressClickRef.current = true;
      const day = daysRef.current[d.dayIndex];
      const start = dateAtDayMinute(day, d.startMin);
      const end = dateAtDayMinute(day, d.endMin);
      onCommitRef.current(d.occ, start, end);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // Mount-once: everything variable is read through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDrag(
    e: React.PointerEvent,
    occ: EventOccurrence,
    mode: "move" | "resize"
  ) {
    e.preventDefault();
    e.stopPropagation();
    const startMin = minutesOfDay(occ.start);
    const endMin = Math.max(minutesOfDay(occ.end), startMin + SNAP_MIN);
    const dayIndex = Math.max(
      0,
      days.findIndex((d) => isSameDay(d, occ.start))
    );
    const state: DragState = {
      occ,
      mode,
      pointerStart: { x: e.clientX, y: e.clientY },
      origStartMin: startMin,
      origEndMin: endMin,
      origDayIndex: dayIndex,
      dayIndex,
      startMin,
      endMin,
      moved: false,
    };
    dragRef.current = state;
    setDrag(state);
  }

  // Effective screen position for an occurrence: its live drag preview if it's
  // the one being dragged, otherwise its natural day/time.
  function effectivePos(occ: EventOccurrence): {
    dayIndex: number;
    startMin: number;
    endMin: number;
  } {
    if (drag && drag.occ.key === occ.key) {
      return { dayIndex: drag.dayIndex, startMin: drag.startMin, endMin: drag.endMin };
    }
    const startMin = minutesOfDay(occ.start);
    return {
      dayIndex: Math.max(0, days.findIndex((d) => isSameDay(d, occ.start))),
      startMin,
      endMin: Math.max(minutesOfDay(occ.end), startMin + SNAP_MIN),
    };
  }

  // --- Study-block move drag (self-contained, move-only) ---------------------
  const [studyDrag, setStudyDrag] = useState<StudyDragState | null>(null);
  const studyDragRef = useRef<StudyDragState | null>(null);
  const onStudyMoveRef = useRef(onStudyMove);
  onStudyMoveRef.current = onStudyMove;
  const onNeedsInputRef = useRef(onNeedsInput);
  onNeedsInputRef.current = onNeedsInput;

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = studyDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.pointerStart.x;
      const dy = e.clientY - d.pointerStart.y;
      const deltaMin = Math.round(((dy / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
      const moved =
        d.moved || Math.abs(dx) > CLICK_SLOP_PX || Math.abs(dy) > CLICK_SLOP_PX;
      const { minHour, maxHour } = rangeRef.current;
      const dayMin = minHour * 60;
      const dayMax = maxHour * 60;
      const dur = d.origEndMin - d.origStartMin;
      const startMin = Math.max(dayMin, Math.min(d.origStartMin + deltaMin, dayMax - dur));
      const next: StudyDragState = {
        ...d,
        moved,
        startMin,
        endMin: startMin + dur,
        dayIndex: pointerDayIndex(e.clientX, d.origDayIndex),
      };
      studyDragRef.current = next;
      setStudyDrag(next);
    }
    function onUp() {
      const d = studyDragRef.current;
      if (!d) return;
      studyDragRef.current = null;
      setStudyDrag(null);
      if (!d.moved) {
        // A click (no move): if it's a needs-input placeholder, ask the question.
        if (d.block.state === "needs_input") onNeedsInputRef.current(d.block);
        return;
      }
      const day = daysRef.current[d.dayIndex];
      onStudyMoveRef.current(
        d.block.id,
        dateAtDayMinute(day, d.startMin),
        dateAtDayMinute(day, d.endMin)
      );
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startStudyDrag(e: React.PointerEvent, block: StudyBlockItem) {
    e.preventDefault();
    e.stopPropagation();
    const start = new Date(block.starts_at);
    const end = new Date(block.ends_at);
    const startMin = minutesOfDay(start);
    const endMin = Math.max(minutesOfDay(end), startMin + SNAP_MIN);
    const dayIndex = Math.max(0, days.findIndex((d) => isSameDay(d, start)));
    const state: StudyDragState = {
      block,
      pointerStart: { x: e.clientX, y: e.clientY },
      origStartMin: startMin,
      origEndMin: endMin,
      origDayIndex: dayIndex,
      dayIndex,
      startMin,
      endMin,
      moved: false,
    };
    studyDragRef.current = state;
    setStudyDrag(state);
  }

  // Effective column/time of a study block — its live drag preview if it's the
  // one being dragged, else its stored time. Lets a drag preview cross columns.
  function effectiveStudyPos(block: StudyBlockItem): {
    dayIndex: number;
    startMin: number;
    endMin: number;
  } {
    if (studyDrag && studyDrag.block.id === block.id) {
      return {
        dayIndex: studyDrag.dayIndex,
        startMin: studyDrag.startMin,
        endMin: studyDrag.endMin,
      };
    }
    const start = new Date(block.starts_at);
    const end = new Date(block.ends_at);
    const startMin = minutesOfDay(start);
    return {
      dayIndex: Math.max(0, days.findIndex((d) => isSameDay(d, start))),
      startMin,
      endMin: Math.max(minutesOfDay(end), startMin + SNAP_MIN),
    };
  }

  // One shared hour range for the whole week so every column lines up. Include
  // the user's own occurrences so a late custom event isn't clipped off-grid.
  const userMaxEnd = userOccurrences.reduce(
    (m, o) => Math.max(m, minutesOfDay(o.end)),
    0
  );
  const { minHour, maxHour } = hourRange(
    perDay.flatMap((d) => d.timed),
    userMaxEnd
  );
  rangeRef.current = { minHour, maxHour };
  const totalHeight = (maxHour - minHour) * HOUR_PX;
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const hasAllDay = perDay.some((d) => d.allDay.length > 0);
  const gridCols = `${TIME_COL_PX}px repeat(7, minmax(0, 1fr))`;

  // Convert minutes-from-midnight into a vertical pixel offset on the grid.
  const yFor = (min: number) => ((min - minHour * 60) / 60) * HOUR_PX;

  // On load, scroll so the view starts ~1 hour before today's earliest item
  // (or 8 AM if the day is empty). Runs once on mount.
  useEffect(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;

    const todayCol = perDay.find((d) => isSameDay(d.day, today));
    const earliest =
      todayCol && todayCol.timed.length > 0
        ? Math.min(...todayCol.timed.map((b) => b.startMin))
        : null;
    const targetHour =
      earliest != null
        ? Math.min(maxHour - 1, Math.max(minHour, Math.floor(earliest / 60) - 1))
        : 8;

    const gridTopInScroll =
      grid.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const headerH = headerRef.current?.offsetHeight ?? 0;
    const targetY = gridTopInScroll + GRID_PAD_TOP + yFor(targetHour * 60);
    scroller.scrollTop = Math.max(0, targetY - headerH - 8);
    // Mount-only: this is the initial scroll position on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Turn a click on empty column space into a "create event" at that time.
  function handleColumnClick(e: React.MouseEvent, day: Date) {
    // Swallow the click that trails a drag drop.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = minHour * 60 + Math.floor((y / HOUR_PX) * 60);
    const snapped = Math.floor(min / 30) * 30; // snap to the half hour
    const clamped = Math.max(minHour * 60, Math.min(snapped, maxHour * 60 - 60));
    onSlotClick(day, clamped);
  }

  return (
    <div className="no-scrollbar h-full w-full overflow-x-auto">
      <div className="flex h-full min-h-[320px] w-full min-w-[720px] flex-col overflow-hidden rounded-lg border bg-card">
        <div
          ref={scrollRef}
          className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
        >
          {/* Day headers (sticky) */}
          <div
            ref={headerRef}
            className="sticky top-0 z-20 grid border-b bg-card"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="border-r" />
            {days.map((day, dayIdx) => {
              const isToday = isSameDay(day, today);
              // This day's Canvas assignments, earliest first (deterministic).
              const dayDue = assignments
                .filter((a) => a.due_at && isSameDay(new Date(a.due_at), day))
                .sort(
                  (a, b) =>
                    new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime()
                )
                .map((a) => ({
                  id: a.id,
                  title: a.title,
                  href: a.html_url,
                  at: a.due_at!,
                  submitted: a.submitted,
                  graded: a.graded,
                }));
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "relative border-r px-2 py-1.5 text-center last:border-r-0",
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
                  <DayDueDropdown
                    items={dayDue}
                    align={dayIdx === days.length - 1 ? "end" : "center"}
                  />
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
                    {allDay.map((e) => {
                      const isGoogle = e.source === "google";
                      const gStyle: React.CSSProperties | undefined =
                        isGoogle && e.google_color
                          ? {
                              borderLeftColor: e.google_color,
                              backgroundColor: hexToRgba(e.google_color, 0.16),
                            }
                          : undefined;
                      return (
                        <div
                          key={e.id}
                          onClick={
                            isGoogle ? () => onGoogleEventClick(e) : undefined
                          }
                          className={cn(
                            "flex items-center gap-0.5 truncate rounded border-l-2 px-1 py-0.5 text-[11px]",
                            isGoogle
                              ? "cursor-pointer border-l-4 text-foreground/90"
                              : "border-blue-500 bg-blue-500/10"
                          )}
                          style={gStyle}
                          title={
                            isGoogle
                              ? `${e.title} — from Google Calendar (read-only)`
                              : e.title
                          }
                        >
                          {isGoogle && <GoogleMark />}
                          {isGoogle ? (
                            <span className="truncate">{e.title}</span>
                          ) : (
                            <ItemLink href={e.html_url}>{e.title}</ItemLink>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Time grid */}
          <div
            ref={gridRef}
            className="grid"
            style={{
              gridTemplateColumns: gridCols,
              paddingTop: GRID_PAD_TOP,
            }}
          >
            {/* Left time axis */}
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
            {perDay.map(({ day, timed }, dayIndex) => {
              const isToday = isSameDay(day, today);

              // The user's own occurrences that currently sit in THIS column
              // (accounting for a live drag that may have moved one here).
              const columnUserBlocks: UserBlock[] = userOccurrences
                .map((occ) => ({ occ, ...effectivePos(occ) }))
                .filter((b) => b.dayIndex === dayIndex)
                .map(({ occ, startMin, endMin }) => ({ occ, startMin, endMin }));

              // Lay the read-only Canvas items AND the user's events out in ONE
              // pass, so anything overlapping in time splits the column width
              // side-by-side (Google-Calendar style) instead of stacking. Each
              // block still renders with its own layer's styling/interactivity.
              const placed = layoutOverlaps<ColumnBlock>([
                ...timed.map(
                  (b): ColumnBlock => ({
                    key: `ro-${b.id}`,
                    layer: "readonly",
                    startMin: b.startMin,
                    endMin: b.endMin,
                    block: b,
                  })
                ),
                ...columnUserBlocks.map(
                  (u): ColumnBlock => ({
                    key: u.occ.key,
                    layer: "user",
                    startMin: u.startMin,
                    endMin: u.endMin,
                    occ: u.occ,
                  })
                ),
              ]);

              return (
                <div
                  key={day.toISOString()}
                  onClick={(e) => handleColumnClick(e, day)}
                  className={cn(
                    "relative border-r last:border-r-0",
                    isToday && "bg-primary/5"
                  )}
                  style={{
                    height: totalHeight,
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                  }}
                >
                  {isToday && <NowLine minHour={minHour} maxHour={maxHour} />}

                  {/* Every block in this column — read-only Canvas items and the
                      user's own events — placed by the SAME overlap layout, so
                      overlapping times sit side-by-side. Each renders with its
                      own layer's look and interactivity. */}
                  {placed.map((item) => {
                    const blockTop = Math.max(0, yFor(item.startMin));
                    const height = Math.max(
                      MIN_BLOCK_PX,
                      Math.min(
                        yFor(item.endMin) - blockTop,
                        totalHeight - blockTop
                      )
                    );
                    const widthPct = 100 / item.laneCount;
                    const left = `calc(${item.lane * widthPct}% + 2px)`;
                    const width = `calc(${widthPct}% - 4px)`;

                    // Read-only Canvas assignment / class event (not interactive).
                    if (item.layer === "readonly") {
                      const b = item.block;
                      const isAssignment = b.kind === "assignment";
                      const isGoogle = b.google === true;
                      // Google events render in their real Google colour as a
                      // solid left edge + a subtle tint, with theme-token TEXT so
                      // contrast is guaranteed in light/dark/hyper-focus.
                      const googleStyle: React.CSSProperties | undefined =
                        isGoogle && b.googleColor
                          ? {
                              borderLeftColor: b.googleColor,
                              backgroundColor: hexToRgba(b.googleColor, 0.16),
                            }
                          : undefined;
                      return (
                        <div
                          key={item.key}
                          // Google → open the read-only detail view. Canvas items
                          // aren't interactive; swallow so they don't open the
                          // "new event" dialog.
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isGoogle && b.googleEvent) {
                              onGoogleEventClick(b.googleEvent);
                            }
                          }}
                          className={cn(
                            // Tight horizontal padding so narrow (split) blocks
                            // fit more characters per line.
                            "absolute overflow-hidden rounded-md px-1 py-0.5 text-[11px] leading-tight",
                            isAssignment
                              ? "border-l-4 border-amber-500 bg-amber-500/15 text-amber-950 shadow-sm dark:text-amber-100 hyper-focus:bg-amber-500/25 hyper-focus:text-amber-100"
                              : isGoogle
                                ? // Google: real colour via inline style below; a
                                  // solid-but-thin left edge + theme-token text.
                                  "cursor-pointer border-l-4 text-foreground/90 shadow-sm"
                                : "border-l-2 border-blue-300 bg-blue-500/5 text-blue-800/80 dark:border-blue-400/40 dark:text-blue-200/70 hyper-focus:text-blue-200/80"
                          )}
                          style={{ top: blockTop, height, left, width, ...googleStyle }}
                          title={
                            isGoogle
                              ? `${b.title} — from Google Calendar (read-only)`
                              : `${b.title} — ${b.subtitle}`
                          }
                        >
                          <div className="flex items-start gap-0.5">
                            {isGoogle && <GoogleMark />}
                            <div
                              className={cn(
                                // Wrap the title over up to 2 lines (clipped to
                                // the block height) instead of truncating on one
                                // line, so thin split blocks stay readable. The
                                // marker sits OUTSIDE this -webkit-box clamp (a
                                // flex sibling) so it actually renders.
                                "min-w-0 line-clamp-2 break-words",
                                isAssignment ? "font-semibold" : "font-normal"
                              )}
                            >
                              {isGoogle ? (
                                b.title
                              ) : (
                                <ItemLink href={b.href}>{b.title}</ItemLink>
                              )}
                            </div>
                          </div>
                          {height > 34 && (
                            <div
                              className={cn(
                                "truncate",
                                isAssignment
                                  ? "text-amber-800/80 dark:text-amber-200/70 hyper-focus:text-amber-200/80"
                                  : "text-muted-foreground"
                              )}
                            >
                              {b.subtitle}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // The user's own event — interactive (click, move, resize).
                    const occ = item.occ;
                    const isDragging = drag?.occ.key === occ.key;
                    return (
                      <div
                        key={item.key}
                        onPointerDown={(e) => startDrag(e, occ, "move")}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          // Tight horizontal padding so narrow (split) blocks
                          // fit more characters per line.
                          "group absolute cursor-grab touch-none select-none overflow-hidden rounded-md border-l-4 px-1 py-0.5 text-[11px] leading-tight shadow-sm",
                          colorStyle(occ.color).block,
                          isDragging &&
                            "z-40 cursor-grabbing opacity-90 shadow-lg ring-2 ring-foreground/30"
                        )}
                        style={{ top: blockTop, height, left, width }}
                        title={`${occ.title} — drag to move, drag the bottom edge to resize`}
                      >
                        {/* Wrap the title over up to 2 lines instead of a single
                            truncated line, so thin split blocks stay readable. */}
                        <div className="line-clamp-2 break-words font-medium">
                          {occ.title}
                        </div>
                        {height > 34 && (
                          <div className="truncate opacity-80">
                            {formatMinutes(item.startMin)}–
                            {formatMinutes(item.endMin)}
                          </div>
                        )}
                        {/* Bottom-edge resize handle. */}
                        <div
                          onPointerDown={(e) => startDrag(e, occ, "resize")}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        />
                      </div>
                    );
                  })}

                  {/* Exam markers — read-only red pins at the test time. */}
                  {exams
                    .filter((e) => isSameDay(new Date(e.exam_at), day))
                    .map((e) => {
                      const top = Math.max(0, yFor(minutesOfDay(new Date(e.exam_at))));
                      return (
                        <div
                          key={`ex-${e.id}`}
                          onClick={(evt) => evt.stopPropagation()}
                          className="pointer-events-none absolute inset-x-1 z-20 truncate rounded border-l-4 border-red-500 bg-red-500/15 px-1 py-0.5 text-[10px] font-semibold text-red-900 shadow-sm dark:text-red-100 hyper-focus:text-red-100"
                          style={{ top }}
                          title={`Exam: ${e.title}`}
                        >
                          Test · {e.title}
                        </div>
                      );
                    })}

                  {/* Study blocks — the scheduler's output. A distinct violet,
                      draggable (move-only, accepted silently), with three-state
                      cues: scheduled (solid), reserved (dashed/faded), needs_input
                      (amber dashed, click to answer one question). Placed in free
                      time, so full width is safe. */}
                  {studyBlocks
                    .map((b) => ({ b, ...effectiveStudyPos(b) }))
                    .filter((x) => x.dayIndex === dayIndex)
                    .map(({ b, startMin, endMin }) => {
                      const top = Math.max(0, yFor(startMin));
                      const h = Math.max(
                        MIN_BLOCK_PX,
                        Math.min(yFor(endMin) - top, totalHeight - top)
                      );
                      const dragging = studyDrag?.block.id === b.id;
                      const needs = b.state === "needs_input";
                      const reserved = b.state === "reserved";
                      return (
                        <div
                          key={`sb-${b.id}`}
                          onPointerDown={(e) => startStudyDrag(e, b)}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            // The animated, slowly colour-shifting gradient BORDER
                            // (study-border / study-border-needs, see globals.css)
                            // is the "the system placed this" signal — subtle and
                            // slow, and disabled under prefers-reduced-motion.
                            "group absolute z-30 cursor-grab touch-none select-none overflow-hidden rounded-md px-1 py-0.5 text-[11px] leading-tight shadow-sm",
                            needs
                              ? "study-border-needs text-amber-950 dark:text-amber-100 hyper-focus:text-amber-100"
                              : "study-border text-violet-950 dark:text-violet-100 hyper-focus:text-violet-100",
                            reserved && "opacity-80",
                            dragging &&
                              "z-40 cursor-grabbing shadow-lg ring-2 ring-foreground/30"
                          )}
                          style={{ top, height: h, left: "2px", width: "calc(100% - 6px)" }}
                          title={b.reason ?? studyLabel(b)}
                        >
                          <div className="flex items-center gap-1 font-medium">
                            <GraduationCap className="size-3 shrink-0" />
                            <span className="line-clamp-2 break-words">
                              {studyLabel(b)}
                            </span>
                          </div>
                          {h > 34 && (
                            <div className="truncate opacity-80">
                              {formatMinutes(startMin)}–{formatMinutes(endMin)}
                            </div>
                          )}
                        </div>
                      );
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

// A thin red line marking the current time on today's column. The current time
// is read on the CLIENT after mount (not during server render, which would
// mismatch and warn on hydration) and ticks on a timer so the line advances on
// its own without a page reload.
function NowLine({ minHour, maxHour }: { minHour: number; maxHour: number }) {
  // null until mounted → nothing renders on the server / first paint, so the
  // server and client trees match.
  const [nowMin, setNowMin] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNowMin(minutesOfDay(new Date()));
    tick(); // set immediately on mount
    // Update every 30s so the line keeps up as minutes pass, then clean up.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (nowMin === null) return null;
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
  userEvents,
  overrides,
  onGoogleEventClick,
  exams,
  studyBlocks,
  onNeedsInput,
}: {
  anchor: Date;
  today: Date;
  assignments: AssignmentItem[];
  events: ClassEventItem[];
  userEvents: UserEventRow[];
  overrides: OverrideRow[];
  onGoogleEventClick: (event: ClassEventItem) => void;
  exams: ExamItem[];
  studyBlocks: StudyBlockItem[];
  onNeedsInput: (block: StudyBlockItem) => void;
}) {
  const weeks = monthGrid(anchor.getFullYear(), anchor.getMonth());
  const currentMonth = anchor.getMonth();

  // Expand the user's own events across the whole visible month grid once.
  const allDays = weeks.flat();
  const userOccurrences = expandOccurrencesForRange(
    userEvents,
    overrides,
    startOfDay(allDays[0]),
    addDays(startOfDay(allDays[allDays.length - 1]), 1)
  );

  return (
    <div className="no-scrollbar h-full overflow-auto">
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
            const dayUser = userOccurrences.filter((o) =>
              isSameDay(o.start, day)
            );
            const dayStudy = studyBlocks.filter((s) =>
              isSameDay(new Date(s.starts_at), day)
            );
            const dayExams = exams.filter((e) =>
              isSameDay(new Date(e.exam_at), day)
            );

            const extra =
              dayEvents.length +
              dayAssignments.length +
              dayUser.length +
              dayStudy.length +
              dayExams.length -
              4;

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
                  {dayExams.slice(0, 1).map((e) => (
                    <span
                      key={`ex-${e.id}`}
                      className="truncate rounded border-l-2 border-red-500 bg-red-500/10 px-1 py-0.5 text-[10px] font-semibold leading-tight text-red-700 dark:text-red-300 hyper-focus:text-red-200"
                      title={`Exam: ${e.title}`}
                    >
                      Test · {e.title}
                    </span>
                  ))}
                  {dayStudy.slice(0, 2).map((s) => (
                    <StudyChip key={`sb-${s.id}`} block={s} onNeedsInput={onNeedsInput} />
                  ))}
                  {dayUser.slice(0, 2).map((o) => (
                    <UserChip key={o.key} color={o.color} label={o.title} />
                  ))}
                  {dayAssignments.slice(0, 2).map((a) => (
                    <MiniChip key={a.id} color="amber" label={a.title} />
                  ))}
                  {dayEvents.slice(0, 1).map((e) =>
                    e.source === "google" ? (
                      <MiniChip
                        key={e.id}
                        color="blue"
                        google
                        googleColor={e.google_color}
                        label={e.title}
                        onClick={() => onGoogleEventClick(e)}
                      />
                    ) : (
                      <MiniChip key={e.id} color="blue" label={e.title} />
                    )
                  )}
                  {extra > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{extra} more
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

// A tiny, understated "G" badge marking an event as sourced from Google Calendar
// (and therefore read-only here). Theme-token colours so it reads in light,
// dark, and hyper-focus. Decorative — the surrounding element carries the label.
function GoogleMark() {
  return (
    <span
      aria-hidden
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground/40 align-middle text-[8px] font-bold leading-none text-muted-foreground"
    >
      G
    </span>
  );
}

function MiniChip({
  color,
  label,
  google,
  googleColor,
  onClick,
}: {
  color: "blue" | "amber";
  label: string;
  // Google-sourced (read-only): the event's real Google colour as a tint + a
  // solid left edge, theme-token text, and the G mark. Clickable → detail view.
  google?: boolean;
  googleColor?: string | null;
  onClick?: () => void;
}) {
  const gStyle: React.CSSProperties | undefined =
    google && googleColor
      ? {
          borderLeftColor: googleColor,
          backgroundColor: hexToRgba(googleColor, 0.16),
        }
      : undefined;
  return (
    <span
      onClick={onClick}
      className={cn(
        "flex items-center gap-0.5 truncate rounded px-1 py-0.5 text-[10px] leading-tight",
        google
          ? "cursor-pointer border-l-2 text-foreground/90"
          : color === "blue"
            ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 hyper-focus:text-blue-200"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hyper-focus:text-amber-200"
      )}
      style={gStyle}
      title={google ? `${label} — from Google Calendar (read-only)` : label}
    >
      {google && <GoogleMark />}
      <span className="truncate">{label}</span>
    </span>
  );
}

// Plain-language label for a system-placed study block: "Study for <exam>" for
// exam prep, "Do <assignment> assignment" for assignment work, and a set-type
// prompt for needs-input placeholders.
function studyLabel(b: StudyBlockItem): string {
  if (b.state === "needs_input") return `${b.title} — set type`;
  if (b.source_kind === "exam") return `Study for ${b.title}`;
  return `Do ${b.title} assignment`;
}

// A month-view chip for a scheduler study block: distinct violet (or amber
// dashed for needs-input), with the study icon. needs-input chips are clickable
// to answer the one question; the rest are read-only in month view.
function StudyChip({
  block,
  onNeedsInput,
}: {
  block: StudyBlockItem;
  onNeedsInput: (block: StudyBlockItem) => void;
}) {
  const needs = block.state === "needs_input";
  return (
    <span
      onClick={needs ? () => onNeedsInput(block) : undefined}
      className={cn(
        "flex items-center gap-0.5 truncate rounded border-l-2 px-1 py-0.5 text-[10px] leading-tight",
        needs
          ? "cursor-pointer border-dashed border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 hyper-focus:text-amber-200"
          : "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300 hyper-focus:text-violet-200",
        block.state === "reserved" && "border-dashed opacity-80"
      )}
      title={block.reason ?? studyLabel(block)}
    >
      <GraduationCap className="size-3 shrink-0" />
      <span className="truncate">{studyLabel(block)}</span>
    </span>
  );
}

// A month-view chip for one of the user's own events, tinted with its colour.
function UserChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className={cn(
        "truncate rounded border-l-2 px-1 py-0.5 text-[10px] leading-tight",
        colorStyle(color).block
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

// Minutes since midnight for a local Date (e.g. 9:30am -> 570).
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// A local Date at `min` minutes past midnight on `day`. Used to turn a dragged
// block's grid position back into a concrete instant to store.
function dateAtDayMinute(day: Date, min: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(min);
  return d;
}

// A Canvas "all-day" event has no meaningful clock time.
function isAllDay(e: ClassEventItem): boolean {
  if (!e.start_at) return false;
  if (minutesOfDay(new Date(e.start_at)) !== 0) return false;
  if (!e.end_at) return true;
  return minutesOfDay(new Date(e.end_at)) === 0;
}

// The visible hour range. The day always starts at 1 AM; the end stretches to
// cover the latest item (with a daytime minimum) so we don't render empty hours.
const DAY_START_HOUR = 1;

function hourRange(
  blocks: GridBlock[],
  extraMaxMin = 0
): { minHour: number; maxHour: number } {
  let max = extraMaxMin;
  for (const b of blocks) max = Math.max(max, b.endMin);
  if (blocks.length === 0 && extraMaxMin === 0) {
    return { minHour: DAY_START_HOUR, maxHour: 21 };
  }
  const maxHour = Math.min(
    24,
    Math.max(DAY_START_HOUR + 8, Math.ceil(max / 60))
  );
  return { minHour: DAY_START_HOUR, maxHour };
}

// "8 AM", "12 PM", "11 PM" for an hour number 0..23.
function formatHour(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

// "9:00 AM" from minutes-since-midnight.
function formatMinutes(min: number): string {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// --- form <-> payload helpers ------------------------------------------------

// "HH:MM" from minutes-since-midnight (for the time inputs).
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Build a local ISO instant from a date + "HH:MM" (client-local wall clock, so
// the stored instant matches what the user picked regardless of server tz).
function isoFromDateTime(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

// Turn the dialog's form values into the payload the server actions expect.
function payloadFromForm(v: EventFormValues): EventPayload {
  if (v.isRecurring) {
    return {
      title: v.title,
      color: v.color,
      isRecurring: true,
      startsAt: null,
      endsAt: null,
      weekdays: v.weekdays,
      startMinute: timeToMin(v.startTime),
      endMinute: timeToMin(v.endTime),
      seriesStartDate: v.date,
    };
  }
  return {
    title: v.title,
    color: v.color,
    isRecurring: false,
    startsAt: isoFromDateTime(v.date, v.startTime),
    endsAt: isoFromDateTime(v.date, v.endTime),
    weekdays: [],
    startMinute: null,
    endMinute: null,
    seriesStartDate: null,
  };
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// A local optimistic user_events row from a payload (mirrors the server's
// toEventRow, so the block renders identically before the round-trip returns).
function rowFromPayload(id: string, p: EventPayload): UserEventRow {
  return {
    id,
    title: p.title.trim() || "Untitled",
    color: p.color,
    is_recurring: p.isRecurring,
    starts_at: p.isRecurring ? null : p.startsAt,
    ends_at: p.isRecurring ? null : p.endsAt,
    weekdays: p.isRecurring ? p.weekdays : [],
    start_minute: p.isRecurring ? p.startMinute : null,
    end_minute: p.isRecurring ? p.endMinute : null,
    series_start_date: p.isRecurring ? p.seriesStartDate : null,
  };
}

// A throwaway client id for optimistic rows before the DB assigns the real one.
function tempId_(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tmp-${crypto.randomUUID()}`;
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
