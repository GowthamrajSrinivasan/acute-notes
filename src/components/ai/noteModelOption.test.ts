import { describe, expect, it } from "vitest";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { KEEP_FULL_DETAIL_HELP, KEEP_FULL_DETAIL_LABEL, runNoteModel, showsNoteModelChoice } from "./noteModelOption";

describe("Keep full detail option (WP2.8)", () => {
  it("is hidden by default, until R1", () => {
    expect(FIDELITY_CONFIG.showNoteModelChoice).toBe(false);
    expect(showsNoteModelChoice()).toBe(false);
  });
  it("hidden: no note model for the run, whatever the box says (the run uses FIDELITY_CONFIG.noteModel)", () => {
    expect(runNoteModel(false, { showNoteModelChoice: false })).toBeUndefined();
    expect(runNoteModel(true, { showNoteModelChoice: false })).toBeUndefined();
  });
  it("shown: distil by default, preserve with Keep full detail", () => {
    expect(runNoteModel(false, { showNoteModelChoice: true })).toBe("distil");
    expect(runNoteModel(true, { showNoteModelChoice: true })).toBe("preserve");
  });
  it("label and one short line of help", () => {
    expect(KEEP_FULL_DETAIL_LABEL).toBe("Keep full detail");
    expect(KEEP_FULL_DETAIL_HELP).toMatch(/word for word/);
    expect(KEEP_FULL_DETAIL_HELP).toMatch(/specs, legal text/);
  });
});
