"use client";

// ============================================================================
// GOOGLE CALENDAR CONNECT — the interactive controls for the connection section
//
// Not connected → a "Connect Google Calendar" button that kicks off the OAuth
// redirect flow (/api/google/connect). Connected → a Connected badge, when it
// was connected, and a Disconnect button.
//
// Self-contained: it takes only the connection status as props and calls one
// server action to disconnect. Connecting is a plain link to the redirect route
// (full-page navigation, since that route bounces the browser out to Google).
// ============================================================================

import { useEffect, useState, useTransition } from "react";
import {
  disconnectGoogleCalendarAction,
  type GoogleActionState,
} from "@/app/settings/google-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function GoogleCalendarConnect({
  connected,
  connectedAt,
}: {
  connected: boolean;
  connectedAt: string | null;
}) {
  const [message, setMessage] = useState<GoogleActionState>(null);
  const [isPending, startTransition] = useTransition();

  // Surface the OAuth result the callback route sends back via ?google=…, then
  // clean it out of the URL so a refresh doesn't keep showing it. Read from
  // window (not useSearchParams) to stay a simple, self-contained client widget.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") {
      setMessage({ ok: true, message: "Google Calendar connected." });
    } else if (result === "error") {
      setMessage({
        ok: false,
        message: params.get("reason") ?? "Could not connect Google Calendar.",
      });
    }
    params.delete("google");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "")
    );
  }, []);

  function disconnect() {
    startTransition(async () => {
      setMessage(await disconnectGoogleCalendarAction());
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {connected ? <Badge>Connected</Badge> : (
          <Badge variant="secondary">Not connected</Badge>
        )}
        {connected && connectedAt && (
          <span className="text-sm text-muted-foreground">
            Connected {new Date(connectedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {connected ? (
        <div>
          <Button variant="outline" disabled={isPending} onClick={disconnect}>
            {isPending ? "Working…" : "Disconnect"}
          </Button>
        </div>
      ) : (
        <div>
          <Button asChild>
            {/* Full-page navigation: this route redirects out to Google. */}
            <a href="/api/google/connect">Connect Google Calendar</a>
          </Button>
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
