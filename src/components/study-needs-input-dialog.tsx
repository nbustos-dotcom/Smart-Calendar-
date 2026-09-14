"use client";

// ============================================================================
// STUDY NEEDS-INPUT DIALOG — the one question the scheduler asks, once
//
// When the scheduler can't confidently tell what kind of task a Canvas
// assignment is, it holds a "needs input" placeholder and asks here. The answer
// is stored (setAssignmentTypeAction) so it's never asked again, and the plan
// re-runs. Deliberately small: pick a type, optionally give an estimate.
// ============================================================================

import { useEffect, useState, useTransition } from "react";
import { setAssignmentTypeAction } from "@/app/scheduler/actions";
import { KNOWN_CATEGORIES, type TaskCategory } from "@/lib/scheduler-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  reading: "Reading",
  quiz: "Quiz",
  problem_set: "Homework / problem set",
  lab: "Lab",
  essay: "Essay / writing",
  project: "Project",
};

export function StudyNeedsInputDialog({
  canvasAssignmentId,
  title,
  onClose,
}: {
  canvasAssignmentId: number;
  title: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<TaskCategory | null>(null);
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    if (!category) return;
    const h = parseFloat(hours);
    const estMinutes = hours.trim() && !Number.isNaN(h) && h > 0 ? Math.round(h * 60) : null;
    startTransition(async () => {
      const res = await setAssignmentTypeAction({
        canvasAssignmentId,
        category,
        estMinutes,
      });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-base font-semibold">What kind of task is this?</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground break-words">
          I couldn&apos;t tell what <span className="font-medium text-foreground">{title}</span> is,
          so I don&apos;t know how much time to plan. Tell me once and I&apos;ll remember.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs",
                    category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input hover:bg-accent"
                  )}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="needs-input-hours">
              How long do you think it&apos;ll take? (hours, optional)
            </Label>
            <Input
              id="needs-input-hours"
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Leave blank to use a default for this type"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="status">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={!category || isPending}>
              {isPending ? "Saving…" : "Schedule it"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
