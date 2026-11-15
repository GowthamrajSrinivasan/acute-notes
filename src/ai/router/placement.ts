/**
 * Placing content where the user chose (intelligent-update-engine-plan Stage 2d): the destinations picked in "Where
 * should this go?" (or an MCP agent's, after `suggest_placement`) become one ordinary change set, reviewed before
 * anything is written.
 *
 * - `update`: the card holds the claim — a claim-level `patch_block` (Stage 1b) that edits just that sentence: the
 *   changed words when the content is that one sentence, else the sentence replaced by the content. Checked against
 *   the card's live content at accept like every patch. The card keeps its own provenance and source link, so the edit
 *   counts as the user's to a later source update (as an MCP edit does).
 * - `insert_near`: a new card in the card's section, below the section's lowest card (the frame grows to fit), or just
 *   below the card when it has no section.
 * - `new`: a new card at the place given.
 * - `none`: the card already says it — nothing.
 * An `update` whose edit can't be placed exactly falls back to `insert_near`, and says so.
 */
import type { Box, ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { applyClaimEdits, blockPlainText, type ClaimEdit } from "@/ai/changes/claimPatch";
import { wordHunk } from "@/ai/reconcile/claimPlanner";
import { fingerprintOf, labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import { measureNode } from "@/ai/renderer/measure";
import type { VisualNode } from "@/ai/visual-plan/types";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { AIMetadata, DocumentRecord, RichContent } from "@/domain/types";
import type { RouteCandidate } from "./router";

export interface PlacementChoice {
  /** The card (element id) chosen, or null for a new card at `at`. */
  target: string | null;
  /** What to do there: the candidate's own action, or `insert_near` when the user prefers a new card beside it. */
  action: "update" | "insert_near" | "new" | "none";
  /** The router's candidate for `target` (its claim, for an update). */
  candidate?: RouteCandidate;
}

export interface PlacementInput {
  text: string;
  /** The content as rich text, for new cards (parsed Markdown); paragraphs of `text` when absent. */
  content?: RichContent;
  choices: readonly PlacementChoice[];
  scene: readonly SceneElement[];
  getDocument: (id: string) => DocumentRecord | null | undefined;
  /** Where a `new` card goes (its top-left). */
  at: { x: number; y: number };
  operationId: string;
  metadata?: Partial<AIMetadata>;
}

export interface PlacementResult {
  set: ChangeSet | null;
  /** What didn't go as chosen (an update placed as a new card instead), one line each. */
  notes: string[];
}

const GAP = 24;

export function placeContent(input: PlacementInput): PlacementResult {
  const byId = new Map(input.scene.filter((e) => !e.isDeleted).map((e) => [e.id, e] as const));
  const labels = labelsByContainer(input.scene);
  const content = input.content ?? paragraphs(input.text);
  const size = measureNode({ id: "placed", type: "text", content: { markdown: input.text } } as VisualNode);
  const changes: ProposedChange[] = [];
  const notes: string[] = [];
  const joins = new Map<string, string[]>();
  const stacked = new Map<string, number>(); // per frame (or card): where the next new card goes
  let n = 0;

  const newCard = (box: Box, frameId?: string) => {
    const key = `placed${++n}`;
    changes.push({ kind: "create_block", key, blockType: "text", content: structuredClone(content), box });
    if (frameId) joins.set(frameId, [...(joins.get(frameId) ?? []), key]);
  };
  const beside = (targetId: string) => {
    const t = byId.get(targetId);
    if (!t) return null;
    const frameId = t.frameId && byId.get(t.frameId)?.type === "frame" ? t.frameId : undefined;
    const members = frameId ? input.scene.filter((e) => !e.isDeleted && e.frameId === frameId && !(e.type === "text" && e.containerId)) : [t];
    const bottom = stacked.get(frameId ?? targetId) ?? Math.max(...members.map((m) => m.y + m.height));
    const box = { x: t.x, y: bottom + GAP, width: Math.max(size.width, Math.min(t.width, 480)), height: size.height };
    stacked.set(frameId ?? targetId, box.y + box.height);
    return { box, frameId };
  };

  for (const choice of input.choices) {
    if (choice.action === "none") continue;
    if (choice.action === "new" || !choice.target) {
      newCard({ x: input.at.x, y: input.at.y + (stacked.get("") ?? 0), ...size });
      stacked.set("", (stacked.get("") ?? 0) + size.height + GAP);
      continue;
    }
    if (choice.action === "update") {
      const patch = claimPatch(choice, byId.get(choice.target), labels, input.getDocument, input.text);
      if (patch) {
        changes.push(patch);
        continue;
      }
      notes.push(`“${choice.candidate?.descriptor.title ?? "The card"}” couldn't be edited exactly, so the content is added as a new card beside it.`);
    }
    const place = beside(choice.target);
    if (place) newCard(place.box, place.frameId);
  }
  for (const [frameId, add] of joins) changes.push({ kind: "update_frame", target: frameId, add });
  if (!changes.length) return { set: null, notes };
  const title = input.text.replace(/\s+/g, " ").trim();
  return {
    set: {
      operationId: input.operationId,
      title: `Place: ${title.length > 60 ? `${title.slice(0, 59)}…` : title}`,
      metadata: { createdBy: "ai", task: "route_content", ...input.metadata } as ChangeSet["metadata"],
      changes,
      reason: "Content placed where it belongs (Where should this go?)",
    },
    notes,
  };
}

/** The claim-level edit for an `update` choice, or null when it can't be placed exactly (see module doc). */
function claimPatch(
  choice: PlacementChoice,
  el: SceneElement | undefined,
  labels: ReadonlyMap<string, string>,
  getDocument: PlacementInput["getDocument"],
  /** All of the content placed: the claim's sentence alone gets a word-level edit, more replaces the sentence with all of it. */
  text: string,
): Extract<ProposedChange, { kind: "patch_block" }> | null {
  const claim = choice.candidate?.claim;
  if (!el || !claim) return null;
  const live = objectContent(el, labels, getDocument);
  if (!live || live.kind === "shape") return null;
  const blockIndex = live.content.findIndex((b) => (blockPlainText(b) ?? "").includes(claim.sentence));
  if (blockIndex < 0) return null;
  const whole = text.replace(/\s+/g, " ").trim();
  const one = claim.newSentence.replace(/\s+/g, " ").trim() === whole;
  let edit: ClaimEdit;
  if (one) {
    const hunk = wordHunk(claim.sentence, claim.newSentence);
    edit = {
      blockIndex,
      match: { anchor: { before: claim.sentence.slice(0, hunk.start), text: claim.sentence.slice(hunk.start, hunk.end), after: claim.sentence.slice(hunk.end) } },
      replacement: hunk.replacement,
      intent: claim.intent,
    };
  } else edit = { blockIndex, match: { exactText: claim.sentence }, replacement: whole, intent: claim.intent };
  const block = live.content[blockIndex]!;
  if (block.id) edit.blockId = block.id;
  if (!applyClaimEdits(live.content, [edit]).ok) return null;
  return { kind: "patch_block", target: el.id, expectedFingerprint: fingerprintOf(live), edits: [edit] };
}

function paragraphs(text: string): RichContent {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (parts.length ? parts : [text.trim()]).map((p) => ({ type: "paragraph" as const, content: p }));
}
