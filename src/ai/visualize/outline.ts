/**
 * `outline_document` (F42 Phase 2): the whole document, read once, before any
 * section is generated. The model decides the document's *semantic* sections —
 * which source sections (analysis units) belong together, what each section is
 * (a `SectionKind`), whether it is primary or supporting, and how sections
 * relate — instead of mirroring the source's headings one to one. Each section
 * is then generated on its own (`generate_visual_plan` with its kind's rules)
 * and framed by the app.
 *
 * Source headings are hints: units about the same concept (the same plans
 * described in three places) are merged into one section. Sections are built
 * from whole units, so a unit is never split across sections — which keeps
 * "Update from new content" working per section (F38): a changed unit
 * regenerates only the section it belongs to.
 *
 * `validateOutline` is lenient, like F29: unknown kinds become "notes", unknown
 * unit references are dropped, and every unit the outline forgot still gets a
 * section of its own (nothing in the source is ever lost) — even a reply with
 * no usable section gives one section per unit. A merged section over
 * `MAX_SECTION_CHARS` is split back into one section per unit.
 */
import { z } from "zod";
import type { TaskDefinition } from "@/ai/tasks";
import { RELATION_TYPES, type RelationType } from "@/domain/types";
import { labelOfUnit, type SectionLink, type SectionSpec } from "@/ai/visual-plan/groups";
import { SECTION_KIND_REGISTRY, SECTION_KINDS, SECTION_PROMINENCE, sectionKind, type SectionKind, type SectionProminence } from "@/ai/visual-plan/sectionKinds";

/** The whole document is sent, but each unit's text is capped so a long document still fits one prompt. */
export const OUTLINE_BUDGET_CHARS = 24_000;
const OUTLINE_UNIT_MIN_CHARS = 600;
/** Joins the unit keys of a merged section into its key (the namespace of its nodes' stable keys). */
export const SECTION_KEY_JOINER = " ⨁ ";
const LABEL_MAX = 80;
/**
 * The most text several merged parts may hold in one section: a section is generated in one call, and a model asked for
 * a plan of a much larger one fails, cuts its reply short or runs past the call's timeout (a fast outline merged parts into
 * 9–10k-character sections whose generation timed out at 180s on a slow primary model, 2026-10-08). Over it, each part gets
 * a section of its own, and those generate in parallel. A single part is never split here (it is capped at `MAX_UNIT_CHARS`).
 */
export const MAX_SECTION_CHARS = 6_000;

export const outlineInput = z.object({
  units: z.array(z.object({ key: z.string().min(1), text: z.string().min(1) })).min(1),
});
export type OutlineInput = z.infer<typeof outlineInput>;

/** Just enough to know the reply is outline-shaped; everything else is `validateOutline`'s lenient job. */
export const outlineEnvelope = z.looseObject({ sections: z.array(z.unknown()).min(1) });

export interface OutlineSection extends SectionSpec {
  kind: SectionKind;
  prominence: SectionProminence;
  /** Unit keys, in document order. */
  units: string[];
}

export interface Outline {
  sections: OutlineSection[];
  links: SectionLink[];
  summary?: string;
}

const unitRef = (i: number) => `u${i + 1}`;

function unitExcerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const KIND_LIST = SECTION_KINDS.map((k) => `- "${k}": ${SECTION_KIND_REGISTRY[k].when}`).join("\n");

