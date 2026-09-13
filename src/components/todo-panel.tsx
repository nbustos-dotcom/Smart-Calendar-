// ============================================================================
// TO-DO PANEL — a working, day-scoped to-do list (right rail)
//
// For the selected day it shows:
//   * that day's Canvas assignments as checkable rows (read from the assignment
//     data the dashboard already loaded — filtered by same local day, never
//     copied into a table). Ticking one writes assignment_done, so the read-only
//     assignment snapshot is never mutated.
//   * the user's own manual to-do items for that day (add / remove / check off).
//
// Prev/next day navigation moves the selected day. All state is per-user and
// persisted via the server actions in src/app/todo/actions.ts. Optimistic:
// local state updates immediately and reverts if a save fails.
// ============================================================================
"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, PanelRightClose, Plus } from "lucide-react";
import { addDays, isSameDay } from "@/lib/calendar";
import type { AssignmentItem } from "@/lib/types";
import type { TodoItemRow } from "@/lib/todo";
import {
  addTodoItemAction,
  removeTodoItemAction,
  setTodoItemDoneAction,
  setAssignmentDoneAction,
} from "@/app/todo/actions";
import { PICKER_ICON } from "@/lib/input-styles";
import { cn } from "@/lib/utils";

// Lean, bare icon-button styling shared by the card's arrows (collapse +
// day nav). No border/background "bubble" — just the icon, with generous
// padding so the click/tap target is comfortably larger than the icon itself
// while the glyph stays its normal size.
const ICON_BUTTON =
  "inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground";

