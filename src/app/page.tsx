// ============================================================================
// DASHBOARD / CALENDAR PAGE — the app's home screen (URL: "/")
//
// What the student sees after signing in. It loads their synced assignments and
// class events from the database and hands them to <CalendarView> to draw the
// week/month calendar. Display only — no scheduling happens here.
// ============================================================================
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getConnectionStatus } from "@/lib/canvas-connection";
import { CalendarView } from "@/components/calendar-view";
import { TodoPanel } from "@/components/todo-panel";
import { DueTodayBubble } from "@/components/due-today-bubble";
import { UpcomingAssignments } from "@/components/upcoming-assignments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AssignmentItem, ClassEventItem } from "@/lib/types";
import type { UserEventRow, OverrideRow } from "@/lib/recurrence";

// Supabase returns embedded relations as an object; type it loosely here and
// normalize below.
type AssignmentRow = {
  id: string;
  title: string;
  due_at: string | null;
  points_possible: number | null;
  submission_types: string[] | null;
  html_url: string | null;
  courses: { name: string } | null;
};

type ClassEventRow = {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  html_url: string | null;
  courses: { name: string } | null;
};

export default async function HomePage() {
  const supabase = await createClient();
  const status = await getConnectionStatus();

  const { data: assignmentRows } = await supabase
    .from("assignments")
    .select(
      "id, title, due_at, points_possible, submission_types, html_url, courses(name)"
    )
    .order("due_at", { ascending: true, nullsFirst: false });

  const { data: eventRows } = await supabase
    .from("class_events")
    .select(
      "id, title, start_at, end_at, location_name, html_url, courses(name)"
    )
    .order("start_at", { ascending: true, nullsFirst: false });

  // The user's own editable events (Phase 2) + per-occurrence overrides.
  const { data: userEventRows } = await supabase
    .from("user_events")
    .select(
      "id, title, color, is_recurring, starts_at, ends_at, weekdays, start_minute, end_minute, series_start_date"
    );
  const { data: overrideRows } = await supabase
    .from("user_event_overrides")
    .select(
      "id, event_id, occurrence_date, status, starts_at, ends_at, title, color"
    );

  const assignments: AssignmentItem[] = (
    (assignmentRows ?? []) as unknown as AssignmentRow[]
  ).map((r) => ({
    id: r.id,
    title: r.title,
    due_at: r.due_at,
    points_possible: r.points_possible,
    submission_types: r.submission_types ?? [],
    html_url: r.html_url,
    course_name: r.courses?.name ?? null,
  }));

  const events: ClassEventItem[] = (
    (eventRows ?? []) as unknown as ClassEventRow[]
  ).map((r) => ({
    id: r.id,
    title: r.title,
    start_at: r.start_at,
    end_at: r.end_at,
    location_name: r.location_name,
    html_url: r.html_url,
    course_name: r.courses?.name ?? null,
  }));

  // Full-height app shell: header + slim strip + a two-column body that fills the
  // rest of the viewport, so the whole dashboard fits on one screen (only the
  // calendar grid scrolls internally). Wide, with a comfortable side margin.
  return (
    <main className="mx-auto flex h-dvh w-full max-w-[1800px] flex-col gap-2.5 bg-gradient-to-b from-white to-zinc-200 px-4 py-2.5 sm:px-6 lg:px-8 dark:from-black dark:to-zinc-950 hyper-focus:bg-none">
      {/* Slim app header: small logo mark + wordmark on the left, actions right. */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b pb-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarDays className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            Smart Calendar
          </span>
          {status.lastSyncedAt && (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              · synced{" "}
              {new Date(status.lastSyncedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings">Settings</Link>
          </Button>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {/* Honest empty states, depending on where the user is in setup. */}
      {!status.connected ? (
        <SetupPrompt
          title="Connect Canvas to get started"
          body="Head to Settings and paste your Canvas access token. Then sync to pull your courses and deadlines."
        />
      ) : status.lastSyncStatus === "error" ? (
        <SetupPrompt
          title="The last sync didn’t finish"
          body={status.lastSyncError ?? "Try syncing again from Settings."}
          tone="error"
        />
      ) : assignments.length === 0 && events.length === 0 ? (
        <SetupPrompt
          title="Nothing to show yet"
          body="You’re connected, but no assignments or class events have been synced. Try “Sync now” in Settings."
        />
      ) : (
        // Dashboard body fills the rest of the screen: a slim full-width strip on
        // top, then two columns (calendar + to-do) whose tops are aligned.
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <UpcomingAssignments assignments={assignments} />
          {/* Two columns, tops level (items-stretch), stacking on narrow screens. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 xl:flex-row xl:items-stretch">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <CalendarView
                assignments={assignments}
                events={events}
                userEvents={(userEventRows ?? []) as unknown as UserEventRow[]}
                overrides={(overrideRows ?? []) as unknown as OverrideRow[]}
              />
            </section>
            {/* Width is controlled by TodoPanel itself (collapsed rail vs full
                panel); the calendar (flex-1) reclaims the space when collapsed. */}
            <aside className="min-h-0 w-full shrink-0 xl:w-auto">
              <TodoPanel />
            </aside>
          </div>
        </div>
      )}

      {/* Always-visible floating "due today" indicator (reads existing
          assignment data only). Fixed to the viewport's bottom-right. */}
      <DueTodayBubble assignments={assignments} />
    </main>
  );
}

function SetupPrompt({
  title,
  body,
  tone = "default",
}: {
  title: string;
  body: string;
  tone?: "default" | "error";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-8">
        <h2 className="text-lg font-medium">{title}</h2>
        <p
          className={
            tone === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {body}
        </p>
        <Button asChild>
          <Link href="/settings">Go to Settings</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