export const outlineDocumentTask: TaskDefinition<OutlineInput, unknown> = {
  task: "outline_document",
  inputSchema: outlineInput,
  outputSchema: outlineEnvelope,
  buildPrompt: ({ input, repairFeedback }) => {
    const per = Math.max(OUTLINE_UNIT_MIN_CHARS, Math.floor(OUTLINE_BUDGET_CHARS / input.units.length));
    const units = input.units.map((u, i) => `[${unitRef(i)}] (${u.key})\n${unitExcerpt(u.text, per)}`).join("\n\n");
    const prompt =
      `Design the structure of a visual knowledge workspace for the content below. The content is split into numbered parts ([u1], [u2], …) at its headings.\n\n` +
      `Group the parts into sections by MEANING, not by the source's headings — headings are hints only:\n` +
      `- Merge parts that describe the same concept or the same set of entities (e.g. plans described in several places become ONE comparison section).\n` +
      `- Every part belongs to exactly one section, and every part is used. Never invent content.\n` +
      `- Give each section a short label (at most 5 words) in the content's own words; a section that is one part keeps that part's own heading.\n\n` +
      `Classify each section by asking, in this order, and taking the first that fits:\n${KIND_LIST}\n\n` +
      `A "flow" is only for steps where each one leads to the next. Numbered or listed items that stand on their own (decisions D1, D2 …, options, requirements, findings) are not a flow, even in a numbered list.\n\n` +
      `Mark a section "primary" when it carries a main idea (the structure, the comparison, the decision) and "supporting" when it is reasoning, evidence, examples or detail. ` +
      `Order sections so the main ideas come first: what this is, the main structure or comparison, the decision; supporting sections after them.\n\n` +
      `Add links between sections only where the content states or clearly implies a relationship, using these types: ${RELATION_TYPES.map((t) => `"${t}"`).join(", ")}.\n` +
      `Add a one-line summary of the whole content (at most 15 words, e.g. "Free product + limited AI → Pro → optional BYOK").\n\n` +
      `Reply with JSON only, exactly this shape:\n` +
      `{"summary":"...","sections":[{"id":"s1","label":"...","kind":"comparison","prominence":"primary","parts":["u2","u5"]}],"links":[{"from":"s1","to":"s2","type":"supports","label":"optional"}]}\n\n` +
      `Content:\n\n${units}`;
    return {
      systemPrompt:
        "You are an information architect. You turn a document into sections of a visual workspace — grouping by meaning, not by the document's own headings — and you never invent content, kinds or relationship types.",
      prompt: repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt,
    };
  },
  // Grouping and classifying, not authoring — and the one call every section waits for: a decision model, when the user
  // configured one, answers it (a failed or unusable attempt falls through to the primary model silently).
  policy: { preferDecisionModel: true },
  // A long document's outline took 30–47s on a loaded provider; the connection's default would cut a slower one off, and a
  // failed outline makes every part its own section.
  timeoutMs: 120_000,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const pickEnum = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => (typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback);

const LEAD_UNIT = "(lead)";
const unitLabel = (key: string) => (key === LEAD_UNIT ? "Overview" : labelOfUnit(key));

/** A fallback section for a unit the outline didn't place: its own heading, a general kind. */
function unitSection(key: string): OutlineSection {
  return { key, units: [key], label: unitLabel(key), kind: "notes", prominence: "primary", arrangement: sectionKind("notes").arrangement };
}

export function sectionKeyOf(unitKeys: readonly string[]): string {
  return unitKeys.join(SECTION_KEY_JOINER);
}

export function unitsOfSectionKey(key: string): string[] {
  return key.split(SECTION_KEY_JOINER);
}

/**
 * The outline for `units` (in document order), from a raw, untrusted reply. Sections keep the model's order;
 * any unit it left out is appended as a section of its own, with a warning. When units carry their text, a merged
 * section over `MAX_SECTION_CHARS` becomes one section per unit (same kind and prominence), with a warning.
 */
export function validateOutline(raw: unknown, units: readonly { key: string; text?: string }[]): { outline: Outline; warnings: string[] } {
  const warnings: string[] = [];
  const order = new Map(units.map((u, i) => [u.key, i] as const));
  const byRef = new Map(units.map((u, i) => [unitRef(i), u.key] as const));
  const assigned = new Set<string>();
  const sections: OutlineSection[] = [];
  const idToKey = new Map<string, string>();
  const sizes = new Map(units.map((u) => [u.key, u.text?.length ?? 0] as const));
  /** A split section's links attach to its first part. */
  const splitTo = new Map<string, string>();
  const rawSections = isObject(raw) && Array.isArray(raw.sections) ? raw.sections : [];
  rawSections.forEach((s, i) => {
    if (!isObject(s)) return;
    const refs = Array.isArray(s.parts) ? s.parts : Array.isArray(s.units) ? s.units : [];
    const keys = refs.flatMap((r): string[] => {
      const key = typeof r === "string" ? (byRef.get(r) ?? (order.has(r) ? r : undefined)) : undefined;
      if (!key) {
        warnings.push(`outline section ${i + 1}: unknown part ${JSON.stringify(r)}, ignored`);
        return [];
      }
      if (assigned.has(key)) {
        warnings.push(`outline section ${i + 1}: part "${key}" is already in another section, ignored here`);
        return [];
      }
      assigned.add(key);
      return [key];
    });
    if (!keys.length) {
      warnings.push(`outline section ${i + 1}: no usable parts, dropped`);
      return;
    }
    keys.sort((a, b) => order.get(a)! - order.get(b)!);
    const kind = pickEnum(SECTION_KINDS, s.kind, "notes");
    if (kind !== s.kind) warnings.push(`outline section ${i + 1}: unknown kind ${JSON.stringify(s.kind)}, used "notes"`);
    // A section that is exactly one headed part keeps the content's own heading ("Units (Check 3a v3)", not "Unit Checks").
    const ownHeading = keys.length === 1 && keys[0] !== LEAD_UNIT ? unitLabel(keys[0]!).slice(0, LABEL_MAX) : "";
    const label = ownHeading || (typeof s.label === "string" && s.label.trim() ? s.label.trim().slice(0, LABEL_MAX) : "Section");
    const key = sectionKeyOf(keys);
    if (typeof s.id === "string") idToKey.set(s.id, key);
    const section: OutlineSection = { key, units: keys, label, kind, prominence: pickEnum(SECTION_PROMINENCE, s.prominence, "primary"), arrangement: sectionKind(kind).arrangement };
    const size = keys.reduce((n, k) => n + (sizes.get(k) ?? 0), 0);
    if (keys.length < 2 || size <= MAX_SECTION_CHARS) {
      sections.push(section);
      return;
    }
    warnings.push(`outline section ${i + 1} ("${label}"): ${keys.length} parts (${size} characters) are too much for one section, so each part got one of its own`);
    const parts = keys.map((k): OutlineSection => ({ ...section, key: k, units: [k], label: unitLabel(k) }));
    splitTo.set(key, parts[0]!.key);
    sections.push(...parts);
  });
  for (const u of units) {
    if (assigned.has(u.key)) continue;
    warnings.push(`outline: part "${u.key}" wasn't in any section, so it got one of its own`);
    sections.push(unitSection(u.key));
  }
  const rawLinks = isObject(raw) && Array.isArray(raw.links) ? raw.links : [];
  const links = rawLinks.flatMap((l): SectionLink[] => {
    if (!isObject(l) || typeof l.from !== "string" || typeof l.to !== "string") return [];
    const endpoint = (id: string) => {
      const key = idToKey.get(id);
      return key === undefined ? undefined : (splitTo.get(key) ?? key);
    };
    const from = endpoint(l.from);
    const to = endpoint(l.to);
    if (!from || !to || from === to) return [];
    const type: RelationType = pickEnum(RELATION_TYPES, l.type, "relates_to");
    return [{ from, to, type, ...(typeof l.label === "string" && l.label.trim() ? { label: l.label.trim().slice(0, 200) } : {}) }];
  });
  const summary = isObject(raw) && typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : undefined;
  // A document's only section supports nothing else: it's the main content, so never "supporting" (which is also
  // held to less in the analysis check — the live run of 2026-09-29 classified a decision reply so).
  if (sections.length === 1 && sections[0]!.kind === "supporting") {
    warnings.push(`outline: the only section can't be supporting detail, so it is "notes"`);
    sections[0] = { ...sections[0]!, kind: "notes", prominence: "primary", arrangement: sectionKind("notes").arrangement };
  }
  return { outline: { sections, links: links.slice(0, sections.length + 2), ...(summary ? { summary } : {}) }, warnings };
}
