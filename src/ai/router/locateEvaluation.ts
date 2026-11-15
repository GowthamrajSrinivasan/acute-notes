/**
 * Stage 5f (intelligent-update-engine-plan §13.6): the locate evaluation set — "where does this new information go,
 * and what edit is it?" — and its scorer.
 *
 * A split (`evaluation/update-engine/locate/<split>.json`) holds canvases (sections of text / list / todo / table cards)
 * and cases: a piece of new information with the expected card, action, item and relation. `worldOf` builds a real
 * `WorkspaceIndex` + `VectorTier` + scene from a canvas, so any predictor — today's router, an embedding ranker, the
 * Stage 5c descent — is scored on the same ground.
 *
 * Scored separately, never blended:
 * - **section** — the right section (every case that has one);
 * - **found@1 / found@3** — the expected card is the predictor's top card (or the card a new card goes beside), or in
 *   its top three: retrieval quality, independent of the action;
 * - **card** — the content goes *into* the expected card;
 * - **action**, and **item** when the card is right — the edit (Stage 5d's anchors);
 * - **nowhere** — "fits no section" recognised; **duplicate** — "already said" recognised;
 * - **trapped** — a card that shares words with the note but is the wrong place won.
 *
 * The held-out split is pinned by hash (`locateEvaluation.test.ts`) and never scored in the default test run (§12.12
 * practice): tune on dev only.
 */
import { z } from "zod";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichBlockType, RichContent } from "@/domain/types";
import { block, doc, el, lookup } from "@/search/testFixtures";
import { WorkspaceIndex } from "@/search/workspaceIndex";
import { Descent, type DescentOptions } from "./descent";
import { VectorTier, type Embedder } from "./embedding";
import type { EmbeddingProvider } from "./embeddingProvider";
import { ItemIndex, type CardItems } from "./itemIndex";
import { routeContent } from "./router";

// ── The set ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const LOCATE_ACTIONS = ["replace_item", "after_item", "append", "table_row", "cell", "duplicate", "new_block", "new_section", "clarify"] as const;
export type LocateAction = (typeof LOCATE_ACTIONS)[number];
export const LOCATE_RELATIONS = ["NEW", "SUPERSEDES", "EXTENDS", "CONTRADICTS", "DUPLICATE"] as const;

