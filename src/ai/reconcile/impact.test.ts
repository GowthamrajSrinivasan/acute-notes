/**
 * Stage 3 (intelligent-update-engine-plan, multi-location sync, Case A): impact discovery over the real update pipeline —
 * the local tier, so no model call — then accept as the review does. Plan tests: every card that repeats a changed fact is
 * offered the same edit; link-only and other-words cases are listed, never over-written; nothing reaches the canvas
 * without its own decision.
 */
import { describe, expect, it } from "vitest";
import { acceptChangeSet, type ChangeSetCanvas } from "@/ai/changes/accept";
import { parseChangeSet, type ChangeSet, type ConflictItem, type ProposedChange } from "@/ai/changes/changeSet";
import { blockPlainText } from "@/ai/changes/claimPatch";
import { fingerprintContent } from "@/ai/content/fingerprint";
import { ingestContent, type IngestPorts } from "@/ai/ingest/ingest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { withLock } from "@/domain/canvas/lock";
import type { DocumentRecord, RichContent } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { accepted, context, firstRun, parse, response, runtimeWith, type Accepted } from "@/testUtils/reconcileHarness";
import { conflictName, proposedText, withDecisions, type ConflictDecision } from "./conflicts";
import { discoverImpact, wholeWordIndexes, withImpact, type ImpactInput } from "./impact";
import { updateFromNewContent } from "./update";
import { DEFAULT_UPDATE_POLICY } from "./updatePolicy";

const LIMITS_TEXT = "Retries happen five times. Timeouts last ten seconds.";
const DOC = `# Service\n\n## Limits\n\n${LIMITS_TEXT}\n\n## Owners\n\nPayments team.\n`;
const LIMITS = "Service › Limits#text0";
const OWNERS = "Service › Owners#text0";
const { runtime, spy } = runtimeWith(() => response("never"));

const para = (content: string, id = "blk"): RichContent => [{ id, type: "paragraph", props: {}, content }];

/** A canvas: the source's cards as the writer stamped them, plus cards from elsewhere; elements and their documents. */
class Scene {
  readonly elements: SceneElement[] = [];
  readonly docs = new Map<string, DocumentRecord>();
  card(id: string, content: RichContent, opts: { ai?: Record<string, unknown>; locked?: boolean; frameId?: string } = {}): this {
    const documentId = `doc_${id}`;
    this.docs.set(documentId, { id: documentId, workspaceId: "ws", kind: "block", title: "", snapshot: content, createdAt: 1, updatedAt: 1, ...(opts.ai ? { metadata: { ai: opts.ai } } : {}) } as DocumentRecord);
    const customData = { acute: { kind: "rich-block", blockType: "text", documentId } };
    this.elements.push({ id, type: "embeddable", x: 0, y: this.elements.length * 120, width: 300, height: 100, isDeleted: false, customData: opts.locked ? withLock(customData, true) : customData, ...(opts.frameId ? { frameId: opts.frameId } : {}) } as unknown as SceneElement);
    return this;
  }
  frame(id: string, locked = false): this {
    this.elements.push({ id, type: "frame", x: 0, y: 0, width: 900, height: 900, isDeleted: false, customData: locked ? withLock({}, true) : {} } as unknown as SceneElement);
    return this;
  }
  shape(id: string, label: string): this {
    this.elements.push({ id, type: "rectangle", x: 0, y: 0, width: 100, height: 60, isDeleted: false, customData: { acuteShape: "process" } } as unknown as SceneElement);
    this.elements.push({ id: `${id}_label`, type: "text", containerId: id, text: label, originalText: label, x: 0, y: 0, width: 90, height: 20, isDeleted: false } as unknown as SceneElement);
    return this;
  }
  arrow(id: string, from: string, to: string): this {
    this.elements.push({ id, type: "arrow", x: 0, y: 0, width: 10, height: 10, isDeleted: false, startBinding: { elementId: from }, endBinding: { elementId: to } } as unknown as SceneElement);
    return this;
  }
  getDocument = (id: string) => this.docs.get(id) ?? null;
  contentOf(id: string): RichContent {
    return this.docs.get(`doc_${id}`)!.snapshot;
  }
}

