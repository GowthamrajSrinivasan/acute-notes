"use client";

/**
 * The review UI's actions on the live canvas (knowledge-notes-plan §5.1, §5.3; WP2.2, WP2.6, WP2.7), each started by the
 * user and none calling a model:
 *
 * - **Open the source** (a chip, a queue step): select the card and open the Source tab on its passages.
 * - **Passage → cards** (two-way highlighting): outline the cards citing a passage, and move the camera to them (a jump
 *   with reduced motion).
 * - **Add to canvas / Include:** a card from the passage by the local tier (`cardFromPassage`), linked to the source
 *   version and citing it, opted out of updates, written as one undoable step next to the card citing the nearest
 *   passage before it (in its frame). Include also records the passage as included.
 * - **Pin quote / Use source wording:** the passage, word for word, on the card (`pinPassageOnBlock`); its citations gain
 *   the passage. From the queue it resolves the card's review as "edited".
 * - **Keep / Edit / Dismiss:** the card's review resolved as "kept" (or "edited" once the user saves an edit), the
 *   passage's omission confirmed. Stored on the card, or per source version for passages no card carries.
 *
 * Selection actions stay scoped (§0.3 rule 4): each changes only the card or passage it was started on, plus the one
 * new card Add / Include writes.
 */
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { TransactionHistory } from "@/ai/changes/accept";
import { parseChangeSet, type ChangeSet } from "@/ai/changes/changeSet";
import { resolvePassage } from "@/ai/content/sourceReview";
import type { ReviewResolution, SourceUnit, UnitId } from "@/ai/fidelity/contracts";
import { renderVisualPlan } from "@/ai/renderer/render";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { commitSetOnCanvas } from "@/components/ai/commitOnCanvas";
import { prefersReducedMotion } from "@/components/canvas/motion";
import { activateEmbeddable } from "@/components/canvas/richBlocks";
import { pinQuoteOnBlock, setCardReview } from "@/components/canvas/reconcileActions";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { knowledgeObjectsOf, type KnowledgeObject } from "./knowledgeObjects";
import { knowledgeUI } from "./knowledgeStore";
import { cardFromPassage, pinQuote, quoteOf } from "./passageActions";
import { resolveReview } from "./queue";

export interface KnowledgeEnv {
  api: ExcalidrawImperativeAPI;
  home: DocumentHome;
  history: TransactionHistory;
}

const getDocument = (id: string) => getDocumentStore().get(id);
const scene = (api: ExcalidrawImperativeAPI) => api.getSceneElements() as unknown as readonly SceneElement[];

/** The distil objects on the canvas now. */
export function objectsNow(api: ExcalidrawImperativeAPI): KnowledgeObject[] {
  return knowledgeObjectsOf(scene(api), getDocument);
}

/** Moves the camera to `ids` (a jump with reduced motion, §5.1), optionally selecting them. */
export function showObjects(api: ExcalidrawImperativeAPI, ids: readonly string[], select = false): void {
  const els = api.getSceneElements().filter((e) => ids.includes(e.id)) as ExcalidrawElement[];
  if (!els.length) return;
  if (select) api.updateScene({ appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])), selectedGroupIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
  api.scrollToContent(els, { animate: !prefersReducedMotion(), duration: 250 });
}

/**
 * A chip or a queue step: the card selected, the Source tab open on its passages. A queue step also brings the card into
 * view; a chip's card is already in view (its chip was just clicked), so the camera stays and the panel opens at once.
 */