const card = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("text"), text: z.string().min(1) }),
  z.object({ id: z.string(), kind: z.literal("list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ id: z.string(), kind: z.literal("todo"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ id: z.string(), kind: z.literal("table"), header: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1) }),
]);
const answer = z.object({
  card: z.string().nullable(),
  section: z.string().nullable(),
  action: z.enum(LOCATE_ACTIONS),
  item: z.number().int().nonnegative().nullable(),
  column: z.string().nullable(),
  row: z.array(z.string()).nullable(),
  relation: z.enum(LOCATE_RELATIONS).nullable(),
});
export const locateSetSchema = z.object({
  split: z.enum(["dev", "heldout"]),
  author: z.string(),
  date: z.string(),
  canvases: z.array(z.object({ id: z.string(), title: z.string(), sections: z.array(z.object({ id: z.string(), name: z.string(), cards: z.array(card).min(1) })).min(1) })).min(1),
  cases: z
    .array(
      z.object({
        id: z.string(),
        canvas: z.string(),
        text: z.string().min(1),
        expected: answer,
        acceptable: z.array(answer.partial({ column: true, row: true, relation: true, item: true })),
        ambiguous: z.boolean(),
        trap: z.string().nullable(),
        overlap: z.enum(["low", "high"]),
        tags: z.array(z.string()),
        why: z.string(),
      }),
    )
    .min(1),
});
export type LocateSet = z.infer<typeof locateSetSchema>;
export type LocateCase = LocateSet["cases"][number];
export type LocateCard = z.infer<typeof card>;
export type LocateCanvas = LocateSet["canvases"][number];

/** A card's items, as the set indexes them: sentences of a text card, list/todo items, table data rows. */
export function itemsOf(c: LocateCard): string[] {
  if (c.kind === "text") return sentences(c.text);
  if (c.kind === "table") return c.rows.map((r) => r.join(" "));
  return c.items;
}

/** Split at end punctuation followed by a space ("4.2" and "e.g." without a following capital stay whole). */
const sentences = (t: string) =>
  t
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Structural problems (an empty list means the split is usable). Referential checks the schema can't express. */
export function problemsOf(set: LocateSet): string[] {
  const out: string[] = [];
  const cards = new Map<string, { card: LocateCard; section: string; canvas: string }>();
  const sections = new Map<string, string>();
  for (const cv of set.canvases)
    for (const s of cv.sections) {
      if (sections.has(s.id)) out.push(`duplicate section id ${s.id}`);
      sections.set(s.id, cv.id);
      for (const c of s.cards) {
        if (cards.has(c.id)) out.push(`duplicate card id ${c.id}`);
        cards.set(c.id, { card: c, section: s.id, canvas: cv.id });
        if (c.kind === "table") c.rows.forEach((r, i) => r.length !== c.header.length && out.push(`${c.id} row ${i} has ${r.length} cells, header ${c.header.length}`));
      }
    }
  const ids = new Set<string>();
  for (const k of set.cases) {
    if (ids.has(k.id)) out.push(`duplicate case id ${k.id}`);
    ids.add(k.id);
    if (!set.canvases.some((c) => c.id === k.canvas)) out.push(`${k.id}: unknown canvas ${k.canvas}`);
    for (const [label, a] of [["expected", k.expected], ...k.acceptable.map((x, i) => [`acceptable[${i}]`, x] as const)] as const) {
      const where = `${k.id} ${label}`;
      if (a.card) {
        const c = cards.get(a.card);
        if (!c) out.push(`${where}: unknown card ${a.card}`);
        else {
          if (c.canvas !== k.canvas) out.push(`${where}: card ${a.card} is on another canvas`);
          if (a.section && a.section !== c.section) out.push(`${where}: card ${a.card} is not in section ${a.section}`);
          if (a.item != null && a.item >= itemsOf(c.card).length) out.push(`${where}: item ${a.item} out of range for ${a.card}`);
          if (a.column && (c.card.kind !== "table" || !c.card.header.includes(a.column))) out.push(`${where}: no column ${a.column} on ${a.card}`);
          if (a.action === "table_row" && c.card.kind !== "table") out.push(`${where}: table_row on a ${c.card.kind} card`);
          if ((a.action === "after_item" || a.action === "append") && c.card.kind !== "list" && c.card.kind !== "todo") out.push(`${where}: ${a.action} on a ${c.card.kind} card`);
        }
      } else if (a.section && sections.get(a.section) !== k.canvas) out.push(`${where}: unknown section ${a.section}`);
      if (a.action === "new_section" && (a.card || a.section)) out.push(`${where}: new_section must have no card or section`);
      if (a.action === "new_block" && (a.card || !a.section)) out.push(`${where}: new_block needs a section and no card`);
    }
    // "clarify" is something a predictor answers; a case marks ambiguity with `ambiguous` and keeps the real action.
    if (k.expected.action === "clarify" || k.acceptable.some((a) => a.action === "clarify")) out.push(`${k.id}: "clarify" is not an expected action — set ambiguous and the real action`);
    if (k.trap && (!cards.has(k.trap) || k.trap === k.expected.card)) out.push(`${k.id}: bad trap ${k.trap}`);
    if (k.ambiguous && k.acceptable.length === 0) out.push(`${k.id}: ambiguous without an acceptable alternative`);
  }
  return out;
}

// ── A canvas as the app would index it ────────────────────────────────────────────────────────────────────────────

const KIND_BLOCK: Record<LocateCard["kind"], RichBlockType> = { text: "text", list: "text", todo: "todo", table: "table" };

function contentOf(c: LocateCard): RichContent {
  switch (c.kind) {
    case "text":
      return [{ type: "paragraph", content: c.text }] as RichContent;
    case "list":
      return c.items.map((t) => ({ type: "bulletListItem", content: t })) as RichContent;
    case "todo":
      return c.items.map((t) => ({ type: "checkListItem", props: { checked: false }, content: t })) as RichContent;
    case "table":
      return [{ type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: c.header }, ...c.rows.map((cells) => ({ cells }))] } }] as unknown as RichContent;
  }
}

export interface LocateWorld {
  canvas: LocateCanvas;
  scene: SceneElement[];
  docs: DocumentRecord[];
  index: WorkspaceIndex;
  tier: VectorTier;
  cards: Map<string, { card: LocateCard; section: string }>;
}

