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

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          <Button onClick={signInWithGoogle} disabled={loading}>
            {loading ? "Redirecting…" : "Sign in with Google"}
          </Button>
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
