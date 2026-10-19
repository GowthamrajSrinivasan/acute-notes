import { describe, expect, it } from "vitest";
import { fingerprintContent } from "@/ai/content/fingerprint";
import { renderVisualPlan } from "@/ai/renderer/render";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { cachedNodeFingerprint, nodeFingerprint, updateChange } from "./nodes";

const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const analysis = { id: "a1", type: "text", origin: "analysis", title: "Status", stableKey: "S § text#0", content: { markdown: "The main point is local storage." } } as VisualNode;
const context = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };

describe("an analysis node (its title tagged 'Analysis ·' when written)", () => {
  it("fingerprints as the writer stamps it: the content of the change it is written with", async () => {
    const set = await renderVisualPlan({ version: 1, template: "sectioned", nodes: [analysis], relationships: [] } as VisualPlan, { operationId: "op", title: "t", metadata: { createdBy: "ai" }, context, parseMarkdown: parse });
    const created = set.changes.find((c) => c.kind === "create_block")!;
    expect(created.kind === "create_block" && fingerprintContent(created.content)).toBe(nodeFingerprint(analysis, parse));
  });

  it("keeps its tag when updated", () => {
    const update = updateChange(analysis, "el_1", parse);
    expect(JSON.stringify(update)).toContain("Analysis · Status");
  });

  it("is cached apart from the same content without the tag", () => {
    const plain = { ...analysis, origin: undefined, title: undefined } as VisualNode;
    const cacheBy = (md: string) => parse(md);
    expect(cachedNodeFingerprint(plain, parse, cacheBy)).not.toBe(cachedNodeFingerprint(analysis, parse, cacheBy));
  });
});
