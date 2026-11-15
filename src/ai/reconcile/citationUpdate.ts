/**
 * Citation-driven "Update from new content" (knowledge-notes-plan §6.1, Phase 3, WP3.1–3.3): the wiring of
 * `citations.ts` into `update.ts`. **Behind `CITATION_UPDATE_CONFIG.enabled`, off until R2**: with it off, nothing here
 * runs and an update is exactly the section path it always was.
 *
 * With it on, an outlined (`sectioned`) AI source whose previous version has units and whose cards cite them is updated
 * card by card instead of section by section:
 *
 * | Decision (`planCitationUpdate`) | What the update proposes |
 * |---|---|
 * | `keep` | nothing: the node is reused, no model call. With `moveTo`, a **move** of the card into that section's frame |
 * | `resend` | one `resend_cards` call per section (the cards under local ids, passages as text); a rewritten card is a clean update, an unchanged one is kept, one the reply misses is marked "source changed" |
 * | `conflict` (the user edited it) | resent too, and proposed as today's conflict card (`classify.ts`: user edits always win) |
 * | `review`, `recheck` | a `mark_review` change (`reviewAfterUpdate`): never rewritten, shown amber until resolved |
 * | `remove` | the node is left out of the plan, so the removal is proposed (never silent) |
 * | new units (and changed units no card cites) | sent as new content for their section (today's "appended" prompt); the section's other cards stay |
 *
 * It falls back to the section path, whole, when citations can't decide: no previous units or lineage (an old canvas,
 * §6.3), no card that cites anything, a card citing another version's ids (`section`), or new content under a topic no
 * section of the plan holds (a new section needs the outline). Objects that cite nothing (section titles, headings,
 * cards made under `preserve`) are left as they are in card mode.
 *
 * Known limits (until R2's live runs): new cards made from new content carry no citations yet (they take the section
 * path on a later update), and a re-check of a card whose passages were partly removed is a "source changed" mark, not a
 * new model check.
 */
import type { ChangeSetKnowledge, ProposedChange } from "@/ai/changes/changeSet";
import type { CardReview, Lineage, ReviewFlag, UnitSet } from "@/ai/fidelity/contracts";
import { matchVersions, splitUnits } from "@/ai/fidelity/sourceUnits";
import type { AIRuntime, ProviderRole } from "@/ai/runtime";
import { UNIT_SECTION_SUFFIX, withoutUnitSections, wrapSections } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import type { OutlineSection } from "@/ai/visualize/outline";
import { generateSection, isFatalAIError, sectionsOfPlan } from "@/ai/visualize/outlined";
import type { ResendCardsInput } from "@/ai/visualize/tasks";
import type { ContentSourceVersion } from "@/domain/types";
import { cardResendInput, CITATION_UPDATE_CONFIG, planCitationUpdate, readCardResendReply, reviewAfterUpdate, type CardDecision, type CitationUpdatePlan, type CitedCard, type ResendOutcome } from "./citations";
import type { ExistingObject } from "./classify";
import { mergeUnitPlans, unitOfKey } from "./keys";
import { expandUnchanged, representationOf, withCurrentKept } from "./preserve";
import type { PathIds } from "./topicIds";

/** The units the next version stores, and the lineage from the previous one (as `recordAcceptedSource` computes them). */
export interface NextIdentity {
  units: UnitSet;
  lineage?: Lineage;
}

const isUnitSet = (v: unknown): v is UnitSet => {
  if (typeof v !== "object" || v === null) return false;
  const { units, nextId } = v as Partial<UnitSet>;
  return Array.isArray(units) && Number.isInteger(nextId) && units.every((u) => typeof u?.id === "string" && typeof u.hash === "string" && typeof u.text === "string" && typeof u.topic === "string");
};

/**
 * The next version's units: carried over from the previous version's by `matchVersions` (with the new `pathIds`, so a
 * renamed section isn't read as a move), else fresh (`splitUnits`, no lineage). Null when the text can't be split; the
 * recording then computes them itself, as before.
 */
export async function nextIdentity(previous: Pick<ContentSourceVersion, "units" | "version">, text: string, pathIds: PathIds | undefined): Promise<NextIdentity | null> {
  try {
    if (isUnitSet(previous.units)) return await matchVersions({ ...previous.units, version: previous.version }, { text, version: previous.version + 1, ...(pathIds ? { pathIds } : {}) });
    return { units: await splitUnits(text, pathIds ? { pathIds } : {}) };
  } catch (err) {
    console.warn("[acute-notes] Update: the new version's source units couldn't be computed.", err);
    return null;
  }
}

