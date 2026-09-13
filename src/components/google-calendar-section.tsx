// ============================================================================
// GOOGLE CALENDAR SECTION — the "Connect Google Calendar" card on Settings
//
// A self-contained server component: it fetches its own connection status and
// renders its own Card, so the Settings page only needs a one-line drop-in
// (<GoogleCalendarSection />) and the whole feature is easy to relocate.
//
// Read-only connection only — it shows connect/disconnect, not any calendar
// events (that's a separate later step).
// ============================================================================
import { getGoogleConnectionStatus } from "@/lib/google-connection";
import { GoogleCalendarConnect } from "@/components/google-calendar-connect";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export async function GoogleCalendarSection() {
  const status = await getGoogleConnectionStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Calendar</CardTitle>
        <CardDescription>
          Connect your Google Calendar so Smart Calendar can read your events.
          Read-only — it never changes anything in your Google Calendar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleCalendarConnect
          connected={status.connected}
          connectedAt={status.connectedAt}
        />
      </CardContent>
    </Card>
  );
}
