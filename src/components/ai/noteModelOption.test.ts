import { describe, expect, it } from "vitest";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import {
  DISTIL_OPT_IN_HELP,
  DISTIL_OPT_IN_LABEL,
  KEEP_FULL_DETAIL_HELP,
  KEEP_FULL_DETAIL_LABEL,
  noteModelControl,
  runNoteModel,
  showsNoteModelChoice,
} from "./noteModelOption";

describe("Note model choice (WP2.8)", () => {
  it("before R1: distil is offered as early access, opt-in (approved 2026-11-17); the global model stays preserve", () => {
    expect(FIDELITY_CONFIG.noteModelChoice).toBe("opt-in");
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
    expect(showsNoteModelChoice()).toBe(true);
  });
  it("hidden: no control and no note model for the run, whatever the box says", () => {
    const config = { noteModelChoice: "hidden" } as const;
    expect(showsNoteModelChoice(config)).toBe(false);
    expect(noteModelControl(config)).toBeNull();
    expect(runNoteModel(false, config)).toBeUndefined();
    expect(runNoteModel(true, config)).toBeUndefined();
  });
  it("opt-in: the configured model unless ticked, distil when ticked", () => {
    const config = { noteModelChoice: "opt-in" } as const;
    expect(runNoteModel(false, config)).toBeUndefined();
    expect(runNoteModel(true, config)).toBe("distil");
    expect(noteModelControl(config)).toEqual({ label: DISTIL_OPT_IN_LABEL, help: DISTIL_OPT_IN_HELP });
  });
  it("default (R1): distil unless ticked, preserve with Keep full detail", () => {
    const config = { noteModelChoice: "default" } as const;
    expect(runNoteModel(false, config)).toBe("distil");
    expect(runNoteModel(true, config)).toBe("preserve");
    expect(noteModelControl(config)).toEqual({ label: KEEP_FULL_DETAIL_LABEL, help: KEEP_FULL_DETAIL_HELP });
  });
  it("labels and one short line of help each", () => {
    expect(KEEP_FULL_DETAIL_LABEL).toBe("Keep full detail");
    expect(KEEP_FULL_DETAIL_HELP).toMatch(/word for word/);
    expect(DISTIL_OPT_IN_LABEL).toMatch(/early access/);
    expect(DISTIL_OPT_IN_HELP).toMatch(/Needs review/);
  });
});
