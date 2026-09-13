"use client";

// ============================================================================
// EVENT DIALOG — the create / edit / delete form for the user's OWN events
//
// A small custom modal (we don't have a shadcn Dialog installed). It only ever
// edits the user's own events — Canvas assignments and synced class events are
// read-only and never reach this form.
//
// Recurring events get a plain either/or scope choice: "This event" (edits just
// the one occurrence as an override) or "Whole series" (edits the master). That
// is deliberately NOT a "this and all future" mode — see the Phase 2 scope
// fence. Dragging/resizing on the grid is always per-occurrence and silent.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENT_COLORS, colorStyle, type EventColor } from "@/lib/event-colors";
import { PICKER_ICON } from "@/lib/input-styles";
import { cn } from "@/lib/utils";

// Fallback in case `animationend` never fires (e.g. a backgrounded tab): a bit
// longer than the exit duration below so the animation normally wins the race.
const CLOSE_FALLBACK_MS = 320;

// Users who ask for less motion get instant open/close, no animation.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Sunday-first weekday chips (matching the Sunday-first calendar week). The
// value stored/emitted is still 0=Sun..6=Sat; only the display order changed.
const WEEKDAY_CHIPS: { value: number; label: string }[] = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

// The editable fields the form collects.
export type EventFormValues = {
  title: string;
  color: EventColor;
  date: string; // YYYY-MM-DD (single event's date, or a recurring occurrence's day)
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  isRecurring: boolean;
  weekdays: number[]; // 0=Sun..6=Sat
};

// Which existing event (if any) this dialog is editing.
export type EditTarget = {
  eventId: string;
  isRecurring: boolean;
  occurrenceDate: string | null; // the pattern date, for a recurring occurrence
};

export type EventScope = "occurrence" | "series";

