/**
 * The two deliberate user actions around reconciliation (F39), each run only
 * when the user asks — neither ever runs implicitly:
 *
 * - "Don't update this from AI" / "Allow AI updates": the per-object opt-out
 *   (`excludeFromReconciliation`), read only by the F38 engine.
 * - "Use this option" (G3): chooses an option of a "Needs your call" box, through an update of its source.
 * - "Update source from this edit": writes the object's current content back
 *   into its content source as a new version, and makes that content the
 *   object's new baseline — the only path by which an artifact edit reaches
 *   the source (directionality, §13.15.20).
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { analyzeContent } from "@/ai/content/analyze";
import { loadLatest, recordAcceptedSource } from "@/ai/content/sources";
import { ensureStableKeys } from "@/ai/reconcile/keys";
import { fingerprintOf, labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import { canUpdateSourceFrom, editedMarkdown, spliceSource } from "@/ai/reconcile/sourceEdit";
import { isUserOwnedKey } from "@/ai/reconcile/tracking";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { reconciliationOf } from "@/domain/provenance";
import { isLocked, lockKeepsOptOut, withCardLock, withLock } from "@/domain/canvas/lock";
import type { AIMetadata, DocumentHome, ObjectMetadata } from "@/domain/types";
import type { CardReview } from "@/ai/fidelity/contracts";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { replaceElement } from "./richBlocks";
import { resolveChoice } from "@/ai/history/choices";
import { choiceOfKey } from "@/ai/history/choiceNodes";

const getDocument = (id: string) => getDocumentStore().get(id);

/** Merges `patch` into an object's `metadata.ai`: on its document for blocks/pages (metadata only), on the element for shapes (one undo step). */
function patchAI(api: ExcalidrawImperativeAPI, elementId: string, patch: Partial<AIMetadata>): void {
  const el = api.getSceneElements().find((e) => e.id === elementId);
  if (!el) return;
  const ref = getEmbedRef(el);
  const docId = ref?.kind === "rich-block" ? ref.documentId : ref?.kind === "page-preview" ? ref.pageId : null;
  if (docId) {
    const rec = getDocumentStore().get(docId);
    if (rec?.metadata?.ai) getDocumentStore().update(docId, { metadata: { ...rec.metadata, ai: { ...rec.metadata.ai, ...patch } } });
    return;
  }
  replaceElement(
    api,
    elementId,
    (e) => {
      const meta = (e.customData?.acuteMeta ?? {}) as ObjectMetadata;
      return newElementWith(e, { customData: { ...e.customData, acuteMeta: { ...meta, ai: { ...(meta.ai as AIMetadata), ...patch } } } });
    },
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/**
 * Whether an object is linked to a content source, whether it opted out, whether the user locked it (Stage 1e), and whether
 * its opt-out is its own for good (`userOwned`: a pinned note or an added passage, `tracking.ts`); null when it isn't linked.
 */
export function reconcileStatus(api: ExcalidrawImperativeAPI, elementId: string): { excluded: boolean; locked: boolean; userOwned: boolean } | null {
  const el = (api.getSceneElements() as unknown as readonly SceneElement[]).find((e) => e.id === elementId);
  const link = el && reconciliationOf(el, getDocument);
  return link ? { excluded: link.excludeFromReconciliation, locked: isLocked(el), userOwned: isUserOwnedKey(link.stableNodeKey) } : null;
}

/**
 * The Origin section's one reconciliation control for a linked object: Unlock a locked card; "Allow AI updates" on a card
 * opted out some other way (a "Don't update" from before locks); otherwise Lock. Never "Allow AI updates" on a pinned note
 * or an added passage card (`userOwned`): its key is in no plan, so the next update would propose removing it (N1).
 */
export function reconcileToggleOf(status: { excluded: boolean; locked: boolean; userOwned: boolean }): "unlock" | "allow" | "lock" {
  return status.locked ? "unlock" : status.excluded && !status.userOwned ? "allow" : "lock";
}

/**
 * Lock / Unlock a card (Stage 1e): the element's lock flag (its lock icon) and F39's opt-out together, as one undo step.
 * An update then leaves the card alone while "Preserve locked sections" is on; unlocked, the next update may change it again.
 */
export function setCardLocked(api: ExcalidrawImperativeAPI, elementId: string, locked: boolean): void {
  const el = api.getSceneElements().find((e) => e.id === elementId);
  if (!el) return;
  const ref = getEmbedRef(el);
  const docId = ref?.kind === "rich-block" ? ref.documentId : ref?.kind === "page-preview" ? ref.pageId : null;
  const rec = docId ? getDocumentStore().get(docId) : null;
  // An opt-out the card had before the lock (a passage or pinned card, "Don't update") is the card's own: locking
  // records it, and unlocking keeps it (lock.ts `withCardLock`; shared-contract review 2026-11-15, risk 2).
  const link = reconciliationOf(el, getDocument);
  const keepsOptOut = locked ? (isLocked(el) ? lockKeepsOptOut(el) : !!link?.excludeFromReconciliation) : lockKeepsOptOut(el);
  const excludeFromReconciliation = locked || keepsOptOut || undefined;
  if (docId && rec?.metadata?.ai) getDocumentStore().update(docId, { metadata: { ...rec.metadata, ai: { ...rec.metadata.ai, excludeFromReconciliation } } });
  replaceElement(
    api,
    elementId,
    (e) => {
      let customData = withCardLock(e.customData as Record<string, unknown> | undefined, locked, keepsOptOut);
      const meta = customData.acuteMeta as ObjectMetadata | undefined;
      if (!docId && meta?.ai) customData = { ...customData, acuteMeta: { ...meta, ai: { ...meta.ai, excludeFromReconciliation } } };
      return newElementWith(e, { customData });
    },
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/** Lock / Unlock a section frame (Stage 1e): every card in it — now or later — is left alone by updates while it is locked. */
export function setFrameLocked(api: ExcalidrawImperativeAPI, frameId: string, locked: boolean): void {
  replaceElement(api, frameId, (e) => newElementWith(e, { customData: withLock(e.customData as Record<string, unknown> | undefined, locked) }), CaptureUpdateAction.IMMEDIATELY);
}

/**
 * "Don't update" / "Allow AI updates" (F39). Refused (false, nothing written) when allowing updates on a pinned note or an
 * added passage card: its key is never in the source's plan, so the next update would propose removing it
 * (promotion-contract-proposal-2026-11-15 N1). Such a card keeps its opt-out; Lock and Unlock still work on it.
 */
export function setExcludedFromReconciliation(api: ExcalidrawImperativeAPI, elementId: string, excluded: boolean): boolean {
  if (!excluded) {
    const el = api.getSceneElements().find((e) => e.id === elementId);
    if (el && isUserOwnedKey(reconciliationOf(el, getDocument)?.stableNodeKey)) return false;
  }
  patchAI(api, elementId, { excludeFromReconciliation: excluded || undefined });
  return true;
}

/**
 * A card's review state, set by the user's own action in the review queue or the Source tab (knowledge-notes-plan §5.3:
 * Keep, Use source wording, Edit; OD5: only the user's action resolves one). `sourceUnits`, when given, replaces the
 * card's citations (a pinned passage it didn't cite yet).
 */
export function setCardReview(api: ExcalidrawImperativeAPI, elementId: string, review: CardReview, sourceUnits?: readonly string[]): void {
  patchAI(api, elementId, { review, ...(sourceUnits ? { sourceUnits: [...sourceUnits] } : {}) });
}

/**
 * "Pin quote" / "Use source wording" (§5.1, §5.3): the passage, word for word, appended to a block's content as a quote
 * (`quote`: lines already prefixed or not). The card's content changes, so it reads as the user's own edit to updates.
 * False when the object isn't a block (a shape has no body to pin on).
 */
export function pinQuoteOnBlock(api: ExcalidrawImperativeAPI, elementId: string, passage: string): boolean {
  const el = api.getSceneElements().find((e) => e.id === elementId);
  const ref = el ? getEmbedRef(el) : null;
  const docId = ref?.kind === "rich-block" ? ref.documentId : ref?.kind === "page-preview" ? ref.pageId : null;
  const rec = docId ? getDocumentStore().get(docId) : null;
  if (!docId || !rec) return false;
  const text = passage.trim();
  if (!text) return false;
  getDocumentStore().update(docId, { snapshot: [...rec.snapshot, { type: "quote", content: text }] });
  return true;
}

export type SourceEditOutcome = "updated" | "unavailable" | "unchanged";

/** Whether "Update source from this edit" applies to this object (local-tier node with a known span, edited since AI wrote it). */
export async function sourceEditTarget(api: ExcalidrawImperativeAPI, elementId: string) {
  const elements = api.getSceneElements() as unknown as readonly SceneElement[];
  const el = elements.find((e) => e.id === elementId);
  const link = el && reconciliationOf(el, getDocument);
  if (!el || !link) return null;
  const latest = await loadLatest(getPersistence().contentSources, link.contentSourceId);
  if (!latest) return null;
  const plan = validateVisualPlan(latest.version.plan).plan;
  const node = plan.nodes.find((n) => n.stableKey === link.stableNodeKey);
  if (!canUpdateSourceFrom(node, latest.source.tier)) return null;
  const content = objectContent(el, labelsByContainer(elements), getDocument);
  if (!content || content.kind === "shape") return null;
  const edited = fingerprintOf(content) !== link.contentFingerprint;
  return { el, link, latest, node, content, edited };
}

export async function updateSourceFromEdit(api: ExcalidrawImperativeAPI, home: DocumentHome, elementId: string): Promise<SourceEditOutcome> {
  const target = await sourceEditTarget(api, elementId);
  if (!target) return "unavailable";
  if (!target.edited) return "unchanged";
  const { latest, node, content, link } = target;
  const text = spliceSource(latest.version.text, node.sourceSpan, editedMarkdown(node, content.content));
  // A version whose plan matches its text: the local tier re-plans deterministically.
  const { local } = await analyzeContent(text);
  if (!local.plan) return "unavailable";
  const plan: VisualPlan = ensureStableKeys(validateVisualPlan(local.plan).plan);
  const version = latest.source.latestVersion + 1;
  await recordAcceptedSource(getPersistence().contentSources, home, {
    sourceId: link.contentSourceId,
    version,
    origin: latest.source.origin,
    tier: latest.source.tier,
    template: latest.source.template,
    text,
    plan,
  });
  // The edited content is now what the source says: it becomes the object's baseline.
  patchAI(api, elementId, { contentFingerprint: fingerprintOf(content), contentSourceVersion: version });
  return "updated";
}

/**
 * "Use this option" (G3, choices): the option card an object is, when it is one — its content source, its choice and
 * which option. Null for any other object.
 */
export function choiceOptionOf(api: ExcalidrawImperativeAPI, elementId: string): { sourceId: string; choiceId: string; option: number } | null {
  const el = (api.getSceneElements() as unknown as readonly SceneElement[]).find((e) => e.id === elementId);
  const link = el && reconciliationOf(el, getDocument);
  const choice = link ? choiceOfKey(link.stableNodeKey) : null;
  return link && choice && choice.option !== null ? { sourceId: link.contentSourceId, choiceId: choice.id, option: choice.option } : null;
}

/**
 * The source's latest text with that option chosen (`resolveChoice`), for "Update from new content" to apply as any
 * update — reviewed, and undone in one step. Null when the source or the choice is gone.
 */
export async function textWithOptionChosen(sourceId: string, choiceId: string, option: number): Promise<string | null> {
  const latest = await loadLatest(getPersistence().contentSources, sourceId);
  if (!latest) return null;
  const text = resolveChoice(latest.version.text, choiceId, option);
  return text === latest.version.text ? null : text;
}