/** The plan's section a unit topic (a heading path) belongs to: the section holding the longest prefix of it. */
export function sectionOfTopic(topic: string, sections: readonly OutlineSection[]): OutlineSection | undefined {
  let best: OutlineSection | undefined;
  let length = -1;
  for (const s of sections) {
    for (const key of s.units) {
      const base = key.replace(/ ·\d+$/, "");
      if ((topic === base || topic.startsWith(`${base} › `)) && base.length > length) {
        best = s;
        length = base.length;
      }
    }
  }
  return best;
}

/** A card's text as the resend shows it: a text card's title and body, a page's; null for anything else (not resendable). */
function cardText(node: VisualNode | undefined): { title: string; body: string } | null {
  if (!node) return null;
  if (node.type === "text") return { title: node.title ?? "", body: node.content.markdown };
  if (node.type === "page") return { title: node.content.title, body: node.content.markdown };
  return null;
}

/** The node with the resend's rewritten title and body. */
function rewritten(node: VisualNode, title: string, body: string): VisualNode {
  if (node.type === "text") return { ...node, ...(title ? { title } : {}), content: { markdown: body } };
  if (node.type === "page") return { ...node, content: { title: title || node.content.title, markdown: body } };
  return node;
}

const SOURCE_CHANGED = "the source changed a passage this card cites; check that the card still says what the source says";

export interface CardsUpdateArgs {
  runtime: AIRuntime;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
  previous: ContentSourceVersion;
  identity: NextIdentity;
  existing: readonly ExistingObject[];
  /** The previous plan as stored (grouped) and flat. */
  previousGrouped: VisualPlan;
  previousPlan: VisualPlan;
  /** Node ids of what this update generates. */
  prefix: string;
  /** Overrides `CITATION_UPDATE_CONFIG.enabled` (tests, the developer setting). */
  enabled?: boolean;
}

export interface CardsUpdateResult {
  raw: { version: 1; template: "sectioned"; nodes: VisualNode[]; relationships: VisualRelationship[] };
  sections: OutlineSection[];
  /** Section keys that were sent to a model (a resend or new content), and those reused without a call. */
  reanalyzedUnits: string[];
  reusedUnits: string[];
  provenance?: { providerId: string; role: ProviderRole; model: string };
  /** Changes the plan can't express: review marks and moves between sections. */
  extra: ProposedChange[];
  /** The written cards' citations and review (by stable key), for `ChangeSet.knowledge`. */
  cards: ChangeSetKnowledge["cards"];
  plan: Extract<CitationUpdatePlan, { mode: "cards" }>;
}

