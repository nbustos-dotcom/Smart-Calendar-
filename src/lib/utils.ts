import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The standard shadcn/ui helper: merge conditional class names and let
// tailwind-merge resolve conflicts (e.g. "p-2 p-4" -> "p-4").
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
