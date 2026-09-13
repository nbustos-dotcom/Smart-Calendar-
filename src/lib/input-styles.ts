// ============================================================================
// SHARED INPUT STYLING — small styling constants reused across form fields so
// the same kind of input looks identical everywhere (one place to change it).
// ============================================================================

// Native date/time picker indicator styling. The browser's built-in
// calendar/clock glyph is a clear, clickable target here — and because that
// default glyph is dark, it would vanish on the dark / hyper-focus backgrounds,
// so we invert it in those themes. Used by every <input type="date"|"time">.
export const PICKER_ICON =
  "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 dark:[&::-webkit-calendar-picker-indicator]:invert hyper-focus:[&::-webkit-calendar-picker-indicator]:invert";