async function setup(): Promise<Accepted> {
  const a = accepted(await firstRun(DOC, runtime));
  const limits = a.existing.find((o) => o.stableNodeKey === LIMITS)!;
  expect(fingerprintContent(para(LIMITS_TEXT))).toBe(limits.baseline);
  limits.rich = { content: para(LIMITS_TEXT) };
  return a;
}

const sourceAI = (a: Accepted, key: string) => ({
  createdBy: "ai",
  contentSourceId: a.source.id,
  contentSourceVersion: 1,
  stableNodeKey: key,
  contentFingerprint: a.existing.find((o) => o.stableNodeKey === key)!.baseline,
});
const idOf = (a: Accepted, key: string) => a.existing.find((o) => o.stableNodeKey === key)!.objectId;

/** The source's two text cards on the canvas, as written. */
function sourceScene(a: Accepted): Scene {
  return new Scene().card(idOf(a, LIMITS), para(LIMITS_TEXT), { ai: sourceAI(a, LIMITS) }).card(idOf(a, OWNERS), para("Payments team."), { ai: sourceAI(a, OWNERS) });
}

const update = (a: Accepted, text: string) => updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, runtime, { parseMarkdown: parse });
const impactOf = (a: Accepted, set: ChangeSet, scene: Scene, extra: Partial<ImpactInput> = {}) =>
  discoverImpact({ set, sourceId: a.source.id, elements: scene.elements, getDocument: scene.getDocument, ...extra });

/** Accepts `set` with the given decisions on `scene`, checking patches against its live content; returns what was written. */
function accept(set: ChangeSet, scene: Scene, decisions: Record<string, ConflictDecision> = {}) {
  const written: ProposedChange[] = [];
  const canvas: ChangeSetCanvas = {
    boxOf: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    contentOf: (id) => {
      const doc = scene.docs.get(`doc_${id}`);
      return doc ? { content: doc.snapshot, fingerprint: fingerprintContent(doc.snapshot) } : null;
    },
    write: (_s, changes) => (written.push(...changes), new Map()),
  };
  const result = acceptChangeSet(withDecisions(parseChangeSet(set), new Map(Object.entries(decisions))), canvas, { record: (f: () => void) => (f(), 1) });
  const textOf = (id: string) => {
    const c = written.find((w): w is Extract<ProposedChange, { kind: "update_block" }> => w.kind === "update_block" && w.target === id);
    return c ? c.content.map((b) => blockPlainText(b)).join("\n") : null;
  };
  return { written, result, textOf };
}

const FIVE_TO_THREE = DOC.replace("five times", "three times");

