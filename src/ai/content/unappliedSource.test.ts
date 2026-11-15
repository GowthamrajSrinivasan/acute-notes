/**
 * `withUnappliedNodes` / `recordPartlyAppliedSource` (Stage 1 gate 4 follow-up): the version an accept records keeps,
 * for each card it left unapplied, the previous version's node — in the plan and in the text — and records nothing
 * when that can't be done exactly. The end-to-end retry is in `components/ai/unapplied.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { ContentSourceRecord } from "@/ai/changes/changeSet";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { loadLatest, recordAcceptedSource, recordPartlyAppliedSource, withUnappliedNodes } from "./sources";

const home = { workspaceId: "ws", canvasId: "cv" };

/** A text of "## Title\n\nbody" sections and the local-tier-like plan over it (a heading node and a text node each, with spans). */
function version(sections: [string, string][]): { text: string; plan: VisualPlan } {
  let text = "";
  const nodes: VisualNode[] = [];
  for (const [title, body] of sections) {
    const h = `## ${title}`;
    nodes.push({ id: `h_${title}`, type: "heading", content: { text: title }, sourceSpan: { start: text.length, end: text.length + h.length }, stableKey: `${title}#heading0` } as VisualNode);
    text += `${h}\n\n`;
    nodes.push({ id: `t_${title}`, type: "text", content: { markdown: body }, sourceSpan: { start: text.length, end: text.length + body.length }, stableKey: `${title}#text0` } as VisualNode);
    text += `${body}\n\n`;
  }
  return { text, plan: { version: 1, template: "document-stack", nodes, relationships: [] } as unknown as VisualPlan };
}

const V1 = version([
  ["Limits", "Four servers."],
  ["Retries", "Three times."],
  ["Regions", "Two regions."],
]);
const V2 = version([
  ["Limits", "Six servers."],
  ["Retries", "Five times, with a backoff."],
  ["Regions", "Three regions."],
]);
const rec = (v: { text: string; plan: VisualPlan }, n: number, extra: Partial<ContentSourceRecord> = {}): ContentSourceRecord => ({
  sourceId: "src_1",
  version: n,
  origin: "paste",
  tier: "local",
  template: "document-stack",
  text: v.text,
  plan: v.plan,
  ...extra,
});
const node = (r: ContentSourceRecord, key: string) => (r.plan as VisualPlan).nodes.find((n) => n.stableKey === key)!;
const spanText = (r: ContentSourceRecord, key: string) => r.text.slice(node(r, key).sourceSpan!.start, node(r, key).sourceSpan!.end);

describe("withUnappliedNodes", () => {
  it("puts the previous node back in the plan and its passage in the text; later spans move with it; the rest stays as proposed", () => {
    const kept = withUnappliedNodes(rec(V2, 2, { units: { units: [], nextId: 1 } as never, lineage: [] as never }), V1, ["Retries#text0"])!;
    expect(kept.text).toBe(V2.text.replace("Five times, with a backoff.", "Three times."));
    expect(node(kept, "Retries#text0").content).toEqual({ markdown: "Three times." });
    // Every node's span still points at its own passage in the recorded text.
    for (const n of (kept.plan as VisualPlan).nodes) expect(spanText(kept, n.stableKey!)).toBe(n.type === "heading" ? `## ${(n.content as { text: string }).text}` : (n.content as { markdown: string }).markdown);
    expect(node(kept, "Limits#text0").content).toEqual({ markdown: "Six servers." });
    expect(node(kept, "Regions#text0").content).toEqual({ markdown: "Three regions." });
    // The proposed text's units don't describe this text: the recording computes them again.
    expect(kept.units).toBeUndefined();
    expect(kept.lineage).toBeUndefined();
  });

  it("several nodes at once, in any order", () => {
    const kept = withUnappliedNodes(rec(V2, 2), V1, ["Regions#text0", "Limits#text0"])!;
    expect(kept.text).toBe(V2.text.replace("Six servers.", "Four servers.").replace("Three regions.", "Two regions."));
    for (const key of ["Limits#text0", "Retries#text0", "Regions#text0"]) expect(spanText(kept, key)).toBe((node(kept, key).content as { markdown: string }).markdown);
  });

  it("keys this source's plan doesn't have, and nodes that didn't change, need nothing", () => {
    const r = rec(V2, 2);
    expect(withUnappliedNodes(r, V1, ["Elsewhere#text0"])).toBe(r);
    expect(withUnappliedNodes(r, V2, ["Retries#text0"])).toBe(r);
  });

  it("null when a node can't be put back exactly: a heading, no span, no previous node", () => {
    expect(withUnappliedNodes(rec(V2, 2), V1, ["Retries#heading0"])).toBeNull();
    const noSpan = { ...V2.plan, nodes: V2.plan.nodes.map((n) => (n.stableKey === "Retries#text0" ? { ...n, sourceSpan: undefined } : n)) };
    expect(withUnappliedNodes(rec({ text: V2.text, plan: noSpan }, 2), V1, ["Retries#text0"])).toBeNull();
    const without = { ...V1.plan, nodes: V1.plan.nodes.filter((n) => n.stableKey !== "Retries#text0") };
    expect(withUnappliedNodes(rec(V2, 2), { text: V1.text, plan: without }, ["Retries#text0"])).toBeNull();
    expect(withUnappliedNodes(rec(V2, 2), { text: V1.text, plan: null }, ["Retries#text0"])).toBeNull();
  });
});

describe("recordPartlyAppliedSource", () => {
  it("records the version with the unapplied node as it was", async () => {
    const { contentSources } = createMemoryServices();
    await recordAcceptedSource(contentSources, home, rec(V1, 1), 1);
    void recordPartlyAppliedSource(contentSources, home, rec(V2, 2), ["Retries#text0"], 2);
    // Accept doesn't wait; the next update's read does.
    const latest = (await loadLatest(contentSources, "src_1"))!;
    expect(latest.version).toMatchObject({ version: 2, text: V2.text.replace("Five times, with a backoff.", "Three times.") });
  });

  it("with nothing unapplied, records the version as proposed", async () => {
    const { contentSources } = createMemoryServices();
    await recordAcceptedSource(contentSources, home, rec(V1, 1), 1);
    await recordPartlyAppliedSource(contentSources, home, rec(V2, 2), [], 2);
    expect((await loadLatest(contentSources, "src_1"))!.version).toMatchObject({ version: 2, text: V2.text });
  });

  it("when the unapplied node can't be kept apart, records nothing: the next update diffs from the previous version, nothing is lost", async () => {
    const { contentSources } = createMemoryServices();
    await recordAcceptedSource(contentSources, home, rec(V1, 1), 1);
    await recordPartlyAppliedSource(contentSources, home, rec(V2, 2), ["Retries#heading0"], 2);
    expect((await loadLatest(contentSources, "src_1"))!.version).toMatchObject({ version: 1, text: V1.text });
  });
});
