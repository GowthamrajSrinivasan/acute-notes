/**
 * The ingest service (`ingest.ts`), the one entry point the Visualize dialog and the MCP tools share. Real pipeline, mock model: each mode
 * must give what calling the pipeline function directly gives, so moving the dialog's orchestration here changed nothing.
 */
import { describe, expect, it } from "vitest";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { updateFromNewContent } from "@/ai/reconcile/update";
import { visualizeContent } from "@/ai/visualize/visualize";
import { accepted, context, firstRun, modelReply, parse, runtimeWith } from "@/testUtils/reconcileHarness";
import { ingestContent, prepareProposal, sourceInput, SourceUnavailableError, withEconomy, type IngestPorts } from "./ingest";

const TEXT = "# Plan\n\nWe ship the first version in March.\n\nThe budget is fixed.";

const kinds = (set: { changes: readonly { kind: string }[] } | null) => (set ? set.changes.map((c) => c.kind) : null);

/** Ports for one accepted first run: its source in a one-entry store, its objects as the scene's. */
async function world(runtime = runtimeWith(modelReply).runtime) {
  const first = accepted(await firstRun(TEXT, runtime));
  const repo: ContentSourceRepository = {
    get: async (id) => (id === first.source.id ? first.source : null),
    getVersion: async (id, version) => (id === first.source.id && version === first.previous.version ? first.previous : null),
    append: async () => undefined,
    listByCanvas: async () => [first.source],
    delete: async () => undefined,
  };
  const ports = (rt = runtime): IngestPorts => ({ runtime: rt, contentSources: repo, renderContext: () => context, sourceObjects: () => ({ existing: first.existing, connections: [] }) });
  return { first, repo, ports };
}

describe("ingestContent, new notes", () => {
  it("is visualizeContent: the same change set for the same text and runtime", async () => {
    const direct = await visualizeContent({ text: TEXT, operationId: "op_a", title: "Visualize", context }, runtimeWith(modelReply).runtime, { parseMarkdown: parse });
    const { ports } = await world();
    const viaService = await ingestContent({ mode: "new", text: TEXT }, ports(runtimeWith(modelReply).runtime), { parseMarkdown: parse });
    expect(viaService.changeSet).not.toBeNull();
    expect(kinds(viaService.changeSet)).toEqual(kinds(direct.changeSet));
    expect(viaService.notices).toEqual(direct.notices);
    expect(viaService.changeSet!.title).toBe("Visualize");
  }, 60_000);

  it("takes the title the caller gives", async () => {
    const { ports } = await world();
    const r = await ingestContent({ mode: "new", text: TEXT, title: "Visualize: Selection" }, ports(runtimeWith(modelReply).runtime), { parseMarkdown: parse });
    expect(r.changeSet!.title).toBe("Visualize: Selection");
  }, 60_000);
});

describe("ingestContent, update", () => {
  it("is updateFromNewContent against the source's objects: an appended paragraph gives the same changes as the direct call", async () => {
    const { first, ports } = await world();
    const next = `${TEXT}\n\nA third point is added.`;
    const direct = await updateFromNewContent({ ...first, text: next, operationId: "op_b", title: "Update from new content", context }, runtimeWith(modelReply).runtime, { parseMarkdown: parse });
    const viaService = await ingestContent({ mode: "update", sourceId: first.source.id, text: next }, ports(runtimeWith(modelReply).runtime), { parseMarkdown: parse });
    expect(kinds(viaService.changeSet)).toEqual(kinds(direct.changeSet));
    expect(viaService.notices).toEqual(direct.notices);
    expect(viaService.changeSet!.title).toBe("Update from new content");
  }, 60_000);

  it("the same text again changes nothing: no change set, so nothing to propose", async () => {
    const { first, ports } = await world();
    const r = await ingestContent({ mode: "update", sourceId: first.source.id, text: first.previous.text }, ports(runtimeWith(modelReply).runtime), { parseMarkdown: parse });
    expect(r.changeSet).toBeNull();
  }, 60_000);

  it("a source that is not on this device is refused with the dialog's own error, before any model call", async () => {
    const { ports } = await world();
    const rt = runtimeWith(modelReply);
    await expect(ingestContent({ mode: "update", sourceId: "missing", text: TEXT }, ports(rt.runtime), { parseMarkdown: parse })).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(rt.spy).not.toHaveBeenCalled();
  });
});

describe("sourceInput", () => {
  it("places new objects beside the ones the source already has", async () => {
    const { first, ports } = await world();
    const input = await sourceInput(ports(), first.source.id, "text", "t");
    const boxes = first.existing.flatMap((o) => (o.box ? [o.box] : []));
    expect(boxes.length).toBeGreaterThan(0);
    expect(input.context.anchor).toEqual({
      x: Math.min(...boxes.map((b) => b.x)),
      y: Math.min(...boxes.map((b) => b.y)),
      width: Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
      height: Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
    });
    expect(input.existing).toBe(first.existing);
    expect(input.text).toBe("text");
    expect(input.title).toBe("t");
  });
});

describe("withEconomy and prepareProposal", () => {
  it("economy is absent unless chosen, so the default merge is untouched", () => {
    const input = { a: 1 } as never;
    expect(withEconomy(input, false)).toBe(input);
    expect(withEconomy(input, true)).toEqual({ a: 1, economy: true });
  });

  it("a change set that fits one review is proposed as it is, with the notices as they were", async () => {
    const { ports } = await world();
    const r = await ingestContent({ mode: "new", text: TEXT }, ports(runtimeWith(modelReply).runtime), { parseMarkdown: parse });
    const prepared = prepareProposal(r.changeSet!, ["one notice"]);
    expect(prepared.proposal.parts).toBeUndefined();
    expect(prepared.notices).toEqual(["one notice"]);
    expect(prepared.proposal.changes.length).toBe(r.changeSet!.changes.length);
  }, 60_000);
});
