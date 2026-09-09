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
import { UpcomingAssignments } from "@/components/upcoming-assignments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AssignmentItem, ClassEventItem } from "@/lib/types";

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

  // Wide container so the calendar uses most of the window on big screens, with a
  // comfortable side margin (high max-width avoids over-stretching on ultra-wide).
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8">
      {/* Slim app header: small logo mark + wordmark on the left, actions right. */}
      <header className="mb-4 flex items-center justify-between gap-4 border-b pb-3">
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
        // Main dashboard: assignments-first calendar on the left, To-Do rail on
        // the right. Stacks vertically on narrow screens (To-Do drops below).
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <UpcomingAssignments assignments={assignments} />
            <CalendarView assignments={assignments} events={events} />
          </div>
          <aside className="w-full shrink-0 xl:w-80">
            <TodoPanel />
          </aside>
        </div>
      )}
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
