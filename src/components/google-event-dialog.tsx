"use client";

// ============================================================================
// GOOGLE EVENT DIALOG — a READ-ONLY detail view for a Google Calendar event
//
// Opened by clicking a Google event on the calendar. Shows what Google gives us
// (title, when, and — when present — location, description, links). It is
// deliberately NOT the editable event dialog: there are no edit/save/delete
// controls, only a Close button and outbound links. Nothing here writes to
// Google. Theme tokens throughout (light / dark / hyper-focus).
// ============================================================================

import { useEffect } from "react";
import { CalendarClock, ExternalLink, MapPin, Video } from "lucide-react";
import type { ClassEventItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

// Human "when" line from the stored start/end. All-day (midnight start with a
// midnight/absent end) shows just the date.
function formatWhen(ev: ClassEventItem): string {
  if (!ev.start_at) return "";
  const start = new Date(ev.start_at);
  const end = ev.end_at ? new Date(ev.end_at) : null;
  const allDay =
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    (!end || (end.getHours() === 0 && end.getMinutes() === 0));

  const dayLong = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (allDay) return dayLong;

  const t = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!end) return `${dayLong} · ${t(start)}`;
  if (isSameCalendarDay(start, end)) return `${dayLong} · ${t(start)} – ${t(end)}`;
  return `${dayLong} · ${t(start)} → ${end.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// Render a plain-text description, turning bare URLs into new-tab links.
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function GoogleEventDialog({
  event,
  onClose,
}: {
  event: ClassEventItem;
  onClose: () => void;
}) {
  // Close on Escape, like a native dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accent = event.google_color ?? undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border bg-card shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* A slim colour bar in the event's Google colour — identity without
            tinting the whole card (keeps text on a theme surface, always legible). */}
        <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold break-words">{event.title}</h2>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground/40 text-[8px] font-bold leading-none"
              >
                G
              </span>
              From Google Calendar · read-only
            </span>
          </div>

          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <dd>{formatWhen(event)}</dd>
            </div>

            {event.location_name && (
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <dd className="break-words">{event.location_name}</dd>
              </div>
            )}

            {event.description && (
              <div className="flex flex-col gap-1 border-t pt-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  Description
                </dt>
                <dd className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">
                  <LinkifiedText text={event.description} />
                </dd>
              </div>
            )}
          </dl>

          {/* Outbound links (new tab). Read-only — no edit/save controls. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div className="flex flex-wrap gap-3 text-sm">
              {event.meeting_url && (
                <a
                  href={event.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex items-center gap-1.5 text-primary underline underline-offset-2 hover:opacity-80"
                  )}
                >
                  <Video className="size-4" /> Join meeting
                </a>
              )}
              {event.html_url && (
                <a
                  href={event.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary underline underline-offset-2 hover:opacity-80"
                >
                  <ExternalLink className="size-4" /> View in Google Calendar
                </a>
              )}
            </div>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
