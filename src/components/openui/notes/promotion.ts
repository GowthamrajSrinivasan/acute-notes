/**
 * Promotion (`.ai/docs/openui-integration-plan.md` Phase 2): a generated note pinned from the Notes view becomes an
 * ordinary editable canvas card. Additive only — one `create_block` through the same change-set path as the Source
 * tab's "Add to canvas" (`addPassageCard`): one undoable step, no model call.
 *
 * What is persisted (plan §4 open question, decided here provisionally): the **rendered content** — title, body and
 * detail as Markdown in a normal rich block — plus the existing provenance (`createdBy: "ai"`, task, operation) and,
 * when the note came from a stored source, the source link and cited units through the change set's `passage` field.
 * The OpenUI Lang itself is not stored: once pinned, the card is BlockNote content the user edits like any other, and
 * no new `AIMetadata` field is needed. A `passage` card is opted out of updates (`excludeFromReconciliation`), so the
 * Intelligent Update Engine's patch path never touches it — the reason this phase is clear of that work (§2).
 */
import { type ChangeSet } from "@/ai/changes/changeSet";
import type { CardReview } from "@/ai/fidelity/contracts";
import { renderVisualPlan } from "@/ai/renderer/render";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { newId } from "@/domain/ids";

export interface PromotableNote {
  key: string;
  title: string;
  body: string;
  detail?: string;
  cites: readonly string[];
  /** The stored source version the note's units belong to; absent: an unlinked card. */
  source?: { sourceId: string; version: number };
  /** The free check's review of the card (`notesCheck.ts`): pinned with it, so a flagged card lands in the review queue. */
  review?: CardReview;
}

/** The pinned card's Markdown: the body, then the detail as its own paragraph. */
export function promotedMarkdown(note: Pick<PromotableNote, "title" | "body" | "detail">): string {
  return [note.body, note.detail].filter((s) => s && s.trim()).join("\n\n") || note.title;
}

/** The change set that pins `note` (pure apart from ids; exported for tests). */
export async function promotionSet(
  note: PromotableNote,
  context: Parameters<typeof renderVisualPlan>[1]["context"],
  parseMarkdown?: Parameters<typeof renderVisualPlan>[1]["parseMarkdown"],
): Promise<{ set: ChangeSet; key: string }> {
  const stableKey = `openui § ${note.key}`;
  const plan = validateVisualPlan({
    version: 1,
    template: "sectioned",
    nodes: [{ id: "n1", type: "text", title: note.title, content: { markdown: promotedMarkdown(note) }, stableKey }],
    relationships: [],
  }).plan;
  const operationId = newId("op");
  const rendered = await renderVisualPlan(plan, {
    operationId,
    title: "Pin note",
    metadata: { createdBy: "ai", task: "generate_openui_notes", operationId, ...(note.source ? { noteModel: "distil" as const } : {}) },
    context,
    ...(parseMarkdown ? { parseMarkdown } : {}),
  });
  const created = rendered.changes.find((c) => c.kind === "create_block");
  const set: ChangeSet = {
    ...rendered,
    ...(note.source && note.cites.length
      ? { passage: { sourceId: note.source.sourceId, version: note.source.version }, knowledge: { cards: { [stableKey]: { sourceUnits: [...note.cites], ...(note.review ? { review: note.review } : {}) } } } }
      : {}),
  };
  return { set, key: created?.key ?? "" };
}