/** Card mode, or null when the update takes the section path (see the module comment). Fatal AI errors propagate. */
export async function citationCardsUpdate(args: CardsUpdateArgs): Promise<CardsUpdateResult | null> {
  const { previous, identity, existing, previousGrouped, previousPlan } = args;
  if (!isUnitSet(previous.units) || !identity.lineage) return null;
  const cited: CitedCard[] = existing
    .filter((o) => !!o.sourceUnits?.length)
    .map((o) => ({ objectId: o.objectId, stableNodeKey: o.stableNodeKey, cites: o.sourceUnits!, edited: o.current === null || o.current !== o.baseline, excluded: o.excluded, ...(o.review ? { review: o.review } : {}) }));
  if (!cited.length) return null;
  const plan = planCitationUpdate({
    previous: previous.units,
    next: identity.units,
    lineage: identity.lineage,
    previousVersion: previous.version,
    nextVersion: previous.version + 1,
    cards: cited,
    enabled: args.enabled ?? CITATION_UPDATE_CONFIG.enabled,
  });
  if (plan.mode !== "cards" || plan.counts.section > 0) return null;

  const sections = sectionsOfPlan(previousGrouped);
  const unitById = new Map(identity.units.units.map((u) => [u.id, u] as const));
  const newContent: { section: OutlineSection; text: string }[] = [];
  for (const { topic, units } of plan.newContent) {
    const section = sectionOfTopic(topic, sections);
    if (!section) return null; // a new topic: the outline decides where it goes (section path)
    const text = units.flatMap((id) => unitById.get(id)?.text ?? []).join("\n\n");
    const had = newContent.find((n) => n.section.key === section.key);
    if (had) had.text = `${had.text}\n\n${text}`;
    else if (text.trim()) newContent.push({ section, text });
  }

  const objectById = new Map(existing.map((o) => [o.objectId, o] as const));
  const nodeByKey = new Map(previousPlan.nodes.flatMap((n) => (n.stableKey ? [[n.stableKey, n] as const] : [])));
  const decisionOf = new Map(plan.cards.map((d) => [d.objectId, d] as const));
  const nodeOf = (d: CardDecision) => nodeByKey.get(d.stableNodeKey);
  const touched = new Set<string>();
  let provenance: CardsUpdateResult["provenance"];

  // 1. Resends: one call per section, the cards citing a changed passage (edited ones too: their answer becomes a conflict card).
  const outcomes = new Map<string, ResendOutcome>();
  const groups = new Map<string, CardDecision[]>();
  for (const d of plan.cards) {
    if (d.action !== "resend" && d.action !== "conflict") continue;
    const first = d.changes.map((c) => unitById.get(c.unit)).find((u) => !!u);
    const topic = d.moveTo ?? first?.topic ?? "";
    groups.set(topic, [...(groups.get(topic) ?? []), d]);
  }
  for (const [topic, decisions] of groups) {
    const section = sectionOfTopic(topic, sections);
    const input = cardResendInput(section?.label ?? topic, decisions.map((d) => ({ ...d, action: "resend" as const })), identity.units, (objectId) => cardText(nodeOf(decisionOf.get(objectId)!)));
    if (section) touched.add(section.key);
    if (!input.cards.length) continue;
    args.onProgress?.(`Updating ${input.cards.length} ${input.cards.length === 1 ? "card" : "cards"} whose source changed…`);
    const { objectOf, ...sent } = input;
    try {
      const r = await args.runtime.run<ResendCardsInput, unknown>("resend_cards", sent, { signal: args.signal });
      provenance = { providerId: r.providerId, role: r.role, model: r.usage.model };
      for (const [objectId, outcome] of Object.entries(readCardResendReply(r.data, { objectOf }))) outcomes.set(objectId, outcome);
    } catch (err) {
      if (isFatalAIError(err)) throw err;
      // The call failed: every card in it stays as it is, marked "source changed" (never silently left stale).
      for (const objectId of Object.values(objectOf)) outcomes.set(objectId, { kind: "missing", problem: err instanceof Error ? err.message : String(err) });
    }
  }

  // 2. New content per section: today's "appended" prompt with the section's current drawing, so its cards stay as they are.
  const failures: string[] = [];
  const shown = withoutUnitSections(previousPlan);
  const sectionNodes = new Map<string, { nodes: VisualNode[]; relationships: VisualRelationship[] }>();
  for (const { section, text } of newContent) {
    const rep = representationOf(shown, section.key);
    if (!rep) return null;
    args.onProgress?.(`Adding what's new to “${section.label}”…`);
    const r = await generateSection(args.runtime, { template: "sectioned", section: { label: section.label, kind: section.kind }, text, current: rep.current, appended: true }, failures, args.signal);
    if (!r.result) continue;
    provenance = { providerId: r.result.providerId, role: r.result.role, model: r.result.usage.model };
    const merged = mergeUnitPlans("sectioned", [{ unitKey: section.key, raw: expandUnchanged(withCurrentKept(r.data, rep), rep) }], args.prefix);
    const wrapped = wrapSections(merged, [section], { idPrefix: args.prefix, flat: true, titleKey: null }) as { nodes?: VisualNode[]; relationships?: VisualRelationship[] };
    sectionNodes.set(section.key, { nodes: (wrapped.nodes ?? []).filter((n) => !n.stableKey?.endsWith(UNIT_SECTION_SUFFIX)), relationships: wrapped.relationships ?? [] });
    touched.add(section.key);
  }
  // A section whose new content couldn't be analysed is never proposed as done (as a failed regeneration).
  if (failures.length) throw new Error(failures.join(" "));

  // 3. The plan: every previous node, except the sections rebuilt in step 2; then each decision applied by stable key.
  const rebuilt = (n: VisualNode) => !!n.stableKey && sectionNodes.has(unitOfKey(n.stableKey) ?? "") && !n.stableKey.endsWith(UNIT_SECTION_SUFFIX);
  let nodes = [...previousPlan.nodes.filter((n) => !rebuilt(n)), ...[...sectionNodes.values()].flatMap((s) => s.nodes)];
  const keptIds = new Set(nodes.map((n) => n.id));
  let relationships = [...previousPlan.relationships.filter((r) => keptIds.has(r.from) && keptIds.has(r.to)), ...[...sectionNodes.values()].flatMap((s) => s.relationships)];
  const extra: ProposedChange[] = [];
  const cards: ChangeSetKnowledge["cards"] = {};
  const removed = new Set<string>();
  const mark = (d: CardDecision, review: CardReview | undefined) => {
    if (review?.reasons.length) extra.push({ kind: "mark_review", target: d.objectId, stableNodeKey: d.stableNodeKey, review });
  };
  for (const d of plan.cards) {
    const object = objectById.get(d.objectId);
    if (d.action === "remove") {
      removed.add(d.stableNodeKey);
      continue;
    }
    if (d.action === "resend" || d.action === "conflict") {
      const outcome = outcomes.get(d.objectId);
      if (outcome?.kind === "rewritten") {
        nodes = nodes.map((n) => (n.stableKey === d.stableNodeKey ? rewritten(n, outcome.title, outcome.body) : n));
        // Written by the update: the card's citations after it, and its review (an empty one clears a stale resolution).
        cards[d.stableNodeKey] = { sourceUnits: d.cites, review: reviewAfterUpdate(object?.review, d) ?? { reasons: [] } };
      } else if (outcome?.kind === "unchanged") {
        if (d.cites.join() !== (object?.sourceUnits ?? []).join()) cards[d.stableNodeKey] = { sourceUnits: d.cites };
      } else {
        const flag: ReviewFlag = { code: "source_changed", card: d.objectId, detail: SOURCE_CHANGED };
        mark(d, reviewAfterUpdate(object?.review, d, [flag]));
      }
    } else if (d.action === "review" || d.action === "recheck") {
      mark(d, reviewAfterUpdate(object?.review, d));
    }
    if (d.moveTo !== undefined) {
      const move = moveIntoSection(d, object, d.moveTo, sections, existing);
      if (move) extra.push(move);
    }
  }
  if (removed.size) {
    const gone = new Set(nodes.filter((n) => n.stableKey && removed.has(n.stableKey)).map((n) => n.id));
    nodes = nodes.filter((n) => !gone.has(n.id));
    relationships = relationships.filter((r) => !gone.has(r.from) && !gone.has(r.to));
  }
  for (const d of plan.cards) {
    const topic = d.changes.map((c) => unitById.get(c.unit)?.topic).find((t) => t !== undefined);
    const s = topic !== undefined ? sectionOfTopic(topic, sections) : undefined;
    if (s && d.action !== "keep" && d.action !== "skip") touched.add(s.key);
  }
  const keys = sections.map((s) => s.key);
  return {
    raw: { version: 1, template: "sectioned", nodes, relationships },
    sections,
    reanalyzedUnits: keys.filter((k) => touched.has(k)),
    reusedUnits: keys.filter((k) => !touched.has(k)),
    ...(provenance ? { provenance } : {}),
    extra,
    cards,
    plan,
  };
}

/** Where a card goes when its cited passages all moved to another section: below that section's lowest object, in its frame. */
function moveIntoSection(d: CardDecision, object: ExistingObject | undefined, topic: string, sections: readonly OutlineSection[], existing: readonly ExistingObject[]): ProposedChange | null {
  const section = sectionOfTopic(topic, sections);
  if (!section || !object?.box) return null;
  const title = existing.find((o) => o.stableNodeKey === `${section.key}${UNIT_SECTION_SUFFIX}`);
  const frame = title?.frameId;
  if (!frame || frame === object.frameId) return null;
  const members = existing.filter((o) => o.frameId === frame && o.box && o.objectId !== object.objectId);
  const lowest = members.reduce<ExistingObject | null>((a, o) => (!a || o.box!.y + o.box!.height > a.box!.y + a.box!.height ? o : a), null);
  const to = lowest ? { x: lowest.box!.x, y: Math.round(lowest.box!.y + lowest.box!.height + 24) } : { x: title.box?.x ?? object.box.x, y: Math.round((title.box?.y ?? object.box.y) + (title.box?.height ?? 0) + 24) };
  return { kind: "move", target: d.objectId, to, frame };
}
