/**
 * Stage 5 wiring (intelligent-update-engine-plan §18), offline: the item index fed from a canvas (5b), the descent's
 * answer in the router's shape (5c), anchors as exact `patch_block`s (5d), and the placement they become. A fake dense
 * embedder stands in for the local model (no model, no network).
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet, resolveChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { fingerprintContent } from "@/ai/content/fingerprint";
import { labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent, TableContent } from "@/domain/types";
import { block, doc, el, lookup, para } from "@/search/testFixtures";
import { WorkspaceIndex } from "@/search/workspaceIndex";
import { itemText, planAnchor, rowCells } from "./anchors";
import { Descent, type CardOption, type Placement } from "./descent";
import { DescriptorCache, sectionsOf } from "./descriptors";
import { VectorTier } from "./embedding";
import type { EmbeddingProvider } from "./embeddingProvider";
import { choicesFor, defaultPicks, placeContent } from "./placement";
import { cardItemsOf, SemanticIndex } from "./semanticIndex";
import { semanticRoute } from "./semanticRoute";

const VOCAB = ["retr", "backoff", "timeout", "second", "service", "worker", "api", "team", "own", "call", "gateway", "queue", "deploy"];
/** Dense, normalised, by which vocabulary stems the text contains: meaningful enough to rank, and fully deterministic. */
const fakeModel: EmbeddingProvider = {
  id: "fake-dense-v1",
  dims: VOCAB.length + 1,
  kind: "local",
  thresholds: { related: 0.3 },
  ready: async () => ({ state: "ready" }),
  embed: async (texts) =>
    texts.map((t) => {
      const low = t.toLowerCase();
      const v = new Float32Array(VOCAB.length + 1);
      VOCAB.forEach((w, i) => (v[i] = low.split(w).length - 1));
      v[VOCAB.length] = 0.2;
      const n = Math.hypot(...v) || 1;
      return { embedder: "fake-dense-v1", dense: v.map((x) => x / n) };
    }),
};

const LIST: RichContent = [
  { id: "l1", type: "bulletListItem", content: "Retries happen five times." },
  { id: "l2", type: "bulletListItem", content: "Retry backoff starts at one second." },
];
const cell = (t: string) => ({ type: "tableCell" as const, content: [{ type: "text" as const, text: t, styles: {} }] });
const TABLE: RichContent = [
  { id: "t1", type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: [cell("Service"), cell("Timeout")] }, { cells: [cell("API"), cell("30 seconds")] }, { cells: [cell("Worker"), cell("60 seconds")] }] } },
];
const docs: DocumentRecord[] = [doc("d_list", LIST), doc("d_table", TABLE), doc("d_team", para("The payments team owns the gateway. On-call rotates weekly."))];
const frame = (id: string, name: string, extra: Partial<SceneElement> = {}) => el({ id, type: "frame", name, x: 0, y: 0, width: 600, height: 400, ...extra } as Partial<SceneElement> & Pick<SceneElement, "id" | "type">);
const baseScene: SceneElement[] = [
  frame("f_limits", "Limits"),
  frame("f_team", "Team"),
  block("retries", "d_list", { frameId: "f_limits", x: 20, y: 40, width: 300, height: 80 }),
  block("services", "d_table", { frameId: "f_limits", x: 20, y: 140, width: 300, height: 120 }, "table"),
  block("owners", "d_team", { frameId: "f_team", x: 400, y: 40, width: 300, height: 60 }),
];
const getDocument = lookup(docs);
const liveOf = (scene: readonly SceneElement[], id: string) => objectContent(scene.find((e) => e.id === id)!, labelsByContainer(scene), getDocument);
const itemsOf = (id: string, section = "f_limits") => cardItemsOf(id, section, liveOf(baseScene, id)!)!;

