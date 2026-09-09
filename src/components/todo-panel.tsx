// ============================================================================
// TO-DO PANEL — static placeholder (URL "/", right rail)
//
// VISUAL ONLY for now: this renders a styled heading and a few sample rows so we
// can see the panel positioned and styled. There is no real data, storage, or
// interactivity here yet — adding/checking/editing tasks is a later task.
// ============================================================================
import { Circle } from "lucide-react";

// Hard-coded sample rows so the panel looks real while we design the layout.
const SAMPLE_TODOS = [
  { id: "s1", text: "Finish lab report draft", meta: "Today" },
  { id: "s2", text: "Read Chapter 5", meta: "Tomorrow" },
  { id: "s3", text: "Email professor about extension", meta: "This week" },
  { id: "s4", text: "Start problem set 3", meta: "Fri" },
];

export function TodoPanel() {
  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">To-Do List</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Preview
        </span>
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
