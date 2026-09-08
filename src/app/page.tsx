// ============================================================================
// DASHBOARD / CALENDAR PAGE — the app's home screen (URL: "/")
//
// What the student sees after signing in. It loads their synced assignments and
// class events from the database and hands them to <CalendarView> to draw the
// week/month calendar. Display only — no scheduling happens here.
// ============================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getConnectionStatus } from "@/lib/canvas-connection";
import { CalendarView } from "@/components/calendar-view";
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

  // Wide container: the calendar should use most of the window on big screens,
  // with only a comfortable side margin. The high max-width keeps it from
  // stretching absurdly on ultra-wide displays; padding scales down on small
  // screens so it stays responsive.
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Smart Calendar</h1>
          {status.lastSyncedAt ? (
            <p className="text-sm text-muted-foreground">
              Last synced {new Date(status.lastSyncedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not synced yet</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/settings">Settings</Link>
          </Button>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost">
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
        <CalendarView assignments={assignments} events={events} />
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