describe("cardItemsOf (5b)", () => {
  it("a list card's items are its list items; a table card's, its data rows; a prose card's, its sentences", () => {
    expect(itemsOf("retries")).toMatchObject({ kind: "list", items: [{ block: 0, text: "Retries happen five times." }, { block: 1, text: "Retry backoff starts at one second." }] });
    expect(itemsOf("services")).toMatchObject({ kind: "table", header: ["Service", "Timeout"], items: [{ block: 0, part: 1, text: "API | 30 seconds", cells: ["API", "30 seconds"] }, { block: 0, part: 2 }] });
    expect(itemsOf("owners", "f_team").items.map((i) => [i.block, i.part, i.text])).toEqual([
      [0, 0, "The payments team owns the gateway."],
      [0, 1, "On-call rotates weekly."],
    ]);
  });

  it("the index follows the canvas: unchanged cards aren't re-read, changed and removed ones are", () => {
    const si = new SemanticIndex(fakeModel);
    expect(si.sync(baseScene, getDocument)).toEqual({ changed: 3, removed: 0 });
    expect(si.sync(baseScene, getDocument)).toEqual({ changed: 0, removed: 0 });
    const edited = lookup([doc("d_list", [...LIST, { id: "l3", type: "bulletListItem", content: "Jitter is added." }]), ...docs.slice(1)]);
    expect(si.sync(baseScene, edited)).toEqual({ changed: 1, removed: 0 });
    expect(si.index.itemsOf("retries")).toHaveLength(3);
    expect(si.sync(baseScene.filter((e) => e.id !== "owners"), edited)).toEqual({ changed: 0, removed: 1 });
    expect(si.index.card("owners")).toBeUndefined();
    expect(si.sections(baseScene).map((s) => s.name)).toEqual(["Limits", "Team"]);
  });
});

describe("planAnchor (5d)", () => {
  it("after_item / append: a list item of the same type, after the matched item or the last one", () => {
    const live = liveOf(baseScene, "retries");
    const after = planAnchor({ action: "after_item", item: 0, column: null }, itemsOf("retries"), live, "- Retries are logged.");
    expect(after).toMatchObject({ action: "after_item", label: "Add it to the list, after “Retries happen five times.”", edits: [], inserts: [{ kind: "block", after: 0, afterBlockId: "l1", blockType: "bulletListItem", text: "Retries are logged." }] });
    expect(planAnchor({ action: "append", item: null, column: null }, itemsOf("retries"), live, "Jitter is added.")).toMatchObject({ action: "append", inserts: [{ after: 1, afterBlockId: "l2" }] });
  });

  it("table_row: cells from 'a | b' or 'Header: value', else the text in the first column", () => {
    const live = liveOf(baseScene, "services");
    expect(planAnchor({ action: "table_row", item: null, column: null }, itemsOf("services"), live, "Queue | 45 seconds")).toMatchObject({ inserts: [{ kind: "row", blockIndex: 0, blockId: "t1", after: 2, cells: ["Queue", "45 seconds"] }] });
    expect(rowCells("Queue, timeout: 45 seconds", ["Service", "Timeout"])).toEqual(["Queue", "45 seconds"]);
    expect(rowCells("Queue reader", ["Service", "Timeout"])).toBeNull(); // not row-shaped: a new card beside the table
    expect(rowCells("Restart the cache workers", ["Service", "Timeout"])).toBeNull();
    expect(rowCells("a | b | c", ["Service", "Timeout"])).toBeNull();
  });

  it("cell: only the changed quantity, in that row and column", () => {
    const plan = planAnchor({ action: "cell", item: 0, column: "Timeout" }, itemsOf("services"), liveOf(baseScene, "services"), "The API timeout is now 45 seconds.");
    expect(plan).toMatchObject({ action: "cell", label: "Change “Timeout” in row 2: “30 seconds” → “45 seconds”", edits: [{ blockIndex: 0, cell: { row: 1, col: 1 }, match: { range: { start: 0, end: 10 }, text: "30 seconds" }, replacement: "45 seconds", intent: "SUPERSEDES" }] });
    // No new value of the same kind: no exact edit.
    expect(planAnchor({ action: "cell", item: 0, column: "Timeout" }, itemsOf("services"), liveOf(baseScene, "services"), "The API timeout changed.")).toBeNull();
  });

  it("a prose card or a shape takes no anchor", () => {
    expect(planAnchor({ action: "append", item: null, column: null }, itemsOf("owners", "f_team"), liveOf(baseScene, "owners"), "x")).toBeNull();
    expect(itemText("  1. Ten   retries ")).toBe("Ten retries");
  });
});

