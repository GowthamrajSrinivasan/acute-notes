"use client";

/**
 * The consistency check on the live canvas (intelligent-update-engine-plan Stage 4d–4e, §12.1): a post-commit step
 * (`onCommitted`), run only once the index is fresh (`afterCommit` holds it otherwise), and re-run from a job that waited
 * or failed (`resumeCheckJobs`).
 *
 * For one revision: its claims (what it newly says, kept on its job) → the relevant cards, retrieved from the index (the
 * router's tier: lexical and vector, same canvas, at most `MAX_CANDIDATES`) — never a full rescan → the tier-1 rules →
 * the conflict store. Pairs the user already decided in the update review ("Leave as is") are recorded as dismissed.
 * Then the open records about the touched cards are re-checked (a statement changed → closed).
 *
 * Manual edits, undo and redo don't raise new conflicts in v1 (§12.9 decision 2); they re-check the open ones
 * (`recheckOpen`). Nothing here edits a card: a fix is only ever proposed for the normal review (`proposeFix`).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getCommitJournal, type CommittedRevision } from "@/ai/changes/commit";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { cardReader, detect, fixFor, MAX_CANDIDATES, type Claim } from "@/ai/consistency/check";
import { judgePair } from "@/ai/consistency/rules";
import { ConsistencyStore, type ConsistencyConflict } from "@/ai/consistency/store";
import { labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import { CARD_KINDS } from "@/ai/router/router";
import { routerFor } from "@/components/ai/placeContent";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";

let store: ConsistencyStore | null = null;
/** The app's conflict store, on the device's meta store. */
export function getConsistencyStore(): ConsistencyStore {
  return (store ??= new ConsistencyStore(getPersistence().meta));
}

const scene = (api: ExcalidrawImperativeAPI) => api.getSceneElements() as unknown as readonly SceneElement[];
const getDocument = (id: string) => getDocumentStore().get(id);
const stillDisagree = (a: string, b: string) => judgePair(a, b).verdict !== "compatible";

/** The check for one committed revision (see module doc). Throws on failure: `afterCommit` records it on the job. */
export async function checkRevision(api: ExcalidrawImperativeAPI, home: DocumentHome, revision: CommittedRevision): Promise<void> {
  const s = getConsistencyStore();
  await s.load(home.canvasId);
  const elements = scene(api);
  const read = cardReader(elements, getDocument);
  const claims: Claim[] = (getCommitJournal().get(revision.id)?.check.claims ?? revision.check.claims ?? []).filter((c) => read(c.elementId));
  if (claims.length) {
    const { tier } = await routerFor(home.workspaceId, home.canvasId, elements, getDocument);
    tier.refresh();
    const onCanvas = new Set(elements.flatMap((e) => (e.isDeleted ? [] : [e.id])));
    const candidatesOf = (claim: Claim) => {
      const ids = new Set<string>();
      for (const h of tier.query({ text: claim.sentence, mode: "any", canvasId: home.canvasId, kinds: CARD_KINDS, limit: MAX_CANDIDATES / 2 }).hits) ids.add(h.id);
      for (const h of tier.nearest(tier.embed(claim.sentence), { canvasId: home.canvasId, kinds: CARD_KINDS, limit: MAX_CANDIDATES / 2 })) ids.add(h.id);
      return [...ids].filter((id) => onCanvas.has(id));
    };
    const found = detect(claims, read, candidatesOf);
    const decided = getCommitJournal().get(revision.id)?.check.leftAsIs ?? revision.check.leftAsIs ?? [];
    const isDecided = (a: string, b: string) => decided.some((d) => (d.target === a && d.from === b) || (d.target === b && d.from === a));
    for (const d of found.filter((x) => isDecided(x.a.elementId, x.b.elementId))) s.dismissPair(home.canvasId, revision.id, d, "Left as is in the update review");
    s.record(home.canvasId, revision.id, found.filter((x) => !isDecided(x.a.elementId, x.b.elementId)));
  }
  s.reevaluate(home.canvasId, lookOf(read), new Set(revision.touched));
}

function lookOf(read: ReturnType<typeof cardReader>) {
  return {
    sentencesOf: (id: string) => read(id)?.sentences ?? null,
    fingerprintOf: (id: string) => read(id)?.fingerprint ?? null,
    stillDisagree,
  };
}

/** After a manual edit, undo or redo: re-checks the open records only (no new ones in v1). */
export async function recheckOpen(api: ExcalidrawImperativeAPI, home: DocumentHome): Promise<ConsistencyConflict[]> {
  const s = getConsistencyStore();
  await s.load(home.canvasId);
  return s.reevaluate(home.canvasId, lookOf(cardReader(scene(api), getDocument)));
}

/** The user's decision on a record (never a write to any card). */
export function decideConflict(api: ExcalidrawImperativeAPI, home: DocumentHome, id: string, decision: "confirm" | "dismiss" | "defer"): void {
  const s = getConsistencyStore();
  const c = s.get(home.canvasId, id);
  if (!c) return;
  const read = cardReader(scene(api), getDocument);
  s.decide(home.canvasId, id, decision, decision === "defer" ? { until: "next_change", fingerprints: { a: read(c.a.elementId)?.fingerprint ?? "", b: read(c.b.elementId)?.fingerprint ?? "" } } : {});
}

/**
 * "Propose a fix" on a confirmed value disagreement: a claim-level patch that makes `side`'s card say the other's value,
 * proposed for the normal review (`PendingChanges`) — written only if the user accepts it there. Returns a message for
 * the user when it can't be proposed.
 */
export function proposeFix(api: ExcalidrawImperativeAPI, home: DocumentHome, conflict: ConsistencyConflict, side: "a" | "b"): string | null {
  const target = conflict[side];
  const source = conflict[side === "a" ? "b" : "a"];
  const elements = scene(api);
  const el = elements.find((e) => e.id === target.elementId && !e.isDeleted);
  const patch = fixFor(target, source, el ? objectContent(el, labelsByContainer(elements), getDocument) : null);
  if (!patch) return "This fix can't be placed exactly on the card as it is now: edit it by hand.";
  const operationId = newId("op");
  try {
    getPendingChanges().propose(home.canvasId, {
      operationId,
      title: `Fix: “${target.cardName}”`,
      metadata: { createdBy: "ai", task: "consistency_fix", operationId },
      changes: [patch],
      reason: `Make it agree with “${source.cardName}” (a confirmed conflict)`,
    });
  } catch (err) {
    return err instanceof Error ? err.message : "Couldn't propose the fix.";
  }
  return null;
}
