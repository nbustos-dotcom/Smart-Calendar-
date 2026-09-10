"use client";

// ============================================================================
// COURSE MANAGER — the "My Courses" / "Removed courses" lists on Settings
//
// Lets the student remove a synced Canvas course (with a confirm step) and
// re-add a previously removed one. Calls the server actions in
// src/app/settings/actions.ts; the actual DB work + suppression happens there.
// Styled with theme tokens only, so it reads in light / dark / hyper-focus.
// ============================================================================

import { useState, useTransition } from "react";
import {
  removeCourseAction,
  readdCourseAction,
  type ActionState,
} from "@/app/settings/actions";
import type { CourseSummary } from "@/lib/courses";
import { Button } from "@/components/ui/button";

export function CourseManager({
  active,
  removed,
}: {
  active: CourseSummary[];
  removed: CourseSummary[];
}) {
  const [isPending, startTransition] = useTransition();
  // Which course (if any) is showing its "Remove?" confirm prompt.
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [message, setMessage] = useState<ActionState>(null);

  function remove(id: number) {
    setConfirmId(null);
    startTransition(async () => setMessage(await removeCourseAction(id)));
  }

  function readd(id: number) {
    startTransition(async () => setMessage(await readdCourseAction(id)));
  }

  return (
    <div className="flex flex-col gap-5">
      {/* My courses -------------------------------------------------------- */}
      <div>
        <h3 className="mb-2 text-sm font-medium">My courses</h3>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No synced courses yet. Use “Sync now” to pull your Canvas courses.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {active.map((c) => (
              <li
                key={c.canvasCourseId}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm">{c.name}</span>
                {confirmId === c.canvasCourseId ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Remove?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() => remove(c.canvasCourseId)}
                    >
                      Yes, remove
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={isPending}
                    onClick={() => setConfirmId(c.canvasCourseId)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Removed courses --------------------------------------------------- */}
      {removed.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Removed courses</h3>
          <ul className="flex flex-col gap-1.5">
            {removed.map((c) => (
              <li
                key={c.canvasCourseId}
                className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {c.name}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  disabled={isPending}
                  onClick={() => readd(c.canvasCourseId)}
                >
                  Re-add
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Removed courses’ assignments are deleted and won’t return on a sync
            until you re-add them.
          </p>
        </div>
      )}

      {message && (
        <p
          className={
            message.ok
              ? "text-sm text-green-600 hyper-focus:text-green-400"
              : "text-sm text-destructive"
          }
          role="status"
        >
          {message.message}
        </p>
      )}
    </div>
  );
}