export function worldOf(canvas: LocateCanvas, embedder?: Embedder): LocateWorld {
  const scene: SceneElement[] = [];
  const docs: DocumentRecord[] = [];
  const cards = new Map<string, { card: LocateCard; section: string }>();
  for (const s of canvas.sections) {
    scene.push(el({ id: s.id, type: "frame", name: s.name } as Partial<SceneElement> & Pick<SceneElement, "id" | "type">));
    for (const c of s.cards) {
      docs.push(doc(`d_${c.id}`, contentOf(c)));
      scene.push(block(c.id, `d_${c.id}`, { frameId: s.id }, KIND_BLOCK[c.kind]));
      cards.set(c.id, { card: c, section: s.id });
    }
  }
  const index = new WorkspaceIndex("ws");
  index.syncScene("cv", scene, lookup(docs));
  return { canvas, scene, docs, index, tier: new VectorTier(index, embedder), cards };
}

// ── Predictions and scoring ───────────────────────────────────────────────────────────────────────────────────────

export interface LocatePrediction {
  /** null = the predictor doesn't decide actions (a pure ranker): left out of action, item, nowhere and duplicate. */
  action: LocateAction | null;
  /** The card the content goes into (null for a new card or "nowhere"). */
  card: string | null;
  section: string | null;
  /** The card a new card goes beside (today's `insert_near`). */
  near?: string | null;
  item: number | null;
  /** For a `cell` edit: the column's header. */
  column?: string | null;
  /** Cards, best first (for found@3). */
  ranked: string[];
  /** Why, for the per-case report. */
  why?: string;
}

// ── Adjudications: decisions on disputed labels, kept beside the split (never written into it) ──────────────────

export const adjudicationsSchema = z.object({
  note: z.string(),
  decisions: z.array(
    z.object({
      case: z.string(),
      original: answer,
      adjudicated: answer,
      /** Other answers that stay right (replaces the case's `acceptable` when present). */
      acceptable: z.array(answer).optional(),
      rule: z.string(),
      decidedBy: z.string(),
      date: z.string(),
    }),
  ),
});
export type Adjudications = z.infer<typeof adjudicationsSchema>;

/** The split with each decision applied; a decision whose `original` no longer matches the case is refused. */
export function withAdjudications(set: LocateSet, adj: Adjudications): LocateSet {
  const byCase = new Map(adj.decisions.map((d) => [d.case, d] as const));
  return {
    ...set,
    cases: set.cases.map((c) => {
      const d = byCase.get(c.id);
      if (!d) return c;
      if (JSON.stringify(d.original) !== JSON.stringify(c.expected)) throw new Error(`adjudication for ${c.id}: its original no longer matches the case`);
      return { ...c, expected: d.adjudicated, ...(d.acceptable ? { acceptable: d.acceptable } : {}) };
    }),
  };
}

export type LocatePredictor = (c: LocateCase, world: LocateWorld) => LocatePrediction | Promise<LocatePrediction>;

const wordsOf = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** The item of `card` that holds `sentence` (most shared words, at least half of the shorter), else null. */
export function itemHolding(card: LocateCard, sentence: string): number | null {
  const s = wordsOf(sentence);
  let best: { i: number; score: number } | null = null;
  itemsOf(card).forEach((item, i) => {
    const w = wordsOf(item);
    const shared = [...w].filter((x) => s.has(x)).length;
    const score = shared / Math.max(1, Math.min(w.size, s.size));
    if (score >= 0.5 && (!best || score > best.score)) best = { i, score };
  });
  return (best as { i: number } | null)?.i ?? null;
}

/** Today's Stage 2 router (hashed embedder, unchanged weights), mapped onto the set's actions. */
export const routerPredictor: LocatePredictor = (c, w) => {
  const r = routeContent({ text: c.text, canvasId: "cv", tier: w.tier, scene: w.scene });
  const ranked = r.candidates.map((x) => x.id);
  const top = r.candidates[0];
  const sectionOf = (id: string) => w.cards.get(id)?.section ?? null;
  if (r.decision === "NEW" || !top) return { action: "new_section", card: null, section: null, item: null, ranked };
  if (r.decision === "NEEDS_CLARIFICATION") return { action: "clarify", card: null, near: top.id, section: sectionOf(top.id), item: null, ranked };
  const item = top.claim ? itemHolding(w.cards.get(top.id)!.card, top.claim.sentence) : null;
  if (top.action === "update") return { action: "replace_item", card: top.id, section: sectionOf(top.id), item, ranked };
  if (top.action === "none") return { action: "duplicate", card: top.id, section: sectionOf(top.id), item, ranked };
  return { action: "new_block", card: null, near: top.id, section: sectionOf(top.id), item: null, ranked };
};

