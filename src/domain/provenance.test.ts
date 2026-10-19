import { describe, expect, it } from "vitest";
import { describeProvenance, normalizeAIMetadata, normalizeObjectMetadata, objectsFromOperation, provenanceOf, reconciliationOf, sourceRefsOf, type ProvenanceElement } from "./provenance";
import type { DocumentRecord } from "./types";

const doc = (id: string, ai?: unknown): DocumentRecord => ({
  id,
  workspaceId: "ws",
  kind: "block",
  title: "t",
  snapshot: [],
  createdAt: 0,
  updatedAt: 0,
  ...(ai ? { metadata: { ai } as DocumentRecord["metadata"] } : {}),
});

describe("normalizeAIMetadata", () => {
  it("keeps every known field", () => {
    const full = {
      createdBy: "ai",
      operationId: "op_1",
      task: "generate_visual_plan",
      provider: "copilot",
      authType: "subscription",
      model: "gpt-5",
      template: "flowchart",
      visualPlanNodeId: "n1",
      sourceRefs: [{ provider: "github", externalId: "42", url: "https://github.com/o/r/issues/42", lastSyncedAt: 5 }],
    };
    expect(normalizeAIMetadata(full)).toEqual(full);
  });

  it("drops unknown fields — anything that could carry a secret — and invalid values", () => {
    const out = normalizeAIMetadata({
      createdBy: "ai",
      provider: "openai",
      apiKey: "sk-live-123",
      token: "ghp_abc",
      authType: "password",
      model: 42,
      sourceRefs: [{ provider: "x", url: "javascript:alert(1)", secret: "s" }, { url: "https://no-provider" }, "junk"],
    });
    expect(out).toEqual({ createdBy: "ai", provider: "openai", sourceRefs: [{ provider: "x" }] });
    expect(JSON.stringify(out)).not.toMatch(/sk-live|ghp_|secret|javascript/);
  });

  it("is optional and backwards-compatible: no or invalid origin means no provenance", () => {
    expect(normalizeAIMetadata(undefined)).toBeUndefined();
    expect(normalizeAIMetadata({ task: "summarize" })).toBeUndefined();
    expect(normalizeAIMetadata({ createdBy: "robot" })).toBeUndefined();
    expect(normalizeAIMetadata({ createdBy: "user" })).toEqual({ createdBy: "user" });
  });

  it("bounds sizes", () => {
    const out = normalizeAIMetadata({ createdBy: "mcp", model: "m".repeat(5000), sourceRefs: Array.from({ length: 100 }, (_, i) => ({ provider: `p${i}` })) });
    expect(out!.model!.length).toBe(200);
    expect(out!.sourceRefs).toHaveLength(20);
  });
});

describe("normalizeObjectMetadata", () => {
  it("keeps title, tags, source and provenance; drops the rest", () => {
    expect(
      normalizeObjectMetadata({ title: "T", tags: ["a", 3, ""], source: { provider: "drive", url: "https://x.test/a" }, ai: { createdBy: "import" }, password: "p" }),
    ).toEqual({ title: "T", tags: ["a"], source: { provider: "drive", url: "https://x.test/a" }, ai: { createdBy: "import" } });
    expect(normalizeObjectMetadata({ password: "p" })).toBeUndefined();
    expect(normalizeObjectMetadata("nope")).toBeUndefined();
  });
});

