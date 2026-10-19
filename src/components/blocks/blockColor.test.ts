import { describe, expect, it } from "vitest";
import { blockTextColor, darkModeColor, DEFAULT_BLOCK_STROKE } from "./blockColor";

describe("block text colour", () => {
  it("uses the theme default for the default border, transparent and empty strokes", () => {
    expect(blockTextColor(DEFAULT_BLOCK_STROKE, "light")).toBeUndefined();
    expect(blockTextColor("transparent", "dark")).toBeUndefined();
    expect(blockTextColor("", "light")).toBeUndefined();
  });

  it("follows the stroke colour in light mode", () => {
    expect(blockTextColor("#E03131", "light")).toBe("#e03131");
  });

  it("mirrors Excalidraw's dark filter so text matches the canvas", () => {
    // Default black ink renders light grey on the dark canvas.
    expect(darkModeColor("#1e1e1e")).toBe("#d3d3d3");
    // White becomes the dark canvas background tone.
    expect(darkModeColor("#ffffff")).toBe("#121212");
    // Non-hex values pass through untouched.
    expect(darkModeColor("rebeccapurple")).toBe("rebeccapurple");
  });
});
