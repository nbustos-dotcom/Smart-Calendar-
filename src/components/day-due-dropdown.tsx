"use client";

// ============================================================================
// DAY "WHAT'S DUE" DROPDOWN — a tiny collapsible per-day assignment list
//
// Sits in each day column's header in the week view. Collapsed by default,
// showing just a count ("2 due"); expands to that day's Canvas assignments
// (title + due time, linking to Canvas). Renders NOTHING when the day has no
// assignments, so empty days stay clean.
//
// Pure display: it only reads the assignment list the calendar already has.
// Styled with theme tokens only, so it reads in light / dark / hyper-focus.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// One assignment due on this day (already filtered + sorted by the caller).
export type DayDueItem = {
  id: string;
  title: string;
  href: string | null;
  at: string; // ISO due timestamp
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DayDueDropdown({
  items,
  align = "center",
}: {
  items: DayDueItem[];
  // "end" anchors the popover to the cell's right edge (for the last column, so
  // it doesn't get clipped by the calendar card's right overflow).
  align?: "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape (only while open).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing due → render nothing (keeps empty day headers uncluttered).
  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative mt-1 flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground hover:bg-secondary/80"
      >
        {items.length} due
        <span aria-hidden className="text-[7px] leading-none">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full z-30 mt-1 w-44 overflow-hidden rounded-md border bg-popover text-left text-popover-foreground shadow-lg",
            align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
          )}
        >
          <ul className="max-h-56 overflow-auto p-1">
            {items.map((it) => (
              <li key={it.id} className="rounded px-1.5 py-1 hover:bg-muted">
                <div className="text-[11px] font-medium leading-tight">
                  {it.href ? (
                    <a
                      href={it.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {it.title}
                    </a>
                  ) : (
                    it.title
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Due {formatTime(it.at)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
