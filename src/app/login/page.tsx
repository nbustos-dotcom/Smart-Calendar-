"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// These are read at BUILD time and frozen into the page. If a value is blank
// here, it means the deployment that built this page didn't have that env var
// set. We surface that plainly instead of firing a broken request to Supabase
// (which returns a confusing "No API key found" error).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function missingConfig(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const missing = missingConfig();
  const configOk = missing.length === 0;

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // After Google sends the user back, land on our callback route,
        // which finishes the sign-in and redirects into the app.
        redirectTo: `${siteUrl}/auth/callback`,
      },
    });

    // If signInWithOAuth returns without redirecting, something went wrong.
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Smart Calendar</CardTitle>
          <CardDescription>
            Sign in to see your Canvas deadlines in one honest calendar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Configuration check — tells us exactly what this build is missing. */}
          {!configOk && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
              role="alert"
            >
              <p className="font-medium text-destructive">
                This deployment is missing configuration:
              </p>
              <ul className="mt-1 list-disc pl-5 text-destructive">
                {missing.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Set it in Vercel (scoped to Production), then redeploy.
              </p>
            </div>
          )}

          <Button onClick={signInWithGoogle} disabled={loading || !configOk}>
            {loading ? "Redirecting…" : "Sign in with Google"}
          </Button>

          {/* Non-secret readout so we can confirm what the build baked in. */}
          <p className="text-xs text-muted-foreground">
            Config check — URL: {SUPABASE_URL ? "set" : "MISSING"} · anon key:{" "}
            {SUPABASE_ANON_KEY
              ? `set (${SUPABASE_ANON_KEY.length} chars)`
              : "MISSING"}
          </p>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