describe("Stage 3 — impact discovery", () => {
  it("the changed fact is offered on every card elsewhere that repeats it; other words and links are listed, not edited", async () => {
    const a = await setup();
    const limitsId = idOf(a, LIMITS);
    const scene = sourceScene(a)
      .card("u_repeat", para("Our worker retries five times before giving up."))
      .card("u_other_source", para("Retries happen five times."), { ai: { createdBy: "ai", contentSourceId: "src_other", contentSourceVersion: 1, stableNodeKey: "Other#text0", contentFingerprint: "x" } })
      .card("u_other_words", para("Retries happen up to 5 times."))
      .card("u_link", para("Retries are covered in the Limits card."))
      .card("u_unrelated", para("Deploys happen on Tuesdays."))
      .card("u_current", para("Retries happen three times."))
      .shape("s_label", "Retries happen five times")
      .arrow("a1", "u_link", limitsId);
    const r = await update(a, FIVE_TO_THREE);
    expect(spy).not.toHaveBeenCalled(); // the local tier: no model call
    const impact = impactOf(a, r.changeSet!, scene);

    expect(impact.claims).toEqual([{ from: limitsId, before: "Retries happen five times.", after: "Retries happen three times.", old: "five", replacement: "three", intent: "SUPERSEDES" }]);
    // Both cards that repeat it — the user's own and another source's — best match first.
    expect(impact.conflicts.map((c) => c.target)).toEqual(["u_other_source", "u_repeat"]);
    for (const c of impact.conflicts) {
      expect(c.apply.kind).toBe("patch_block");
      expect(c.keep).toBeUndefined(); // "Leave as is" adds nothing
      expect(c.stableNodeKey).toBeUndefined();
      expect(c.impact!.from).toBe(limitsId);
      expect(c.impact!.detail).toBe("replaces “five” → “three”");
    }
    expect(impact.conflicts[1]!.impact!.proposed).toBe("Our worker retries three times before giving up.");
    expect(conflictName(impact.conflicts[1]!)).toBe("Our worker retries five times before giving up.");
    expect(proposedText(impact.conflicts[1]!)).toBe("Our worker retries three times before giving up.");

    const related = Object.fromEntries(impact.related.map((r) => [r.target, r.reason]));
    expect(Object.keys(related).sort()).toEqual(["s_label", "u_link", "u_other_words"]);
    expect(related.u_other_words).toMatch(/in other words — not edited/);
    expect(related.u_link).toBe("linked to “Retries happen five times. Timeouts las…”, which this update changes — not edited");
    expect(related.s_label).toMatch(/a shape's label isn't edited here/);
    // The source's own Owners card, an unrelated card, a card already saying "three": nothing.
    const mentioned = [...impact.conflicts.map((c) => c.target), ...impact.related.map((x) => x.target)];
    for (const id of [idOf(a, OWNERS), "u_unrelated", "u_current"]) expect(mentioned).not.toContain(id);
    expect(impact.locked).toBe(0);
  }, 60_000);

  it("nothing elsewhere is written without its own decision: Accept all applies the source's change only; Update this too / Leave as is per card", async () => {
    const a = await setup();
    const scene = sourceScene(a).card("u_one", para("The worker retries five times.")).card("u_two", para("Note: retries happen five times in staging."));
    const r = await update(a, FIVE_TO_THREE);
    const set = withImpact(r.changeSet!, impactOf(a, r.changeSet!, scene));
    expect(set.conflicts!.map((c) => c.target).sort()).toEqual(["u_one", "u_two"]);
    expect(parseChangeSet(set)).toEqual(set); // the contract round-trips

    const all = accept(set, scene);
    expect(all.written.map((w) => ("target" in w ? w.target : null))).toEqual([idOf(a, LIMITS)]);
    expect(all.textOf(idOf(a, LIMITS))).toBe("Retries happen three times. Timeouts last ten seconds.");

    const chosen = accept(set, scene, { u_one: "apply", u_two: "keep" });
    expect(chosen.textOf("u_one")).toBe("The worker retries three times.");
    expect(chosen.textOf("u_two")).toBeNull();
    // Content only: no source link or node key, so the card keeps its own provenance (the user's edit to it).
    const w = chosen.written.find((c) => "target" in c && c.target === "u_one") as Extract<ProposedChange, { kind: "update_block" }>;
    expect(w.stableNodeKey).toBeUndefined();
    expect(w.sourceRefs).toBeUndefined();
  }, 60_000);

  it("every required target updated: two facts changed, each card gets the edits for the facts it repeats, atomically", async () => {
    const a = await setup();
    const scene = sourceScene(a)
      .card("u_both", para("Retries happen five times and timeouts last ten seconds."))
      .card("u_retries", para("The worker retries five times."))
      .card("u_timeouts", [...para("Timeouts last ten seconds on every call.", "b1"), ...para("Owned by the platform team.", "b2")]);
    const r = await update(a, DOC.replace("five times", "three times").replace("ten seconds", "twenty seconds"));
    const set = withImpact(r.changeSet!, impactOf(a, r.changeSet!, scene));
    const offered = Object.fromEntries((set.conflicts ?? []).map((c) => [c.target, c]));
    expect(Object.keys(offered).sort()).toEqual(["u_both", "u_retries", "u_timeouts"]);
    expect((offered.u_both!.apply as Extract<ProposedChange, { kind: "patch_block" }>).edits).toHaveLength(2);
    const done = accept(set, scene, { u_both: "apply", u_retries: "apply", u_timeouts: "apply" });
    expect(done.textOf("u_both")).toBe("Retries happen three times and timeouts last twenty seconds.");
    expect(done.textOf("u_retries")).toBe("The worker retries three times.");
    expect(done.textOf("u_timeouts")).toBe("Timeouts last twenty seconds on every call.\nOwned by the platform team.");
  }, 60_000);

  it("a fact extended at the source is extended elsewhere too (EXTENDS, not a replacement)", async () => {
    const a = await setup();
    const scene = sourceScene(a).card("u_worker", para("The worker retries five times."));
    const r = await update(a, DOC.replace("five times.", "five times with backoff."));
    const impact = impactOf(a, r.changeSet!, scene);
    expect(impact.claims[0]!.intent).toBe("EXTENDS");
    const set = withImpact(r.changeSet!, impact);
    expect(accept(set, scene, { u_worker: "apply" }).textOf("u_worker")).toBe("The worker retries five times with backoff.");
  }, 60_000);

  it("a contradiction or an unclear rewrite is escalated on its own card and never propagates", async () => {
    const a = await setup();
    const scene = sourceScene(a).card("u_repeat", para("Retries happen five times."));
    const r = await update(a, DOC.replace("Retries happen five times.", "Retries never happen."));
    expect(r.changeSet!.conflicts?.[0]?.escalation).toBeDefined();
    const impact = impactOf(a, r.changeSet!, scene);
    expect(impact).toEqual({ claims: [], conflicts: [], related: [], locked: 0 });
  }, 60_000);

  it("locked cards — their own lock or their section's — are left alone and counted; with Preserve locked sections off they are offered", async () => {
    const a = await setup();
    const scene = sourceScene(a)
      .frame("f_locked", true)
      .card("u_locked", para("Retries happen five times in staging."), { locked: true })
      .card("u_in_locked", para("The worker retries five times."), { frameId: "f_locked" });
    const r = await update(a, FIVE_TO_THREE);
    const impact = impactOf(a, r.changeSet!, scene);
    expect(impact.conflicts).toEqual([]);
    expect(impact.locked).toBe(2);
    expect(withImpact(r.changeSet!, impact).skipped).toEqual({ locked: 2 });
    const off = impactOf(a, r.changeSet!, scene, { preserveLockedSections: false });
    expect(off.conflicts.map((c) => c.target).sort()).toEqual(["u_in_locked", "u_locked"]);
  }, 60_000);

  it("a card opted out of AI updates is never offered; the source's own cards never are either", async () => {
    const a = await setup();
    const scene = sourceScene(a)
      .card("u_passage", para("Retries happen five times."), { ai: { createdBy: "ai", contentSourceId: "src_other", contentSourceVersion: 1, stableNodeKey: "P#text0", contentFingerprint: "x", excludeFromReconciliation: true } })
      .card("u_same_source", para("Retries happen five times."), { ai: { ...sourceAI(a, OWNERS), stableNodeKey: "Service › Notes#text0" } });
    const r = await update(a, FIVE_TO_THREE);
    const impact = impactOf(a, r.changeSet!, scene);
    expect(impact.conflicts).toEqual([]);
    expect(impact.related).toEqual([]);
  }, 60_000);

  it("ambiguous placement is pointed out, not guessed: the changed words twice in the sentence", async () => {
    const a = await setup();
    const scene = sourceScene(a).card("u_twice", para("Retries happen five times, five times a day."));
    const r = await update(a, FIVE_TO_THREE);
    const impact = impactOf(a, r.changeSet!, scene);
    expect(impact.conflicts).toEqual([]);
    expect(impact.related.map((x) => x.target)).toEqual(["u_twice"]);
    expect(impact.related[0]!.reason).toMatch(/appear more than once/);
  }, 60_000);

  it("a card changed after the update was planned: its offer is dropped at accept, never a best guess", async () => {
    const a = await setup();
    const scene = sourceScene(a).card("u_repeat", para("The worker retries five times."));
    const r = await update(a, FIVE_TO_THREE);
    const set = withImpact(r.changeSet!, impactOf(a, r.changeSet!, scene));
    scene.docs.get("doc_u_repeat")!.snapshot = para("The worker retries five times, says ops.");
    const done = accept(set, scene, { u_repeat: "apply" });
    expect(done.textOf("u_repeat")).toBeNull();
    expect(done.result.dropped.map((d) => d.reason)).toEqual(["patch_rejected"]);
  }, 60_000);

  it("an update that only adds (no claim changed) finds nothing", async () => {
    const a = await setup();
    const scene = sourceScene(a).card("u_repeat", para("Retries happen five times."));
    const r = await update(a, `${DOC}\n## Risks\n\nNone known.\n`);
    expect(impactOf(a, r.changeSet!, scene).claims).toEqual([]);
  }, 60_000);

  it("wholeWordIndexes: whole words only", () => {
    expect(wholeWordIndexes("five fives five", "five")).toEqual([0, 11]);
    expect(wholeWordIndexes("a 5s b 5", "5")).toEqual([7]);
    expect(wholeWordIndexes("x", "")).toEqual([]);
  });

  it("the contract: a patch_block conflict must be an impact offer", () => {
    const base = { operationId: "op", title: "t", metadata: { createdBy: "ai" as const }, changes: [] };
    const patch = { kind: "patch_block" as const, target: "c1", expectedFingerprint: "f", edits: [{ blockIndex: 0, match: { exactText: "five" }, replacement: "three" }] };
    expect(() => parseChangeSet({ ...base, conflicts: [{ target: "c1", apply: patch }] } as ChangeSet)).toThrow(/impact offer/);
    const ok: ConflictItem = { target: "c1", apply: patch, impact: { from: "c0", claim: "x", detail: "y", proposed: "z" } };
    expect(parseChangeSet({ ...base, conflicts: [ok] } as ChangeSet).conflicts).toEqual([ok]);
  });
});

