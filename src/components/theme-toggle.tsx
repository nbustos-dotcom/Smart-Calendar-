// ============================================================================
// THEME TOGGLE — light / dark / hyper-focus switch (used on the Settings page)
//
// Stores the choice in the browser's localStorage ("theme" = "light" | "dark" | "hyper-focus")
// and toggles the corresponding class on <html> immediately. No backend / no database —
// the pre-paint script in the root layout re-applies the saved value on load.
// ============================================================================
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

type ThemeMode = "light" | "dark" | "hyper-focus";

export function ThemeToggle() {
  // We don't know the theme on the server, so start "unmounted" and read the
  // real value from the DOM after mount to avoid a hydration mismatch.
  const [state, setState] = useState({ mounted: false, theme: "light" as ThemeMode });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      mounted: true,
      theme: (localStorage.getItem("theme") as ThemeMode) || "light",
    });
  }, []);

  function apply(theme: ThemeMode) {
    const el = document.documentElement;
    // Remove all theme classes
    el.classList.remove("dark", "hyper-focus");
    // Add the new one (light has no class)
    if (theme === "dark") el.classList.add("dark");
    if (theme === "hyper-focus") el.classList.add("hyper-focus");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // localStorage may be unavailable (private mode); the class still applies.
    }
    setState({ mounted: true, theme });
  }

  const { mounted, theme } = state;

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Appearance</p>
        <p className="text-sm text-muted-foreground">
          Choose a light, dark, or hyper focus theme. Saved on this device.
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant={mounted && theme === "light" ? "default" : "outline"}
          size="sm"
          onClick={() => apply("light")}
        >
          <Sun className="size-4" />
          Light
        </Button>
        <Button
          variant={mounted && theme === "dark" ? "default" : "outline"}
          size="sm"
          onClick={() => apply("dark")}
        >
          <Moon className="size-4" />
          Dark
        </Button>
        <Button
          variant={mounted && theme === "hyper-focus" ? "default" : "outline"}
          size="sm"
          onClick={() => apply("hyper-focus")}
        >
          <Zap className="size-4" />
          Focus
        </Button>
      </div>
    </div>
  );
}