export function EventDialog({
  initial,
  target,
  onSubmit,
  onDelete,
  onClose,
}: {
  initial: EventFormValues;
  // null → creating a new event; otherwise editing this target.
  target: EditTarget | null;
  onSubmit: (values: EventFormValues, scope: EventScope) => void;
  onDelete: (scope: EventScope) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<EventFormValues>(initial);
  // For a recurring event, whether the edit applies to just this occurrence or
  // the whole series. Ignored for single events / new events.
  const [scope, setScope] = useState<EventScope>("occurrence");
  // While true, the dialog plays its fade/scale-out before the real close runs.
  const [closing, setClosing] = useState(false);
  // The action to run once the exit animation finishes (unmount / submit /
  // delete). Held in a ref so the animationend handler and the fallback timer
  // both run it exactly once, with no open-state re-render in between.
  const pendingClose = useRef<(() => void) | null>(null);

  const isEditing = target != null;
  const editingRecurringOccurrence =
    isEditing && target.isRecurring && target.occurrenceDate != null;

  // Run the pending close action once. The exit animation (animationend) is the
  // normal trigger; a fallback timer covers the rare case it never fires.
  function finishClose() {
    const after = pendingClose.current;
    if (!after) return;
    pendingClose.current = null;
    after();
  }

  // Begin closing: flip to the exit animation and remember what to do when it
  // ends. We do NOT unmount on a timer — unmounting is driven by animationend so
  // the element never flips back to its open state for a frame (no flash).
  // Reduced motion (or a double-trigger) skips straight to the action.
  function requestClose(after: () => void) {
    if (closing) return;
    if (prefersReducedMotion()) {
      after();
      return;
    }
    pendingClose.current = after;
    setClosing(true);
    window.setTimeout(finishClose, CLOSE_FALLBACK_MS);
  }

  // Only the card's OWN exit animation should trigger the close (ignore any
  // animationend bubbling up from descendants).
  function handleCardAnimationEnd(e: React.AnimationEvent) {
    if (closing && e.target === e.currentTarget) finishClose();
  }

  // Close on Escape, like a native dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose(onClose);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // requestClose is stable enough for this listener; re-bind only if onClose
    // changes. (closing is read fresh via the setter guard above.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  function set<K extends keyof EventFormValues>(
    key: K,
    val: EventFormValues[K]
  ) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function toggleWeekday(day: number) {
    setValues((v) => ({
      ...v,
      weekdays: v.weekdays.includes(day)
        ? v.weekdays.filter((d) => d !== day)
        : [...v.weekdays, day].sort((a, b) => a - b),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A recurring event needs at least one weekday; otherwise treat as single.
    if (values.isRecurring && values.weekdays.length === 0) return;
    if (values.endTime <= values.startTime) return;
    requestClose(() => onSubmit(values, effectiveScope()));
  }

  // When editing a recurring OCCURRENCE, the scope toggle decides. In every
  // other case there is only one meaningful target, so pass "series" (which the
  // caller maps to updating/deleting the single master row).
  function effectiveScope(): EventScope {
    if (editingRecurringOccurrence) return scope;
    return "series";
  }

  const canSave =
    values.title.trim().length > 0 &&
    values.endTime > values.startTime &&
    (!values.isRecurring || values.weekdays.length > 0);

  return (
    // Backdrop — click outside the card to dismiss. Fades in on open and out on
    // close; motion-safe so reduced-motion users get no animation.
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",
        closing
          ? "motion-safe:animate-out motion-safe:fade-out-0 motion-safe:duration-150"
          : "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      )}
      // `forwards` holds the faded-out end state until React unmounts, so the
      // backdrop never snaps back to full opacity for a frame.
      style={closing ? { animationFillMode: "forwards" } : undefined}
      onClick={() => requestClose(onClose)}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-xl border bg-card p-5 shadow-xl",
          // A subtle fade + scale, the standard polished-modal feel.
          closing
            ? "motion-safe:animate-out motion-safe:fade-out-0 motion-safe:zoom-out-95 motion-safe:duration-150"
            : "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
        )}
        // Hold the scaled/faded end state until unmount (no flash-back), and let
        // this element's own animationend drive the actual close.
        style={closing ? { animationFillMode: "forwards" } : undefined}
        onAnimationEnd={handleCardAnimationEnd}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="mb-4 text-base font-semibold">
          {isEditing ? "Edit event" : "New event"}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              autoFocus
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Study group"
            />
          </div>

          {/* Date + times. Date gets its own full-width row so the value and
              the calendar icon are never clipped; the two times sit side by
              side with comfortable width. */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                type="date"
                className={PICKER_ICON}
                value={values.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-start">Start</Label>
                <Input
                  id="event-start"
                  type="time"
                  className={PICKER_ICON}
                  value={values.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-end">End</Label>
                <Input
                  id="event-end"
                  type="time"
                  className={PICKER_ICON}
                  value={values.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                />
              </div>
            </div>
            {values.endTime <= values.startTime && (
              <p className="text-xs text-destructive">
                End time must be after the start time.
              </p>
            )}
          </div>

          {/* Colour */}
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => set("color", c)}
                  className={cn(
                    "size-7 rounded-full ring-offset-2 ring-offset-card transition",
                    colorStyle(c).swatch,
                    values.color === c
                      ? "ring-2 ring-foreground"
                      : "ring-0 hover:opacity-80"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Repeat — hidden when editing a single occurrence of a series, since
              the weekday pattern belongs to the whole series, not one instance. */}
          {!editingRecurringOccurrence && (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={values.isRecurring}
                  onChange={(e) => set("isRecurring", e.target.checked)}
                />
                Repeat weekly
              </label>
              {values.isRecurring && (
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_CHIPS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleWeekday(d.value)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        values.weekdays.includes(d.value)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input hover:bg-accent"
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
              {values.isRecurring && values.weekdays.length === 0 && (
                <p className="text-xs text-destructive">
                  Pick at least one day to repeat on.
                </p>
              )}
            </div>
          )}

          {/* Scope — only when editing one occurrence of a recurring series. */}
          {editingRecurringOccurrence && (
            <div className="flex flex-col gap-1.5">
              <Label>Apply changes to</Label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setScope("occurrence")}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-xs",
                    scope === "occurrence"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input hover:bg-accent"
                  )}
                >
                  This event
                </button>
                <button
                  type="button"
                  onClick={() => setScope("series")}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-xs",
                    scope === "series"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input hover:bg-accent"
                  )}
                >
                  Whole series
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-1 flex items-center justify-between gap-2">
            {isEditing ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => requestClose(() => onDelete(effectiveScope()))}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => requestClose(onClose)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
