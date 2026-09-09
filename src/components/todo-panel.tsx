// ============================================================================
// TO-DO PANEL — static placeholder with a collapse/expand toggle (right rail)
//
// VISUAL ONLY: sample rows, no real data or task logic yet. The only behavior is
// a local open/closed toggle (pure UI state): it starts COLLAPSED as a slim rail
// so the calendar gets the full width, and expands to the full panel on click.
// ============================================================================
"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ListTodo, Circle } from "lucide-react";

// Hard-coded sample rows so the panel looks real while we design the layout.
const SAMPLE_TODOS = [
  { id: "s1", text: "Finish lab report draft", meta: "Today" },
  { id: "s2", text: "Read Chapter 5", meta: "Tomorrow" },
  { id: "s3", text: "Email professor about extension", meta: "This week" },
  { id: "s4", text: "Start problem set 3", meta: "Fri" },
];

export function TodoPanel() {
  // Start collapsed so the calendar has the full width by default.
  const [collapsed, setCollapsed] = useState(true);

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

  return (
    <div className="flex h-full w-full flex-col rounded-xl border bg-card xl:w-80">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">To-Do List</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Preview
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse to-do list"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <ul className="flex flex-col gap-1 p-2">
        {SAMPLE_TODOS.map((todo) => (
          <li
            key={todo.id}
            className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/50"
          >
            {/* Non-interactive: purely a visual checkbox for now. */}
            <Circle
              className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{todo.text}</p>
              <p className="text-xs text-muted-foreground">{todo.meta}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-auto border-t px-4 py-3 text-xs text-muted-foreground">
        Task tracking is coming soon — this is a preview of where your to-dos
        will live.
      </p>
    </div>
  );
}