function tierAndDescribe(scene: readonly SceneElement[]) {
  const index = new WorkspaceIndex("ws");
  index.syncScene("cv", scene, getDocument);
  const tier = new VectorTier(index);
  const descriptors = new DescriptorCache();
  const { frames, frameOf } = sectionsOf(scene);
  const describe = (id: string) => {
    const o = tier.get(id);
    const f = frameOf.get(id);
    return o ? descriptors.describe(o, f ? frames.get(f) : undefined, (t) => tier.frequency(t), tier.size) : null;
  };
  return { describe, sections: [...frames.values()] };
}

function placementOf(options: CardOption[], extra: Partial<Placement> = {}): Placement {
  const top = options[0]!;
  return { action: top.action, card: top.card, section: top.section, near: null, item: top.item, column: top.column, relation: top.relation, routing: top.routing, update: top.update, ranked: options.map((o) => o.card), scores: options.map((o) => ({ card: o.card, routing: o.routing })), options, steps: [], ...extra };
}

async function routeWith(placement: Placement, scene: readonly SceneElement[] = baseScene, text = "Jitter is added to retries.") {
  const si = new SemanticIndex(fakeModel);
  si.sync(scene, getDocument);
  return semanticRoute({ text, placement, index: si.index, embedder: fakeModel.id, scene, getDocument, ...tierAndDescribe(scene) });
}

