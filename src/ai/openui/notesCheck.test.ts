/**
 * The free check on the live 2026-11-13 replies (also scored offline in evaluation/knowledge-notes/experiments/openui-2026-11-13):
 * the same deterministic findings must show up here, where the Notes view runs it.
 * The reply fixture in `__fixtures__/` is a byte-identical copy of that experiment's `kn-02-edge-cache-invalidation.openui.txt`
 * (sha256 deff19ea…d171); the original stays where it is, because the frozen experiment data references it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { checkGeneratedCards } from "./notesCheck";
import { annotateUnits, cardOf, notesInputOf, generateOpenUiNotesTask, splitCards } from "./notesTask";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
const SOURCE = read("../../../evaluation/knowledge-notes/cases/kn-02-edge-cache-invalidation/source.md");
const REPLY = read("./__fixtures__/kn-02-edge-cache-invalidation.openui.txt");

describe("checkGeneratedCards (kn-02, the live reply)", () => {
  it("finds what the offline experiment found: most cards Needs review, protected details missing", async () => {
    const units = (await splitUnits(SOURCE)).units;
    const known = new Set(units.map((u) => u.id));
    const cards = splitCards(REPLY).flatMap((b, i) => cardOf(b, i, known) ?? []);
    const check = checkGeneratedCards(cards, units);
    expect(check.units).toBe(64);
    expect(check.cardsNeedingReview).toBe(12);
    expect(check.detailsMissing).toBe(48);
    expect(check.unitsNotCovered).toBe(33);
    const flagged = Object.entries(check.reviews).find(([, r]) => r.reasons.some((x) => x.includes("300")));
    expect(flagged, "a card is flagged for a missing number").toBeTruthy();
  });

  it("a card keeping its unit's details and condition is not flagged", async () => {
    const units = (await splitUnits("Keys expire after 24 hours, but only when the request completed.")).units;
    const check = checkGeneratedCards([{ key: "g1", title: "Keys expire", body: "Keys expire after 24 hours, but only when the request completed.", cites: [units[0]!.id] }], units);
    expect(check.cardsNeedingReview).toBe(0);
    expect(check.unitsNotCovered).toBe(0);
  });
});

describe("the prompt marks what must be kept", () => {
  it("lists protected details and conditions per unit", async () => {
    const units = (await splitUnits(SOURCE)).units;
    const annotated = annotateUnits(units);
    const prompt = generateOpenUiNotesTask.buildPrompt({ input: notesInputOf(annotated) }).prompt;
    expect(prompt).toMatch(/⟨keep exactly: [^⟩]*"300 seconds"/);
    expect(prompt).toContain("⟨condition⟩");
    expect(annotated.filter((u) => u.keep?.length).length).toBeGreaterThan(5);
  });
});