describe("object provenance", () => {
  const docs = new Map([
    ["d1", doc("d1", { createdBy: "ai", operationId: "op_1", task: "summarize" })],
    ["d2", doc("d2", { createdBy: "user" })],
  ]);
  const get = (id: string) => docs.get(id);
  const block = (id: string, documentId: string): ProvenanceElement => ({ id, type: "embeddable", isDeleted: false, customData: { acute: { kind: "rich-block", documentId } } });
  const elements: ProvenanceElement[] = [
    block("b1", "d1"),
    block("b2", "d2"),
    { id: "s1", type: "rectangle", isDeleted: false, customData: { acuteMeta: { ai: { createdBy: "ai", operationId: "op_1" } } } },
    { id: "s1-label", type: "text", isDeleted: false, containerId: "s1", customData: { acuteMeta: { ai: { createdBy: "ai", operationId: "op_1" } } } },
    { id: "gone", type: "rectangle", isDeleted: true, customData: { acuteMeta: { ai: { createdBy: "ai", operationId: "op_1" } } } },
    { id: "plain", type: "ellipse", isDeleted: false },
  ];

  it("reads blocks' provenance from their document, other objects' from the element", () => {
    expect(provenanceOf(elements[0]!, get)).toMatchObject({ createdBy: "ai", operationId: "op_1" });
    expect(provenanceOf(elements[2]!, get)).toEqual({ createdBy: "ai", operationId: "op_1" });
    expect(provenanceOf(elements[5]!, get)).toBeUndefined();
  });

  it("reads an object's source refs from wherever its provenance lives", () => {
    const ref = { provider: "repo", externalId: "src/a.ts#L1-9@abc" };
    const refDocs = new Map([["d3", doc("d3", { createdBy: "mcp", sourceRefs: [ref] })]]);
    expect(sourceRefsOf(block("b3", "d3"), (id) => refDocs.get(id))).toEqual([ref]);
    expect(sourceRefsOf({ customData: { acuteMeta: { ai: { createdBy: "mcp", sourceRefs: [ref, { nope: 1 }] } } } }, get)).toEqual([ref]);
    expect(sourceRefsOf(elements[5]!, get)).toEqual([]);
  });

  it("finds the live objects of one operation (labels go with their container)", () => {
    expect(objectsFromOperation(elements, "op_1", get)).toEqual(["b1", "s1"]);
    expect(objectsFromOperation(elements, "op_x", get)).toEqual([]);
  });

  it("describes an origin for display, and nothing for user objects", () => {
    expect(describeProvenance({ createdBy: "ai", task: "summarize", provider: "copilot", model: "gpt-5", operationId: "op_1" }, () => "GitHub Copilot")).toEqual({
      origin: "Created by AI",
      detail: "Summarize · GitHub Copilot · gpt-5",
      operationId: "op_1",
    });
    expect(describeProvenance({ createdBy: "import", sourceRefs: [{ provider: "github" }] })).toEqual({ origin: "Imported", detail: "from github", operationId: null });
    expect(describeProvenance({ createdBy: "user" })).toBeNull();
    expect(describeProvenance(undefined)).toBeNull();
  });
});

describe("reconciliation fields (F37)", () => {
  const raw = {
    createdBy: "ai",
    operationId: "op_1",
    contentSourceId: "src_1",
    contentSourceVersion: 2,
    stableNodeKey: "Plan#todo0",
    contentFingerprint: "c123",
    excludeFromReconciliation: true,
  };

  it("are dropped by default, so every descriptive reader (export, MCP, the Origin section) never sees them", () => {
    expect(normalizeAIMetadata(raw)).toEqual({ createdBy: "ai", operationId: "op_1" });
    expect(normalizeObjectMetadata({ ai: raw })).toEqual({ ai: { createdBy: "ai", operationId: "op_1" } });
  });

  it("are kept, validated and bounded only when asked for", () => {
    expect(normalizeAIMetadata(raw, { reconciliation: true })).toEqual(raw);
    expect(normalizeAIMetadata({ ...raw, contentSourceVersion: -1, excludeFromReconciliation: "yes" }, { reconciliation: true })).not.toHaveProperty("contentSourceVersion");
  });

  it("reconciliationOf reads a complete link from a block's document or a shape's element, and nothing for manual objects", () => {
    const docs = new Map([["d1", doc("d1", raw)], ["d2", doc("d2", { createdBy: "user" })]]);
    const get = (id: string) => docs.get(id);
    const block = (documentId: string): ProvenanceElement => ({ id: "b", type: "embeddable", isDeleted: false, customData: { acute: { kind: "rich-block", documentId } } });
    expect(reconciliationOf(block("d1"), get)).toEqual({ contentSourceId: "src_1", contentSourceVersion: 2, stableNodeKey: "Plan#todo0", contentFingerprint: "c123", excludeFromReconciliation: true });
    expect(reconciliationOf(block("d2"), get)).toBeUndefined();
    const shapeWith = (ai: unknown): ProvenanceElement => ({ id: "s", type: "rectangle", isDeleted: false, customData: { acuteMeta: { ai } } });
    expect(reconciliationOf(shapeWith(raw), get)?.stableNodeKey).toBe("Plan#todo0");
    expect(reconciliationOf(shapeWith({ ...raw, contentFingerprint: undefined }), get)).toBeUndefined();
  });

  it("a split piece's link (F42 Phase 4) names the node it is part of, only when both split fields are there", () => {
    const shapeWith = (ai: unknown): ProvenanceElement => ({ id: "s", type: "rectangle", isDeleted: false, customData: { acuteMeta: { ai } } });
    const piece = { ...raw, stableNodeKey: "Plan#table0 ⊃ piece#1", splitOf: "Plan#table0", splitFingerprint: "t456" };
    expect(reconciliationOf(shapeWith(piece), () => undefined)?.splitOf).toEqual({ stableNodeKey: "Plan#table0", fingerprint: "t456" });
    expect(reconciliationOf(shapeWith({ ...piece, splitFingerprint: undefined }), () => undefined)).not.toHaveProperty("splitOf");
    expect(normalizeAIMetadata(piece)).not.toHaveProperty("splitOf"); // descriptive readers never see it
  });
});
