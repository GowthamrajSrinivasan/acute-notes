import { describe, expect, it } from "vitest";
import { notesLabel } from "./mergeTargets";

describe("notesLabel", () => {
  it("is the first heading, as plain text", () => {
    expect(notesLabel("Intro line\n\n# Launch **plan**\n\n## Risks\n")).toBe("Launch plan");
  });

  it("falls back to the first line, then to 'Notes'", () => {
    expect(notesLabel("\n  Just a paragraph of notes.\n")).toBe("Just a paragraph of notes.");
    expect(notesLabel("   \n")).toBe("Notes");
  });

  it("is shortened past 60 characters", () => {
    const label = notesLabel(`# ${"a".repeat(80)}`);
    expect(label).toHaveLength(60);
    expect(label.endsWith("…")).toBe(true);
  });
});
