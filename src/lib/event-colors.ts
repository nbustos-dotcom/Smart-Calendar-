// ============================================================================
// EVENT COLORS — the small preset palette for the user's own events
//
// One place that maps a colour name (stored in the DB) to the Tailwind classes
// used to paint a calendar block and its little swatch in the form. Keeping this
// as a plain lookup (not dynamic class strings) means Tailwind can see every
// class at build time, so none of them get purged.
// ============================================================================

import { EVENT_COLORS, type EventColor } from "@/lib/recurrence";

export { EVENT_COLORS };
export type { EventColor };

type ColorStyle = {
  // Classes for a solid time block on the grid.
  block: string;
  // A small filled dot used in the colour picker.
  swatch: string;
};

// Each colour: a soft translucent fill + a coloured left border, readable in
// both light and dark mode. The swatch is the same hue, fully saturated.
const COLOR_STYLES: Record<EventColor, ColorStyle> = {
  blue: {
    block:
      "border-blue-500 bg-blue-500/20 text-blue-950 dark:bg-blue-500/25 dark:text-blue-50",
    swatch: "bg-blue-500",
  },
  green: {
    block:
      "border-green-500 bg-green-500/20 text-green-950 dark:bg-green-500/25 dark:text-green-50",
    swatch: "bg-green-500",
  },
  purple: {
    block:
      "border-purple-500 bg-purple-500/20 text-purple-950 dark:bg-purple-500/25 dark:text-purple-50",
    swatch: "bg-purple-500",
  },
  orange: {
    block:
      "border-orange-500 bg-orange-500/20 text-orange-950 dark:bg-orange-500/25 dark:text-orange-50",
    swatch: "bg-orange-500",
  },
  pink: {
    block:
      "border-pink-500 bg-pink-500/20 text-pink-950 dark:bg-pink-500/25 dark:text-pink-50",
    swatch: "bg-pink-500",
  },
  red: {
    block:
      "border-red-500 bg-red-500/20 text-red-950 dark:bg-red-500/25 dark:text-red-50",
    swatch: "bg-red-500",
  },
};

// Look up a colour's styles, falling back to blue for any unknown value so a
// stray DB colour can never render an unstyled (invisible) block.
export function colorStyle(name: string): ColorStyle {
  return COLOR_STYLES[name as EventColor] ?? COLOR_STYLES.blue;
}