describe("Stage 3 — through the ingest service", () => {
  async function world() {
    const a = await setup();
    const repo: ContentSourceRepository = {
      get: async (id) => (id === a.source.id ? a.source : null),
      getVersion: async (id, version) => (id === a.source.id && version === a.previous.version ? a.previous : null),
      append: async () => undefined,
      listByCanvas: async () => [a.source],
      delete: async () => undefined,
    };
    const scene = sourceScene(a).card("u_repeat", para("The worker retries five times."));
    const ports: IngestPorts = {
      runtime,
      contentSources: repo,
      renderContext: () => context,
      sourceObjects: () => ({ existing: a.existing, connections: [] }),
      scene: () => ({ elements: scene.elements, getDocument: scene.getDocument }),
    };
    return { a, ports };
  }

  it("an update offers the repeats elsewhere; Suggest updates elsewhere off, Re-visualize, or no scene: the source's cards only", async () => {
    const { a, ports } = await world();
    const on = await ingestContent({ mode: "update", sourceId: a.source.id, text: FIVE_TO_THREE }, ports, { parseMarkdown: parse, updatePolicy: DEFAULT_UPDATE_POLICY });
    expect(on.changeSet!.conflicts?.map((c) => c.target)).toEqual(["u_repeat"]);

    const off = await ingestContent({ mode: "update", sourceId: a.source.id, text: FIVE_TO_THREE }, ports, { parseMarkdown: parse, updatePolicy: { ...DEFAULT_UPDATE_POLICY, suggestElsewhere: false } });
    expect(off.changeSet!.conflicts ?? []).toEqual([]);

    const scoped = await ingestContent({ mode: "update", sourceId: a.source.id, text: FIVE_TO_THREE, regenerate: ["Service › Limits"] }, ports, { parseMarkdown: parse, updatePolicy: DEFAULT_UPDATE_POLICY });
    expect((scoped.changeSet?.conflicts ?? []).filter((c) => c.impact)).toEqual([]);

    const { scene: _scene, ...noScene } = ports;
    const none = await ingestContent({ mode: "update", sourceId: a.source.id, text: FIVE_TO_THREE }, noScene, { parseMarkdown: parse, updatePolicy: DEFAULT_UPDATE_POLICY });
    expect(none.changeSet!.conflicts ?? []).toEqual([]);
  }, 60_000);
});
