/**
 * "Re-visualize with AI" on a selection: only the selected section may change; every other section's objects stay exactly as they are.
 */
import { describe, expect, it } from "vitest";
import type { AIRequest } from "@/ai/types";
import { accepted, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { updateFromNewContent } from "./update";

const PROSE = `Intro prose about the whole system.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nThis part explains how the system handles case ${i}. It checks permissions and records the outcome.`).join("\n\n")}`;

/** The text as it reads now: other sections differ from the stored version (cleaning, edits) — a selection's re-run must not care. */
const DRIFTED = PROSE.replace("case 5.", "case 5 [1].").replace("case 7.", "case seven.").replace("Intro prose", "Intro: prose");

function model(regen: { on: boolean }) {
  return (req: AIRequest) => {
    if (req.task === "outline_document") return response(JSON.stringify({ summary: "S", sections: Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, label: i === 0 ? "Intro" : `Part ${i - 1}`, kind: "notes", parts: [`u${i + 1}`] })) }));
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", nodes: [] }));
    const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
    // A regeneration answers differently from the first run (other nodes, other wording), as a real model does.
    const nodes = regen.on
      ? [{ id: "x1", type: "text", content: { markdown: `Regenerated: ${body.slice(0, 80)}` } }, { id: "x2", type: "text", content: { markdown: "Another card." } }]
      : [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }];
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes, relationships: [], metadata: { takeaway: "T" } }));
  };
}

describe("regenerate (Re-visualize with AI) is scoped to the selected sections", () => {
  it("proposes changes only inside the selected section", async () => {
    const regen = { on: false };
    const { runtime, spy } = runtimeWith(model(regen));
    const a = accepted(await firstRun(PROSE, runtime));
    regen.on = true;
    spy.mockClear();
    const r = await updateFromNewContent({ ...a, text: DRIFTED, operationId: "op_r", title: "Re-visualize", context }, runtime, { parseMarkdown: parse, regenerate: ["Part 3"] });
    const outside = (key: string) => !key.startsWith("Part 3 ");
    const touched = r.reconciliation.items.flatMap((i) => (i.state === "remove" ? [i.object.stableNodeKey] : i.state === "add" ? [i.node.stableKey ?? ""] : i.state === "update_clean" || i.state === "update_conflict" ? [i.object.stableNodeKey] : []));
    expect(touched.filter(outside)).toEqual([]);
    expect(r.removals.filter((x) => outside(x.key))).toEqual([]);
    // Not vacuous: the selected section's own objects are what changes (replaced), and nothing else is named by any change.
    expect(touched.length).toBeGreaterThan(0);
    const mine = new Set(a.existing.filter((o) => !outside(o.stableNodeKey)).map((o) => o.objectId));
    for (const c of r.changeSet!.changes) if ("target" in c && c.kind !== "update_frame" && c.kind !== "move") expect(mine.has(c.target)).toBe(true);
    expect(r.reanalyzedUnits).toEqual(["Part 3"]);
    expect(spy.mock.calls.filter((c) => c[0]!.task === "generate_visual_plan")).toHaveLength(1);
    expect(spy.mock.calls.filter((c) => c[0]!.task === "outline_document")).toHaveLength(0);
  }, 20_000);
});