export function openSourceOn(env: KnowledgeEnv, objectId: string, units: readonly UnitId[], options: { scroll?: boolean } = {}): void {
  if (options.scroll === false) env.api.updateScene({ appState: { selectedElementIds: { [objectId]: true }, selectedGroupIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
  else showObjects(env.api, [objectId], true);
  knowledgeUI.openSource(env.home.canvasId, { objectId, units: [...units] });
}

/** Passage → cards: the cards citing any of `units` (of that source) outlined, the camera on them. Returns their ids. */
export function outlineCiting(env: KnowledgeEnv, sourceId: string, units: readonly UnitId[]): string[] {
  const ids = objectsNow(env.api)
    .filter((o) => o.sourceId === sourceId && o.cites.some((u) => units.includes(u)))
    .map((o) => o.objectId);
  knowledgeUI.outline(env.home.canvasId, ids);
  if (ids.length) showObjects(env.api, ids);
  return ids;
}

/**
 * Add to canvas / Include: one card from the passage, placed below the card citing the nearest passage before it (and in
 * its frame), else beside the selection or in view. One undoable step; no AI call. Returns the new object's id.
 */
export async function addPassageCard(env: KnowledgeEnv, source: { sourceId: string; version: number; units: readonly SourceUnit[] }, unit: SourceUnit, title = "Add to canvas"): Promise<string | null> {
  const draft = cardFromPassage(unit);
  const stableKey = `passage § ${unit.id}`;
  const plan = validateVisualPlan({
    version: 1,
    template: "sectioned",
    nodes: [{ id: "p1", type: "text", title: draft.title, content: { markdown: draft.byReference ? `\`\`\`\n${draft.body}\n\`\`\`` : draft.body || draft.title }, stableKey }],
    relationships: [],
  }).plan;
  // Next to the card citing the nearest earlier passage of the same source (else the nearest later one).
  const order = new Map(source.units.map((u, i) => [u.id, i] as const));
  const at = order.get(unit.id) ?? 0;
  const objects = objectsNow(env.api).filter((o) => o.sourceId === source.sourceId && o.cites.length);
  const distance = (o: KnowledgeObject) => Math.min(...o.cites.map((c) => Math.abs((order.get(c) ?? Infinity) - at) + ((order.get(c) ?? 0) > at ? 0.5 : 0)));
  const near = [...objects].sort((a, b) => distance(a) - distance(b))[0];
  const context = gatherRenderContext(env.api);
  const operationId = newId("op");
  const rendered = await renderVisualPlan(plan, {
    operationId,
    title,
    metadata: { createdBy: "ai", task: "include_passage", operationId, noteModel: "distil" },
    context: near ? { ...context, anchor: near.box, anchorSide: "below", anchorIds: [near.objectId] } : context,
  });
  const created = rendered.changes.filter((c) => c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page");
  const set: ChangeSet = {
    ...rendered,
    changes: [...rendered.changes, ...(near?.frameId && created.length ? [{ kind: "update_frame" as const, target: near.frameId, add: created.map((c) => c.key) }] : [])],
    passage: { sourceId: source.sourceId, version: source.version },
    knowledge: { cards: { [stableKey]: { sourceUnits: [unit.id] } } },
  };
  const result = commitSetOnCanvas(env.api, env.home, env.history, parseChangeSet(set));
  const id = created[0] && result ? (result.created.get(created[0].key) ?? null) : null;
  if (id) showObjects(env.api, [id]);
  knowledgeUI.changed(env.home.canvasId);
  return id;
}

/** Include from the Source tab or the queue: the card, and the passage recorded as included for its version. */
export async function includePassage(env: KnowledgeEnv, source: { sourceId: string; version: number; units: readonly SourceUnit[] }, unit: SourceUnit): Promise<string | null> {
  const id = await addPassageCard(env, source, unit, "Include");
  if (id) await recordPassage(env, source.sourceId, source.version, unit.id, "included");
  return id;
}

/** Dismiss (or Include) of a passage no card carries, stored per source version. */
export async function recordPassage(env: KnowledgeEnv, sourceId: string, version: number, unit: UnitId, resolution: ReviewResolution): Promise<void> {
  await resolvePassage(getPersistence().meta, sourceId, version, unit, resolution);
  knowledgeUI.changed(env.home.canvasId);
}

/**
 * Pin quote / Use source wording: the passage on the card, word for word; its citations gain the passage. With
 * `resolve`, the card's review is resolved as "edited" (the queue's Use source wording). False when the card is a
 * shape (nothing to pin on).
 */
export function pinPassage(env: KnowledgeEnv, card: KnowledgeObject, unit: SourceUnit, resolve = false): boolean {
  const { cites } = pinQuote({ body: "", cites: card.cites }, unit);
  if (!pinQuoteOnBlock(env.api, card.objectId, quoteOf(unit).replace(/^> ?/gm, ""))) return false;
  setCardReview(env.api, card.objectId, resolve ? resolveReview(card.review, "edited") : (card.review ?? { reasons: [] }), cites);
  knowledgeUI.changed(env.home.canvasId);
  return true;
}

/** Keep: the card stays as it is; its flag is resolved. */
export function keepCard(env: KnowledgeEnv, card: KnowledgeObject): void {
  setCardReview(env.api, card.objectId, resolveReview(card.review, "kept"));
  knowledgeUI.changed(env.home.canvasId);
}

/** Edit: the card opens for editing; saving a change resolves its review as "edited" (`resolveEdited`). */
export function editCard(env: KnowledgeEnv, card: KnowledgeObject): void {
  knowledgeUI.startEditing(env.home.canvasId, card.objectId);
  showObjects(env.api, [card.objectId], true);
  if (card.shape === "block") activateEmbeddable(env.api, card.objectId);
}

/** A card the user chose Edit on and has since changed: its review resolved as "edited". */
export function resolveEdited(env: KnowledgeEnv, card: KnowledgeObject): void {
  setCardReview(env.api, card.objectId, resolveReview(card.review, "edited"));
  knowledgeUI.stopEditing(env.home.canvasId, card.objectId);
  knowledgeUI.changed(env.home.canvasId);
}