/** A pure ranker: cards by a similarity function, best first. Actions are not predicted. */
export function rankingPredictor(score: (text: string, w: LocateWorld) => Promise<Map<string, number>> | Map<string, number>): LocatePredictor {
  return async (c, w) => {
    const s = await score(c.text, w);
    const ranked = [...w.cards.keys()].sort((a, b) => (s.get(b) ?? 0) - (s.get(a) ?? 0) || (a < b ? -1 : 1));
    const top = ranked[0] ?? null;
    return { action: null, card: top, section: top ? w.cards.get(top)!.section : null, item: null, ranked };
  };
}

/** A canvas's cards as the item index takes them (prototype adapter; the app would read blocks and their ids). */
export function cardItemsOf(w: LocateWorld): CardItems[] {
  return [...w.cards].map(([id, { card, section }]) => {
    const text = w.index.get(id)?.text ?? itemsOf(card).join(" ");
    if (card.kind === "text") return { card: id, section, kind: "text", text, items: itemsOf(card).map((t, i) => ({ block: 0, part: i, text: t })) };
    if (card.kind === "table") return { card: id, section, kind: "table", text, header: card.header, items: card.rows.map((cells, i) => ({ block: 0, part: i, text: cells.join(" "), cells })) };
    return { card: id, section, kind: card.kind, text, items: card.items.map((t, i) => ({ block: i, text: t })) };
  });
}

/** The 5c descent prototype as a predictor: one item index + descent per canvas, prepared once and shareable. */
export function descentPredictor(provider: EmbeddingProvider, options: Partial<DescentOptions> = {}, prepared = new Map<string, Promise<Descent>>()): LocatePredictor {
  return async (c, w) => {
    let d = prepared.get(w.canvas.id);
    if (!d) {
      d = (async () => {
        const index = new ItemIndex(provider);
        for (const card of cardItemsOf(w)) index.setCard(card);
        const descent = new Descent(index, w.canvas.sections.map((s) => ({ id: s.id, name: s.name })));
        await descent.prepare();
        return descent;
      })();
      prepared.set(w.canvas.id, d);
    }
    const p = await (await d).place(c.text, options);
    return { action: p.action, card: p.card, section: p.section, near: p.near, item: p.item, column: p.column, ranked: p.ranked, why: p.steps.join("; ") };
  };
}

export interface CaseScore {
  id: string;
  action: LocateAction;
  overlap: "low" | "high";
  predicted: LocatePrediction;
  /** End to end: the right destination, action and anchor (item, and column for a cell) — or a clarification on an ambiguous case. */
  placed?: boolean;
  section?: boolean;
  found1?: boolean;
  found3?: boolean;
  card?: boolean;
  actionRight?: boolean;
  item?: boolean;
  nowhere?: boolean;
  duplicate?: boolean;
  trapped?: boolean;
}

type Answer = { card?: string | null; section?: string | null; action: LocateAction; item?: number | null; column?: string | null };

/** Inserting after a card's last item is the same edit as appending to it: both read as an append. */
function canonical<T extends Answer>(a: T, itemCount: (card: string) => number | undefined): T {
  if (a.action === "after_item" && a.card && a.item != null && itemCount(a.card) === a.item + 1) return { ...a, action: "append", item: null };
  return a;
}

/** Does a prediction carry out this answer exactly (destination, action, anchor)? */
function carriesOut(a: Answer, p: LocatePrediction): boolean {
  if (a.action !== p.action) return false;
  if (a.action === "new_section") return true;
  if (a.action === "new_block") return (a.section ?? null) === p.section;
  if ((a.card ?? null) !== p.card) return false;
  if (a.item != null && a.item !== p.item) return false;
  if (a.action === "cell" && a.column && a.column !== (p.column ?? null)) return false;
  return true;
}

