// ============================================================================
// THEME TOGGLE — light / dark switch (used on the Settings page)
//
// Stores the choice in the browser's localStorage ("theme" = "light" | "dark")
// and toggles the `dark` class on <html> immediately. No backend / no database —
// the pre-paint script in the root layout re-applies the saved value on load.
// ============================================================================
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  // We don't know the theme on the server, so start "unmounted" and read the
  // real value from the DOM after mount to avoid a hydration mismatch.
  const [state, setState] = useState({ mounted: false, isDark: false });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      mounted: true,
      isDark: document.documentElement.classList.contains("dark"),
    });
  }, []);

  function apply(dark: boolean) {
    const el = document.documentElement;
    if (dark) el.classList.add("dark");
    else el.classList.remove("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // localStorage may be unavailable (private mode); the class still applies.
    }
    setState({ mounted: true, isDark: dark });
  }

  const { mounted, isDark } = state;

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Appearance</p>
        <p className="text-sm text-muted-foreground">
          Choose a light or dark theme. Saved on this device.
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant={mounted && !isDark ? "default" : "outline"}
          size="sm"
          onClick={() => apply(false)}
        >
          <Sun className="size-4" />
          Light
        </Button>
        <Button
          variant={mounted && isDark ? "default" : "outline"}
          size="sm"
          onClick={() => apply(true)}
        >
          <Moon className="size-4" />
          Dark
        </Button>
      </div>
    </div>
  );
}
