import { describe, it, expect } from "vitest";
import {
  googleColorHex,
  hexToRgba,
  DEFAULT_GOOGLE_COLOR,
  GOOGLE_EVENT_COLORS,
} from "@/lib/google-colors";

describe("googleColorHex", () => {
  it("maps known colorIds to Google's palette hex", () => {
    expect(googleColorHex("1")).toBe("#7986CB"); // Lavender
    expect(googleColorHex("11")).toBe("#D50000"); // Tomato
    expect(googleColorHex("7")).toBe(GOOGLE_EVENT_COLORS["7"]);
  });

  it("falls back to the default for missing / unknown colorIds", () => {
    expect(googleColorHex(undefined)).toBe(DEFAULT_GOOGLE_COLOR);
    expect(googleColorHex(null)).toBe(DEFAULT_GOOGLE_COLOR);
    expect(googleColorHex("999")).toBe(DEFAULT_GOOGLE_COLOR);
  });
});

describe("hexToRgba", () => {
  it("converts a 6-digit hex to rgba with the given alpha", () => {
    expect(hexToRgba("#D50000", 0.16)).toBe("rgba(213, 0, 0, 0.16)");
    expect(hexToRgba("039BE5", 0.5)).toBe("rgba(3, 155, 229, 0.5)");
  });

  it("returns the input unchanged when it isn't a 6-digit hex", () => {
    expect(hexToRgba("rebeccapurple", 0.2)).toBe("rebeccapurple");
  });
});
