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

import { useState } from "react";
import { ChevronLeft, ChevronRight, ListTodo } from "lucide-react";
import { addDays, isSameDay } from "@/lib/calendar";
import type { AssignmentItem } from "@/lib/types";
import type { TodoItemRow } from "@/lib/todo";
import {
  addTodoItemAction,
  removeTodoItemAction,
  setTodoItemDoneAction,
  setAssignmentDoneAction,
} from "@/app/todo/actions";
import { cn } from "@/lib/utils";

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

  // --- collapsed rail --------------------------------------------------------

  if (collapsed) {
    return (
      <div className="flex h-full w-full shrink-0 items-center justify-between gap-2 rounded-xl border bg-card px-2 py-2 xl:w-12 xl:flex-col xl:justify-start xl:px-0 xl:py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand to-do list"
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent"
        >
          <ListTodo className="size-4" />
        </button>
        <span className="text-sm font-semibold tracking-tight text-muted-foreground xl:mt-1 xl:[writing-mode:vertical-rl]">
          To-Do
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand to-do list"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent xl:mt-auto"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>
    );
  }

  // --- expanded panel --------------------------------------------------------

  const isTodaySelected = isSameDay(day, today);
  const isTomorrow = isSameDay(day, addDays(today, 1));
  const relLabel = isTodaySelected
    ? "Today"
    : isTomorrow
      ? "Tomorrow"
      : day.toLocaleDateString(undefined, { weekday: "long" });

  return (
    <div className="flex h-full w-full flex-col rounded-xl border bg-card xl:w-80">
      {/* Header + collapse */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">To-Do</h2>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse to-do list"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Day navigation */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => setDay((d) => addDays(d, -1))}
          aria-label="Previous day"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setDay(new Date())}
          className="min-w-0 flex-1 text-center"
          title="Jump to today"
        >
          <div className="text-sm font-medium leading-tight">{relLabel}</div>
          <div className="truncate text-xs text-muted-foreground">
            {day.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setDay((d) => addDays(d, 1))}
          aria-label="Next day"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-4" />
        </button>
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
                        done && "text-muted-foreground line-through"
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

      {/* Add a manual item (with an optional time) to the selected day */}
      <form onSubmit={addItem} className="flex flex-wrap gap-2 border-t p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a to-do…"
          className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <input
          type="time"
          value={draftTime}
          onChange={(e) => setDraftTime(e.target.value)}
          aria-label="Optional time"
          title="Optional time"
          className="w-[104px] shrink-0 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error && (
        <p className="px-3 pb-2 text-xs text-destructive" role="status">
          {error}
        </p>
      )}
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