// Local YYYY-MM-DD for a Date (matches how the migration stores todo_items.day).
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// "HH:MM" (24h) -> friendly local time, e.g. "9:00 AM".
function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function tempId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tmp-${crypto.randomUUID()}`;
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function TodoPanel({
  assignments,
  todoItems,
  doneAssignmentIds,
}: {
  assignments: AssignmentItem[];
  todoItems: TodoItemRow[];
  doneAssignmentIds: number[];
}) {
  // Start collapsed so the calendar has the full width by default.
  const [collapsed, setCollapsed] = useState(true);
  const [day, setDay] = useState<Date>(() => new Date());

  // Optimistic local state, seeded ONCE from the server props.
  const [items, setItems] = useState<TodoItemRow[]>(() => todoItems);
  const [doneIds, setDoneIds] = useState<Set<number>>(
    () => new Set(doneAssignmentIds)
  );
  const [draft, setDraft] = useState("");
  const [draftTime, setDraftTime] = useState(""); // optional "HH:MM", blank = none
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const dayKey = ymd(day);

  // The selected day's assignments (filtered by local day) + manual items.
  const dayAssignments = assignments
    .filter((a) => a.due_at && isSameDay(new Date(a.due_at), day))
    .sort(
      (a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime()
    );
  // Manual items for this day: timed ones first (sorted by time), untimed below.
  // Zero-padded "HH:MM" sorts chronologically as plain strings.
  const dayItems = items
    .filter((i) => i.day === dayKey)
    .sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0; // both untimed → keep insertion order (stable sort)
    });

  // --- mutations (optimistic + revert on failure) ----------------------------

  async function toggleAssignment(canvasId: number, nextDone: boolean) {
    const prev = doneIds;
    setDoneIds((s) => {
      const n = new Set(s);
      if (nextDone) n.add(canvasId);
      else n.delete(canvasId);
      return n;
    });
    const res = await setAssignmentDoneAction(canvasId, nextDone);
    if (!res.ok) {
      setDoneIds(prev);
      setError("Couldn’t save that — it’s been put back.");
    }
  }

  async function toggleItem(id: string, nextDone: boolean) {
    const prev = items;
    setItems((list) =>
      list.map((i) => (i.id === id ? { ...i, done: nextDone } : i))
    );
    const res = await setTodoItemDoneAction(id, nextDone);
    if (!res.ok) {
      setItems(prev);
      setError("Couldn’t save that — it’s been put back.");
    }
  }

  async function removeItem(id: string) {
    const prev = items;
    setItems((list) => list.filter((i) => i.id !== id));
    const res = await removeTodoItemAction(id);
    if (!res.ok) {
      setItems(prev);
      setError("Couldn’t remove that — it’s been restored.");
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const time = draftTime.trim() || null;
    setDraft("");
    setDraftTime("");
    const id = tempId();
    setItems((list) => [...list, { id, day: dayKey, text, time, done: false }]);

    const res = await addTodoItemAction(dayKey, text, time);
    if (!res.ok) {
      setItems((list) => list.filter((i) => i.id !== id));
      setError("Couldn’t add that item — nothing was saved.");
      return;
    }
    if (res.id) {
      const realId = res.id;
      setItems((list) =>
        list.map((i) => (i.id === id ? { ...i, id: realId } : i))
      );
    }
  }

  // Esc collapses the panel when it's open — but not while a modal dialog is
  // up (the event dialog owns Escape then), so we don't collapse out from
  // under it.
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      setCollapsed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed]);

  // --- one panel that opens like a simple drawer -----------------------------
  // Deliberately NOT an early return: the same container stays mounted in both
  // states so open/close can animate. The expand is plain and standard — the
  // container's width animates open while the expanded content fades in and the
  // collapsed sideways label cross-fades out. No rotation, no moving title.
  // When collapsed the WHOLE rail is a single button that expands it.

  const isTodaySelected = isSameDay(day, today);
  const isTomorrow = isSameDay(day, addDays(today, 1));
  const relLabel = isTodaySelected
    ? "Today"
    : isTomorrow
      ? "Tomorrow"
      : day.toLocaleDateString(undefined, { weekday: "long" });

  // Props that turn the collapsed bar into one big expand button. Spread only
  // while collapsed; the expanded panel is a plain container.
  const barProps = collapsed
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": "Expand to-do list",
        onClick: () => setCollapsed(false),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(false);
          }
        },
      }
    : {};

  return (
    <div
      {...barProps}
      className={cn(
        // min-h-12 gives the collapsed mobile bar its height (its content is
        // absolute / hidden then); on xl the rail is stretched full-height.
        "group relative flex h-full min-h-12 w-full flex-col overflow-hidden rounded-xl border bg-card outline-none",
        // Width is the one layout property we animate (the panel "widening");
        // box-shadow/border animate for the collapsed hover glow. Body content
        // is pinned to the expanded width below so it is revealed, not
        // re-laid-out, each frame.
        "transition-[width,box-shadow,border-color] duration-300 ease-out motion-reduce:transition-none",
        collapsed
          ? // Collapsed: a clickable tab with a soft, theme-appropriate border
            // glow on hover (the --ring token is blue in hyper-focus, neutral in
            // light/dark). Keyboard focus gets a crisp ring.
            "cursor-pointer hover:border-ring hover:shadow-[0_0_16px_-3px_var(--color-ring)] focus-visible:ring-2 focus-visible:ring-ring xl:w-12"
          : "xl:w-80"
      )}
    >
      {/* Collapsed rail label: static, sideways "To-Do" — no rotation, it just
          sits there. Cross-fades with the expanded header as the panel opens.
          On a narrow screen the collapsed bar is a short horizontal strip, so
          the label stays horizontal there (vertical only on the xl rail). */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "opacity-100" : "opacity-0"
        )}
      >
        <span className="text-sm font-semibold tracking-tight text-muted-foreground group-hover:text-foreground xl:[writing-mode:vertical-rl]">
          To-Do
        </span>
      </div>

      {/* A hint chevron at the foot of the collapsed vertical rail (xl only);
          fades out on expand. */}
      <ChevronLeft
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-3 left-1/2 hidden size-4 -translate-x-1/2 text-muted-foreground transition-opacity duration-200 group-hover:text-foreground motion-reduce:transition-none xl:block",
          collapsed ? "opacity-100" : "opacity-0"
        )}
      />

      {/* EXPANDED CONTENT — header (horizontal title + day nav + collapse) plus
          the lists and add-item form. Pinned to the expanded width (xl:w-80) so
          the width animation reveals it rather than re-wrapping text each frame;
          fades in as the panel opens. Inert + hidden while collapsed so the slim
          rail stays clean and nothing behind it is tab-reachable. */}
      <div
        inert={collapsed ? true : undefined}
        className={cn(
          "min-h-0 flex-1 flex-col transition-opacity duration-200 ease-out motion-reduce:transition-none xl:w-80",
          collapsed ? "hidden opacity-0 xl:flex" : "flex opacity-100"
        )}
      >
        {/* Header: title on the left, day nav + collapse on the right. */}
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
          <h2 className="shrink-0 px-1 text-sm font-semibold tracking-tight">
            To-Do
          </h2>
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setDay((d) => addDays(d, -1))}
              aria-label="Previous day"
              className={ICON_BUTTON}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setDay(new Date())}
              className="min-w-0 flex-1 rounded-md px-1 py-1 text-center transition-colors hover:text-foreground"
              title="Jump to today"
            >
              <span className="block truncate text-sm font-medium leading-tight">
                {relLabel}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {day.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setDay((d) => addDays(d, 1))}
              aria-label="Next day"
              className={ICON_BUTTON}
            >
              <ChevronRight className="size-4" />
            </button>
            {/* Collapse: a deliberate "close the side panel" control, distinct
                from the day-nav chevrons so it doesn't read as a stray arrow. */}
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse to-do list"
              className={cn(ICON_BUTTON, "ml-0.5")}
            >
              <PanelRightClose className="size-4" />
            </button>
          </div>
        </div>

      {/* Lists */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {dayAssignments.length === 0 && dayItems.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing for this day.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {/* Canvas assignments (checkable, not removable) */}
            {dayAssignments.map((a) => {
              const done = doneIds.has(a.canvas_assignment_id);
              // Submitted (or graded) on Canvas strikes it through even if the
              // user never manually checked it — same look as manual check-off.
              const struck = done || a.submitted || a.graded;
              return (
                <li
                  key={`a-${a.id}`}
                  className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={done}
                    onChange={() =>
                      toggleAssignment(a.canvas_assignment_id, !done)
                    }
                    label={a.title}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        struck && "text-muted-foreground line-through"
                      )}
                    >
                      {a.html_url ? (
                        <a
                          href={a.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {a.title}
                        </a>
                      ) : (
                        a.title
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.due_at ? `Due ${formatTime(a.due_at)}` : "Assignment"}
                      {a.course_name ? ` · ${a.course_name}` : ""}
                      {a.graded && (
                        <span className="ml-1.5 font-medium text-green-600 dark:text-green-400 hyper-focus:text-green-400">
                          graded
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}

            {/* Manual items (checkable + removable) */}
            {dayItems.map((i) => (
              <li
                key={`t-${i.id}`}
                className="group flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/50"
              >
                <Checkbox
                  checked={i.done}
                  onChange={() => toggleItem(i.id, !i.done)}
                  label={i.text}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "break-words text-sm",
                      i.done && "text-muted-foreground line-through"
                    )}
                  >
                    {i.text}
                  </p>
                  {i.time && (
                    <p className="text-xs text-muted-foreground">
                      {formatHHMM(i.time)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(i.id)}
                  aria-label="Remove item"
                  className="shrink-0 rounded px-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add a manual item (with an optional time) to the selected day.
          One bordered container that reads as a SINGLE input (req 2): the task
          field fills the width, a thin internal divider separates an optional
          time field, and a "+" submits. `focus-within` lights the whole box, so
          it feels like one control rather than three. The sub-fields stay
          transparent (incl. hyper-focus, which otherwise fills inputs) so only
          the outer container draws a border. */}
      <form onSubmit={addItem} className="shrink-0 border-t p-2">
        <div className="flex items-stretch rounded-md border border-input bg-transparent transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a to-do…"
            className="min-w-0 flex-1 rounded-l-md bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground hyper-focus:bg-transparent"
          />
          {/* Optional time — shares the container; PICKER_ICON keeps the native
              clock glyph visible in light / dark / hyper-focus. */}
          <input
            type="time"
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            aria-label="Optional time"
            title="Optional time"
            className={cn(
              "w-[104px] shrink-0 border-l border-input bg-transparent px-2 py-1.5 text-sm outline-none hyper-focus:bg-transparent",
              PICKER_ICON
            )}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Add to-do"
            className="flex shrink-0 items-center rounded-r-md border-l border-input px-2.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </form>

      {error && (
        <p className="px-3 pb-2 text-xs text-destructive" role="status">
          {error}
        </p>
      )}
      </div>
    </div>
  );
}

// A small square checkbox button (theme-token styled).
function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${checked ? "Uncheck" : "Check"} ${label}`}
      onClick={onChange}
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input text-transparent hover:border-ring"
      )}
    >
      ✓
    </button>
  );
}
