/**
 * `ingestContent` routes each mode to its pipeline function with exactly what the dialog used to give it: merge is append-only territory
 * (the pipeline sets that itself), economy only when chosen, the cleaned text and the title as given. The pipelines are mocked here: this is
 * about the hand-off, `ingest.test.ts` is about the real pipeline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ merge: [] as unknown[][], update: [] as unknown[][], visualize: [] as unknown[][] }));
vi.mock("@/ai/merge/merge", () => ({ mergeIntoSource: async (...a: unknown[]) => (calls.merge.push(a), { changeSet: null, notices: ["merge notice"], report: { choices: ["How it reads"] } }) }));
vi.mock("@/ai/reconcile/update", () => ({ updateFromNewContent: async (...a: unknown[]) => (calls.update.push(a), { changeSet: null, notices: ["update notice"] }) }));
vi.mock("@/ai/visualize/visualize", () => ({ visualizeContent: async (...a: unknown[]) => (calls.visualize.push(a), { changeSet: null, notices: ["new notice"] }) }));

import type { IngestPorts } from "./ingest";
import { ingestContent } from "./ingest";

const source = { id: "src_1", latestVersion: 2 };
const version = { sourceId: "src_1", version: 2, text: "old", plan: {} };
const ports = (): IngestPorts =>
  ({
    runtime: { run: vi.fn(), decide: vi.fn() } as never,
    contentSources: { get: async () => source, getVersion: async () => version } as never,
    renderContext: () => ({ existing: [], viewport: { x: 0, y: 0, width: 1, height: 1 } }) as never,
    sourceObjects: () => ({ existing: [], connections: [] }),
  }) as IngestPorts;

beforeEach(() => {
  calls.merge.length = calls.update.length = calls.visualize.length = 0;
});

describe("ingestContent routing", () => {
  it("merge: the pipeline's own input with economy only when chosen, and the title and text as given", async () => {
    const off = await ingestContent({ mode: "merge", sourceId: "src_1", text: "new text" }, ports());
    expect(off).toEqual({ changeSet: null, notices: ["merge notice"], choices: ["How it reads"] });
    const offInput = calls.merge[0]![0] as Record<string, unknown>;
    expect("economy" in offInput).toBe(false);
    expect(offInput).toMatchObject({ text: "new text", title: "Merge into existing notes" });
    await ingestContent({ mode: "merge", sourceId: "src_1", text: "t", economy: true, title: "Custom" }, ports());
    expect(calls.merge[1]![0]).toMatchObject({ economy: true, title: "Custom" });
    expect(calls.update).toHaveLength(0);
    expect(calls.visualize).toHaveLength(0);
  });

  it("update: reconciles the source's objects, and the progress and signal are handed on", async () => {
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    await ingestContent({ mode: "update", sourceId: "src_1", text: "edited" }, ports(), { signal, onProgress });
    expect(calls.update[0]![0]).toMatchObject({ text: "edited", title: "Update from new content", previous: version, source });
    expect(calls.update[0]![2]).toMatchObject({ signal, onProgress });
    expect(calls.merge).toHaveLength(0);
  });

  it("new: the template and the local-only choice reach visualizeContent, and nothing is read from a source", async () => {
    await ingestContent({ mode: "new", text: "x", template: "architecture", forceLocalOnly: true, title: "Visualize: Selection" }, ports());
    expect(calls.visualize[0]![0]).toMatchObject({ text: "x", template: "architecture", forceLocalOnly: true, title: "Visualize: Selection" });
    await ingestContent({ mode: "new", text: "y" }, ports());
    expect(calls.visualize[1]![0]).toMatchObject({ forceLocalOnly: false, title: "Visualize" });
  });
});
