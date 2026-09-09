// ============================================================================
// SETTINGS PAGE — "Connect Canvas" (URL: "/settings")
//
// Where the student pastes their Canvas token and runs a sync. This file just
// reads the current connection status and renders <SettingsForm>.
// ============================================================================
import Link from "next/link";
import { getConnectionStatus } from "@/lib/canvas-connection";
import { SettingsForm } from "@/components/settings-form";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const status = await getConnectionStatus();

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Button asChild variant="ghost">
          <Link href="/">← Back to calendar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect Canvas</CardTitle>
          <CardDescription>
            Smart Calendar reads your Canvas courses and deadlines. It is
            read-only — it never changes anything in Canvas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm status={status} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Personalize how Smart Calendar looks on this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>
    </main>
  );
}
