"use client";

// ============================================================================
// EXAM DIALOG — add a test (spacing-driven prep)
//
// Canvas can't reliably expose exams, so the student enters them here. On save
// we call addExamAction, which stores the exam and re-plans so its spaced study
// sessions appear immediately. Mirrors the event dialog's small modal shell.
// ============================================================================

import { useEffect, useState, useTransition } from "react";
import { addExamAction } from "@/app/scheduler/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PICKER_ICON } from "@/lib/input-styles";
import { cn } from "@/lib/utils";

export function ExamDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [prepHours, setPrepHours] = useState(""); // optional
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSave = title.trim().length > 0 && date !== "" && time !== "";

  function save() {
    if (!canSave) return;
    // Combine the local date + time into a concrete instant.
    const examAt = new Date(`${date}T${time}`);
    if (Number.isNaN(examAt.getTime())) {
      setError("That date/time didn't parse.");
      return;
    }
    const hours = parseFloat(prepHours);
    const estPrepMinutes =
      prepHours.trim() && !Number.isNaN(hours) && hours > 0 ? Math.round(hours * 60) : null;

    startTransition(async () => {
      const res = await addExamAction({
        title,
        courseName: course.trim() || null,
        examAt: examAt.toISOString(),
        estPrepMinutes,
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
        <h2 className="mb-4 text-base font-semibold">Add an exam</h2>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exam-title">Title</Label>
            <Input
              id="exam-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Calculus midterm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exam-course">Course (optional)</Label>
            <Input
              id="exam-course"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="e.g. MA 2160"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exam-date">Date</Label>
              <Input
                id="exam-date"
                type="date"
                className={PICKER_ICON}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exam-time">Time</Label>
              <Input
                id="exam-time"
                type="time"
                className={PICKER_ICON}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exam-prep">Estimated total prep (hours, optional)</Label>
            <Input
              id="exam-prep"
              type="number"
              min="0"
              step="0.5"
              value={prepHours}
              onChange={(e) => setPrepHours(e.target.value)}
              placeholder="Leave blank to use a sensible default"
            />
            <p className="text-xs text-muted-foreground">
              We spread prep across several sessions before the test. Your estimate
              gets a realistic buffer; blank uses a default.
            </p>
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
            <Button
              type="button"
              onClick={save}
              disabled={!canSave || isPending}
              className={cn(isPending && "opacity-80")}
            >
              {isPending ? "Saving…" : "Add exam"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