describe("semanticRoute (5c) and placement", () => {
  it("an anchor on the winner is a confident route, preselected, and proposes exactly its patch — applied at accept, one change", async () => {
    const r = await routeWith(
      placementOf([
        { card: "retries", section: "f_limits", action: "append", item: null, column: null, relation: "NEW", update: 0.9, routing: 0.71 },
        { card: "services", section: "f_limits", action: "table_row", item: null, column: null, relation: "NEW", update: 0.9, routing: 0.4 },
      ]),
    );
    expect(r).toMatchObject({ decision: "route", semantic: { embedder: "fake-dense-v1", nowhere: false } });
    expect(r.candidates.map((c) => [c.id, c.action])).toEqual([
      ["retries", "anchor"],
      // A sentence is not a row: the table card is offered as "a new card beside it", never a row holding a sentence.
      ["services", "insert_near"],
    ]);
    expect(r.candidates[0]!.anchor!.label).toBe("Add it at the end of the list");
    const picks = defaultPicks(r);
    expect([...picks]).toEqual(["retries"]);
    const { set, notes } = placeContent({ text: "Jitter is added to retries.", choices: choicesFor(picks, new Set(), r.candidates), scene: baseScene, getDocument, at: { x: 0, y: 0 }, operationId: "op" });
    expect(notes).toEqual([]);
    expect(set!.changes).toHaveLength(1);
    expect(set!.changes[0]).toMatchObject({ kind: "patch_block", target: "retries", edits: [], inserts: [{ kind: "block", after: 1, text: "Jitter is added to retries." }] });
    const resolved = resolveChangeSet(parseChangeSet(set), () => true, () => ({ content: LIST, fingerprint: fingerprintContent(LIST) }));
    expect((resolved.changes[0] as Extract<ProposedChange, { kind: "update_block" }>).content.map((b) => b.id ?? "new")).toEqual(["l1", "l2", "new"]);
  });

  it("a card changed after it was found: the anchor isn't forced, the content goes beside it, and it says so", async () => {
    const r = await routeWith(placementOf([{ card: "retries", section: "f_limits", action: "append", item: null, column: null, relation: "NEW", update: 0.9, routing: 0.71 }]));
    const changed = lookup([doc("d_list", [...LIST, { id: "l9", type: "bulletListItem", content: "Edited meanwhile." }]), ...docs.slice(1)]);
    const { set, notes } = placeContent({ text: "Jitter.", choices: choicesFor(new Set(["retries"]), new Set(), r.candidates), scene: baseScene, getDocument: changed, at: { x: 0, y: 0 }, operationId: "op" });
    expect(notes[0]).toMatch(/changed since it was found/);
    expect(set!.changes.map((c) => c.kind)).toEqual(["create_block", "update_frame"]);
  });

  it("replace_item is the router's claim-level update (escalated when it contradicts); duplicate is 'none'; a table's changed value is a cell anchor", async () => {
    const r = await routeWith(
      placementOf([
        { card: "retries", section: "f_limits", action: "replace_item", item: 0, column: null, relation: "SUPERSEDES", update: 0.8, routing: 0.7 },
        { card: "services", section: "f_limits", action: "cell", item: 0, column: "Timeout", relation: "SUPERSEDES", update: 0.8, routing: 0.5 },
        { card: "owners", section: "f_team", action: "duplicate", item: 0, column: null, relation: "DUPLICATE", update: 1, routing: 0.3 },
      ]),
      baseScene,
      "Retries happen three times.",
    );
    expect(r.candidates[0]).toMatchObject({ action: "update", claim: { sentence: "Retries happen five times.", newSentence: "Retries happen three times.", intent: "SUPERSEDES", escalate: false } });
    // "three times" has no quantity of the table's kind (seconds): no exact cell edit, so a new card beside it.
    expect(r.candidates[1]).toMatchObject({ id: "services", action: "insert_near" });
    expect(r.candidates[2]).toMatchObject({ id: "owners", action: "none" });
    const { set } = placeContent({ text: "Retries happen three times.", choices: choicesFor(new Set(["retries"]), new Set(), r.candidates), scene: baseScene, getDocument, at: { x: 0, y: 0 }, operationId: "op" });
    expect(set!.changes[0]).toMatchObject({ kind: "patch_block", target: "retries", edits: [{ replacement: "three", intent: "SUPERSEDES" }] });
  });

  it("belongs nowhere: NEW with nothing picked, the closest cards still listed", async () => {
    const r = await routeWith(
      placementOf([{ card: "retries", section: "f_limits", action: "append", item: null, column: null, relation: "NEW", update: 0.9, routing: 0.2 }], { action: "new_section", card: null, section: null, ranked: ["retries", "owners"], steps: ["belongs nowhere: sections within 0.01, best card 0.10, best item 0.10"] }),
      baseScene,
      "Deploys need two approvals.",
    );
    expect(r).toMatchObject({ decision: "NEW", semantic: { nowhere: true }, reason: "belongs nowhere on this canvas: a new card is suggested" });
    expect(r.candidates.map((c) => c.id)).toEqual(["retries", "owners"]);
    expect([...defaultPicks(r)]).toEqual([]);
  });

  it("a locked card (or a card in a locked section) is never patched: it is offered as a new card beside it", async () => {
    const locked = baseScene.map((e) => (e.id === "f_limits" ? { ...e, customData: { acuteLocked: true } } : e));
    const r = await routeWith(placementOf([{ card: "retries", section: "f_limits", action: "append", item: null, column: null, relation: "NEW", update: 0.9, routing: 0.7 }]), locked);
    expect(r.candidates[0]).toMatchObject({ id: "retries", action: "insert_near" });
    expect(r.candidates[0]!.evidence).toContain("locked: a new card goes beside it");
  });

  it("end to end with the descent over the fake model: the note about retry backoff is routed to the retries list", async () => {
    const si = new SemanticIndex(fakeModel);
    si.sync(baseScene, getDocument);
    const descent = new Descent(si.index, si.sections(baseScene));
    await descent.prepare();
    const text = "Retry backoff doubles after each retry.";
    const placement = await descent.place(text);
    const r = semanticRoute({ text, placement, index: si.index, embedder: fakeModel.id, scene: baseScene, getDocument, ...tierAndDescribe(baseScene) });
    expect(r.semantic?.embedder).toBe("fake-dense-v1");
    expect(r.candidates[0]!.id).toBe("retries");
    // Which action the descent picks there is its own (dev-measured) judgment, §13.13 — this coarse fake model reads the note
    // as close to an item; the wiring carries whatever it chose into the dialog's shape.
    expect(["anchor", "update", "none"]).toContain(r.candidates[0]!.action);
    expect((TABLE[0]!.content as TableContent).rows).toHaveLength(3); // nothing was written: placement only proposes
  });

  it("#16 on the semantic path: only objects on the canvas are destinations — a deleted card (its document kept for undo) never is", async () => {
    const OLD: RichContent = [{ id: "o1", type: "bulletListItem", content: "Retry backoff starts at two seconds, retries happen eight times." }];
    const withOld = lookup([...docs, doc("d_old", OLD)]);
    const deleted = { ...block("old_retries", "d_old", { frameId: "f_limits", x: 20, y: 300, width: 300, height: 60 }), isDeleted: true };
    const scene = [...baseScene, deleted];
    const si = new SemanticIndex(fakeModel);
    si.sync([...baseScene, { ...deleted, isDeleted: false }], withOld); // indexed while it was on the canvas
    expect(si.index.card("old_retries")).toBeDefined();
    si.sync(scene, withOld); // then deleted: dropped from the index
    expect(si.index.card("old_retries")).toBeUndefined();
    const descent = new Descent(si.index, si.sections(scene));
    await descent.prepare();
    const text = "Retry backoff starts at two seconds.";
    const placement = await descent.place(text);
    const r = semanticRoute({ text, placement, index: si.index, embedder: fakeModel.id, scene, getDocument: withOld, ...tierAndDescribe(scene) });
    expect(r.candidates.map((c) => c.id)).not.toContain("old_retries");
    // Even a placement naming it (a stale answer) is filtered: candidates are live scene elements only.
    const stale = semanticRoute({ text, placement: placementOf([{ card: "old_retries", section: "f_limits", action: "append", item: null, column: null, relation: "NEW", update: 0.9, routing: 0.9 }]), index: si.index, embedder: fakeModel.id, scene, getDocument: withOld, ...tierAndDescribe(scene) });
    expect(stale.candidates.map((c) => c.id)).toEqual([]);
  });

  it("context (the selection or the frame in view, placementContext.ts): a prior for that card or section, and the card says so", async () => {
    const si = new SemanticIndex(fakeModel);
    si.sync(baseScene, getDocument);
    const descent = new Descent(si.index, si.sections(baseScene));
    await descent.prepare();
    const text = "The gateway call is retried on timeout.";
    const scoreOf = (p: Placement, card: string) => p.scores.find((s) => s.card === card)!.routing;
    const plain = await descent.place(text);
    const selected = await descent.place(text, {}, { card: "owners", section: "f_team" });
    expect(scoreOf(selected, "owners")).toBeCloseTo(scoreOf(plain, "owners") + 0.1, 5);
    expect(scoreOf(selected, "retries")).toBeCloseTo(scoreOf(plain, "retries"), 5);
    const inView = await descent.place(text, {}, { section: "f_limits" });
    expect(scoreOf(inView, "retries")).toBeCloseTo(scoreOf(plain, "retries") + 0.1, 5);
    expect(scoreOf(inView, "services")).toBeCloseTo(scoreOf(plain, "services") + 0.1, 5);

    const evidenceOf = (r: ReturnType<typeof semanticRoute>, id: string) => r.candidates.find((c) => c.id === id)?.evidence ?? [];
    const route = (p: Placement, context: Parameters<typeof semanticRoute>[0]["context"]) => semanticRoute({ text, placement: p, index: si.index, embedder: fakeModel.id, scene: baseScene, getDocument, context, ...tierAndDescribe(baseScene) });
    expect(evidenceOf(route(selected, { card: "owners", section: "f_team", source: "selection" }), "owners")).toContain("the card you selected");
    expect(evidenceOf(route(inView, { section: "f_limits", source: "frame_in_view" }), "retries")).toContain("in the section you're viewing");
    expect(evidenceOf(route(inView, { section: "f_limits", source: "selection" }), "retries")).toContain("in the section you selected");
    expect(evidenceOf(route(plain, null), "retries").some((e) => /you selected|you're viewing/.test(e))).toBe(false);
  });
});