export function scoreCase(c: LocateCase, raw: LocatePrediction, itemCount: (card: string) => number | undefined = () => undefined): CaseScore {
  const answers = [c.expected, ...c.acceptable].map((a) => canonical(a as Answer, itemCount)) as LocateCase["expected"][];
  const p = raw.action ? canonical(raw as LocatePrediction & Answer, itemCount) : raw;
  const s: CaseScore = { id: c.id, action: canonical(c.expected, itemCount).action, overlap: c.overlap, predicted: p };
  if (p.action !== null) s.placed = answers.some((a) => carriesOut(a, p)) || (c.ambiguous && p.action === "clarify");
  const expSections = answers.map((a) => a.section).filter((x): x is string => !!x);
  const expCards = answers.map((a) => a.card).filter((x): x is string => !!x);
  if (expSections.length) s.section = p.section !== null && expSections.includes(p.section);
  if (expCards.length) {
    const top = p.card ?? p.near ?? null;
    s.found1 = top !== null && expCards.includes(top);
    s.found3 = p.ranked.slice(0, 3).some((id) => expCards.includes(id));
    s.card = p.card !== null && expCards.includes(p.card);
  }
  if (p.action !== null) {
    s.actionRight = c.ambiguous
      ? p.action === "clarify" || answers.some((a) => a.action === p.action && (a.card ?? null) === (p.card ?? null))
      : answers.some((a) => a.action === p.action);
    if (s.card && answers.some((a) => a.card === p.card && a.item != null))
      s.item = answers.some((a) => a.card === p.card && a.item === p.item && (a.action !== "cell" || !a.column || a.column === (p.column ?? null)));
    if (c.expected.action === "new_section") s.nowhere = p.action === "new_section";
    if (c.expected.action === "duplicate") s.duplicate = p.action === "duplicate" && s.card === true;
  }
  if (c.trap) s.trapped = (p.card ?? p.near ?? null) === c.trap;
  return s;
}

export async function evaluateLocate(set: LocateSet, predictor: LocatePredictor, embedder?: Embedder): Promise<CaseScore[]> {
  const worlds = new Map(set.canvases.map((cv) => [cv.id, worldOf(cv, embedder)] as const));
  const out: CaseScore[] = [];
  for (const c of set.cases) {
    const w = worlds.get(c.canvas)!;
    const count = (id: string) => {
      const card = w.cards.get(id)?.card;
      return card ? itemsOf(card).length : undefined;
    };
    out.push(scoreCase(c, await predictor(c, w), count));
  }
  return out;
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Metric = "placed" | "section" | "found1" | "found3" | "card" | "actionRight" | "item" | "nowhere" | "duplicate" | "trapped";
const METRICS: [Metric, string][] = [
  ["placed", "**placed**"],
  ["section", "section"],
  ["found1", "found@1"],
  ["found3", "found@3"],
  ["card", "into card"],
  ["actionRight", "action"],
  ["item", "item"],
  ["nowhere", "nowhere"],
  ["duplicate", "duplicate"],
  ["trapped", "trapped ↓"],
];

export function rate(scores: readonly CaseScore[], m: Metric): { n: number; d: number } {
  const xs = scores.filter((s) => s[m] !== undefined);
  return { n: xs.filter((s) => s[m]).length, d: xs.length };
}

const fmt = ({ n, d }: { n: number; d: number }) => (d ? `${n}/${d} (${Math.round((100 * n) / d)} %)` : "—");

/** A markdown summary: overall, by overlap, and by expected action. Every rate with its numerator and denominator. */
export function formatLocate(title: string, scores: readonly CaseScore[]): string {
  const row = (label: string, xs: readonly CaseScore[]) => `| ${label} | ${xs.length} | ${METRICS.map(([m]) => fmt(rate(xs, m))).join(" | ")} |`;
  const head = `| | cases | ${METRICS.map(([, l]) => l).join(" | ")} |\n|---|---|${METRICS.map(() => "---").join("|")}|`;
  const byAction = LOCATE_ACTIONS.filter((a) => scores.some((s) => s.action === a)).map((a) => row(a, scores.filter((s) => s.action === a)));
  return [
    `### ${title}`,
    "",
    head,
    row("all", scores),
    row("low overlap", scores.filter((s) => s.overlap === "low")),
    row("high overlap", scores.filter((s) => s.overlap === "high")),
    ...byAction,
  ].join("\n");
}
