"use client";

import { useState, useTransition } from "react";
import {
  saveTokenAction,
  clearTokenAction,
  syncNowAction,
  type ActionState,
} from "@/app/settings/actions";
import type { ConnectionStatus } from "@/lib/canvas-connection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

function StatusLine({ status }: { status: ConnectionStatus }) {
  if (!status.connected) {
    return <Badge variant="secondary">Not connected</Badge>;
  }
  if (status.lastSyncStatus === "error") {
    return <Badge variant="destructive">Last sync failed</Badge>;
  }
  if (status.lastSyncStatus === "ok") {
    return <Badge>Connected</Badge>;
  }
  return <Badge variant="secondary">Connected — not synced yet</Badge>;
}

export function SettingsForm({ status }: { status: ConnectionStatus }) {
  // One place holds the result message; all three actions write to it.
  const [message, setMessage] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      setMessage(await saveTokenAction(null, formData));
    });
  }

  function run(action: () => Promise<ActionState>) {
    startTransition(async () => {
      setMessage(await action());
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <StatusLine status={status} />
        {status.lastSyncedAt && (
          <span className="text-sm text-muted-foreground">
            Last synced {new Date(status.lastSyncedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* If the last sync failed, say exactly why — never hide it. */}
      {status.lastSyncStatus === "error" && status.lastSyncError && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {status.lastSyncError}
        </p>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <Label htmlFor="token">Canvas access token</Label>
        <Input
          id="token"
          name="token"
          type="password"
          placeholder="Paste your token from Canvas → Account → Settings"
          autoComplete="off"
        />
        <p className="text-sm text-muted-foreground">
          In Canvas: Account → Settings → “New Access Token”. We verify the token
          against Canvas, store it encrypted, and never show it again.
        </p>
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Working…" : "Save token"}
          </Button>
        </div>
      </form>

      {status.connected && (
        <div className="flex flex-wrap gap-3 border-t pt-4">
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => run(syncNowAction)}
          >
            {isPending ? "Working…" : "Sync now"}
          </Button>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => run(clearTokenAction)}
          >
            Remove token
          </Button>
        </div>
      )}

      {message && (
        <p
          className={
            message.ok ? "text-sm text-green-600" : "text-sm text-destructive"
          }
          role="status"
        >
          {message.message}
        </p>
      )}
    </div>
  );
}
