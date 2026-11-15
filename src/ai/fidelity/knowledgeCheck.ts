/**
 * Distil mode's checks of one section and of a whole run (knowledge-notes-plan §3.2–§3.4, WP1.10–1.11): the pure
 * glue between a section's distil reply and the checkers (`accounting.ts`, `exactness.ts`, `meaning.ts`), the model
 * check's items and verdicts (`semanticCheck.ts`), the one merged retry's reasons, and the run's output
 * (`KnowledgeRunOutput`). `outlined.ts` runs it per section; `visualize.ts` finishes the run. Nothing here is used in
 * `preserve`.
 *
 * **The meaning rules are hints only.** `checkMeaning` (and the warn tier's named terms) never make a card Needs review
 * on their own: on fresh text their false alarms were 33–83% and their recall 0–83% in most kinds
 * (`.ai/docs/meaning-rules-evaluation-2026-10-19.md`), so they can't be a gate (§3.4: "a rule is dropped if it can't
 * reach the targets"). They are shown as a review's detail, sent with the section's one retry when it retries for
 * another reason, and pick the cards the optional model check looks at (OD5: flagged cards only). A card is in Needs
 * review only for a deterministic reason (a unit unaccounted, a caveat omitted, a card citing nothing, a protected
 * detail missing, a citation unrelated to the card, a critical unit whose condition, caveat or requirement no citing
 * card keeps: `representation.ts`) or the model check's "partly" / "not supported" / no answer. Exactness (§3.3) stays
 * deterministic.
 */
import { accountUnits } from "./accounting";
import type { AccountingResult, CardReview, DistilReply, Idea, Omission, ProtectedItem, ReviewFlag, SemanticVerdict, SourceUnit, UnitId } from "./contracts";
import { checkExactness, normalizeForCompare, plainText, protectedItemsOf } from "./exactness";
import { checkMeaning } from "./meaning";
import { cardViews, droppedKindOf, lengthHints, limitHost, onMembers, representationFlags, type CardView, type ExplainedBy } from "./representation";
import type { SemanticCheckAnswer, SemanticCheckItem } from "./semanticCheck";

// ---------------------------------------------------------------- citations on the raw reply

/**
 * Private fields the distil wiring puts on a raw reply's nodes, so citations travel with their node through reference
 * expansion, piece and section merges (all spread a node's fields). `validateVisualPlan` keeps neither (zod strips
 * unknown keys), so they never reach a stored plan or the canvas.
 */
export const CITES = "__cites";
export const BY_REFERENCE = "__byRef";
export const UNCITED = "__uncited";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Node types that hold no idea of their own (`readDistilReply`'s `UNCITED_TYPES`). */
const STRUCTURAL = new Set(["group", "heading"]);

function refOf(n: Record<string, unknown>): string | undefined {
  return [n.ref, n.sourceRef, n.source_ref, isObject(n.content) ? n.content.ref : undefined].find((v): v is string => typeof v === "string" && !!v.trim());
}

/**
 * `raw` with each node's citations (`DistilReply.cites`, already unit ids) on the node itself, a block placed by reference
 * marked as such (verbatim by construction), and a content node that gave no `cites` at all marked uncited. Run on the
 * reply as the model gave it, before references are expanded.
 */
export function annotateDistil(raw: unknown, reply: DistilReply): unknown {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return raw;
  const nodes = raw.nodes.map((n, i) => {
    if (!isObject(n)) return n;
    const id = typeof n.id === "string" && n.id.trim() ? n.id : `node ${i}`;
    const ref = refOf(n);
    const byRef = n.type === "source" || (!!ref && !(isObject(n.content) && Object.keys(n.content).some((k) => k !== "ref")));
    const cites = reply.cites[id];
    const uncited = n.cites === undefined && !ref && n.origin !== "analysis" && !STRUCTURAL.has(String(n.type));
    return { ...n, ...(cites?.length ? { [CITES]: [...cites] } : {}), ...(byRef ? { [BY_REFERENCE]: true } : {}), ...(uncited && !cites?.length ? { [UNCITED]: true } : {}) };
  });
  return { ...raw, nodes };
}

/** A node's text besides its title, as the checkers read it (bullets and rows one per line). */
export function nodeBody(n: Record<string, unknown>): string {
  const c = isObject(n.content) ? n.content : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (n.type) {
    case "text":
      return str(c.markdown);
    case "page":
      return [str(c.title), str(c.markdown)].filter(Boolean).join("\n");
    case "todo":
      return Array.isArray(c.items) ? c.items.map((i) => (isObject(i) ? str(i.text) : "")).filter(Boolean).join("\n") : "";
    case "table": {
      const columns = Array.isArray(c.columns) ? c.columns.map(String) : [];
      const rows = Array.isArray(c.rows) ? c.rows.filter(Array.isArray).map((r) => (r as unknown[]).map(String)) : [];
      return [columns, ...rows].map((r) => r.join(" | ")).join("\n");
    }
    case "code":
      return str(c.source);
    case "shape":
      return [str(c.label), str(c.sublabel), str(c.tag), ...(Array.isArray(c.details) ? c.details.map(String) : [])].filter(Boolean).join("\n");
    case "image":
      return str(c.alt);
    default:
      return [str(c.markdown), str(c.text), str(c.label)].filter(Boolean).join("\n");
  }
}

/** The cards of a raw reply as the checkers see them (frames and headings hold no idea). */
export function ideasOf(raw: unknown): Idea[] {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return [];
  return raw.nodes.flatMap((n): Idea[] => {
    if (!isObject(n) || typeof n.id !== "string" || STRUCTURAL.has(String(n.type))) return [];
    const title = typeof n.title === "string" ? n.title : "";
    const body = nodeBody(n);
    if (!title.trim() && !body.trim()) return [];
    const cites = Array.isArray(n[CITES]) ? (n[CITES] as unknown[]).filter((u): u is string => typeof u === "string") : [];
    return [{ id: n.id, title, body, cites, ...(n.origin === "analysis" ? { origin: "analysis" as const } : {}), ...(n[BY_REFERENCE] === true ? { byReference: true } : {}) }];
  });
}

/**
 * Each explanation node of the reply → the node it explains: the `from` of an `explained_by` link (a shape's text,
 * a concept's page). The first link to a node wins, as the layout places it (`renderer/layout.ts`).
 */
export function explainedByOf(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!isObject(raw) || !Array.isArray(raw.relationships)) return out;
  for (const r of raw.relationships) {
    if (!isObject(r) || r.type !== "explained_by" || typeof r.from !== "string" || typeof r.to !== "string" || r.from === r.to || out.has(r.to)) continue;
    out.set(r.to, r.from);
  }
  return out;
}

/** Ids of the reply's diagram `shape` nodes (a label-only one may join the full card covering its units: `cardViews`). */
export function shapesOf(raw: unknown): Set<string> {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return new Set();
  return new Set(raw.nodes.flatMap((n) => (isObject(n) && n.type === "shape" && typeof n.id === "string" ? [n.id] : [])));
}

/** Ids of the reply's content nodes that gave no `cites` (and aren't analysis, a frame, a heading or a block by reference). */
function uncitedCards(raw: unknown): string[] {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return [];
  return raw.nodes.flatMap((n) => (isObject(n) && typeof n.id === "string" && n[UNCITED] === true && !(Array.isArray(n[CITES]) && n[CITES].length) ? [n.id] : []));
}

// ---------------------------------------------------------------- one section

export interface SectionInspection {
  ideas: Idea[];
  /**
   * The cards as the checks read them (`cardViews`): each card with the nodes that explain it (`explained_by`) folded
   * in. Citation sanity, critical content kept, the meaning hints and the model check read these; one per idea when
   * the reply links no explanations.
   */
  views: CardView[];
  /** Protected items of the section's units (§3.3). */
  items: ProtectedItem[];
  /** Exact-tier items missing from every card citing their unit. */
  exactMissing: ProtectedItem[];
  /** Needs review reasons besides accounting's own: uncited cards, missing exact items, the model check's verdicts. */
  flags: ReviewFlag[];
  /** The meaning rules' and named terms' findings: hints only (see the module comment). */
  hints: ReviewFlag[];
  /** The section's units, accounted for (§3.2). */
  accounting: AccountingResult;
  /**
   * Distinct Needs review items: units in Needs review, plus cards (`views`: a card with its explanations counted once)
   * with a review flag of their own.
   */
  needsReview: number;
}

const short = (text: string, max = 120) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

/**
 * One section's reply checked against its units: exactness, the meaning hints, uncited cards, and the accounting.
 * `extra` adds review flags decided elsewhere (the model check's). `pending`: the section failed, so its units are
 * never shown as complete.
 */
export function inspectSection(
  raw: unknown,
  units: readonly SourceUnit[],
  omitted: readonly Omission[],
  options: { extra?: readonly ReviewFlag[]; pending?: boolean; aiSupported?: ReadonlySet<string>; restoredLimits?: readonly UnitId[] } = {},
): SectionInspection {
  const ideas = options.pending ? [] : ideasOf(raw);
  const explainedBy: ExplainedBy = options.pending ? new Map() : explainedByOf(raw);
  const shapes = options.pending ? new Set<string>() : shapesOf(raw);
  const views = cardViews(ideas, { explainedBy, shapes });
  const viewOf = new Map(views.map((v) => [v.id, v] as const));
  const ideaById = new Map(ideas.map((i) => [i.id, i] as const));
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const items = protectedItemsOf(units);
  const exact = checkExactness(items, ideas);
  // Citation sanity and critical content kept are deterministic Needs review reasons (`representation.ts`); the meaning
  // rules' own "unrelated citation" hint is the same finding, so it is not repeated as a hint.
  // A shape and the text that explains it are one card to these checks (`cardViews`).
  // A label-only shape joins the full card covering its units (`cardViews`).
  const represented = representationFlags(ideas, units, { explainedBy, shapes, ...(options.aiSupported ? { aiSupported: options.aiSupported } : {}) });
  const hints = [
    ...exact.flags,
    ...views.flatMap((view) => checkMeaning(view, view.cites.flatMap((u) => byId.get(u) ?? [])).filter((h) => h.code !== "citation_unrelated")),
    ...represented.hints,
    // A card longer than the passages it cites: a hint only (`DISTIL_RULE`'s brevity; never Needs review).
    ...lengthHints(views, units, items),
  ];
  const flags: ReviewFlag[] = [
    ...exact.missing.map((item): ReviewFlag => ({ code: "exact_missing", unit: item.unit, detail: `"${short(item.value, 80)}" isn't on any card citing it`, evidence: { source: item.value } })),
    ...(options.pending ? [] : uncitedCards(raw)).map((card): ReviewFlag => ({ code: "uncited_card", card, detail: "the card cites no passage of the source" })),
    ...represented.flags,
    // A verdict on a card (with its explanations) is about each of its nodes, so accounting agrees.
    ...(options.extra ?? []).flatMap((f) => (f.card ? onMembers(f, viewOf.get(f.card), ideaById) : [f])),
  ];
  // A unit omitted as superseded was revised by a later statement: its old details are never put back ("restored").
  const superseded = new Set(omitted.filter((o) => o.reason === "superseded").map((o) => o.unit));
  const protectedUnits = new Set(items.filter((i) => i.tier === "exact" && !superseded.has(i.unit)).map((i) => i.unit));
  const accounting = accountUnits({
    units,
    ideas,
    omitted,
    protectedUnits,
    flags,
    ...(options.pending ? { pending: units.map((u) => u.id) } : {}),
    ...(options.restoredLimits?.length ? { restored: options.restoredLimits } : {}),
  });
  // A card with its explanations is one item (plan §9 G1 counts cards, not nodes).
  const headOf = new Map(views.flatMap((v) => v.members.map((m) => [m, v.id] as const)));
  const flaggedCards = new Set(flags.flatMap((f) => (f.card ? [headOf.get(f.card) ?? f.card] : [])));
  const needsReview = Object.values(accounting.outcome).filter((o) => o === "needs_review").length + flaggedCards.size;
  return { ideas, views, items, exactMissing: exact.missing, flags, hints, accounting, needsReview };
}

/** An item's identity across two replies of one section. */
const itemKey = (i: ProtectedItem) => `${i.unit}\u0000${i.kind}\u0000${normalizeForCompare(i.value)}`;

/**
 * Whether a retried reply is better than the first (WP1.10, as Wave A2): it loses no protected item the first kept, and
 * it has fewer problems in all (Needs review items, missing exact items, missing analysis).
 */
export function retryIsBetter(first: { inspection: SectionInspection; analysisMissing: number }, retry: { inspection: SectionInspection; analysisMissing: number }): boolean {
  const kept = new Set(first.inspection.exactMissing.map(itemKey));
  if (retry.inspection.exactMissing.some((i) => !kept.has(itemKey(i)))) return false;
  // A protected unit the model omitted is put back by the app (`restored`): a problem too, if not one the reader sees.
  const restored = (x: typeof first) => Object.values(x.inspection.accounting.state).filter((st) => st === "restored").length;
  const problems = (x: typeof first) => x.inspection.needsReview + x.inspection.exactMissing.length + restored(x) + x.analysisMissing;
  return problems(retry) < problems(first);
}

const MAX_RETRY_REASONS = 60;

/** A card's name for the model and the reader: its title, else its first line ("Retrieve Candidates"). */
const cardTitle = (card: Pick<Idea, "title" | "body">) => (card.title.trim() || card.body.split("\n").find((l) => l.trim()) || "").trim();

function criticalOmittedReason(label: string, reasons: readonly string[]): string {
  if (reasons.includes("open_question")) return `${label} was omitted, but it is a question nobody answered: keep it, as an open question.`;
  if (reasons.includes("decision") && !reasons.some((r) => r === "limitation" || r === "requirement" || r === "condition"))
    return `${label} was omitted, but it records a decision (agreement to a proposal): keep it, on the card of the decision.`;
  return `${label} was omitted, but it carries a condition, limit or caveat: keep it, on the card of the claim it applies to.`;
}

/** A critical unit's clause that every card citing it drops, with the card it belongs on. */
export interface DroppedClause {
  unit: UnitId;
  /** As the source words it ("when the cache holds a valid result"). */
  clause: string;
  kind: "condition" | "caveat" | "requirement";
  /** The card (with its explanations) it belongs on: of the cards citing the unit, the closest to it (`limitHost`). */
  card: CardView;
}

/**
 * Every distinct clause the section's `critical_dropped` flags name, each with its one card: the retry names it
 * verbatim on that card, and `restoreLimits` puts it there when the retry didn't. `units` lets the card be chosen by
 * the whole unit's words (else by the clause's). Deterministic.
 */
export function droppedClauses(inspection: Pick<SectionInspection, "flags" | "views">, units?: readonly SourceUnit[]): DroppedClause[] {
  const viewOf = new Map(inspection.views.flatMap((v) => v.members.map((m) => [m, v] as const)));
  const textOf = new Map((units ?? []).map((u) => [u.id, u.text] as const));
  const groups = new Map<string, { unit: UnitId; clause: string; kind: DroppedClause["kind"]; cards: CardView[] }>();
  for (const f of inspection.flags) {
    if (f.code !== "critical_dropped" || !f.card || !f.unit || !f.evidence?.source) continue;
    const view = viewOf.get(f.card);
    if (!view) continue;
    const key = `${f.unit}\u0000${f.evidence.source}`;
    const g = groups.get(key) ?? { unit: f.unit, clause: f.evidence.source, kind: droppedKindOf(f), cards: [] };
    if (!g.cards.includes(view)) g.cards.push(view);
    groups.set(key, g);
  }
  return [...groups.values()].flatMap((g) => {
    const card = limitHost(textOf.get(g.unit) ?? g.clause, g.cards);
    return card ? [{ unit: g.unit, clause: g.clause, kind: g.kind, card }] : [];
  });
}

/**
 * The reasons of the section's one retry, in prompt labels (`labelOf`): what is deterministic first, then the reply's own
 * problems; the meaning hints only with `withHints` (when the section retries anyway — hints alone never cost a call).
 */
export function retryReasons(
  inspection: SectionInspection,
  labelOf: (unit: UnitId) => string | undefined,
  problems: readonly string[],
  options: { withHints?: boolean; units?: readonly SourceUnit[] } = {},
): string[] {
  const name = (unit: UnitId | undefined) => (unit ? (labelOf(unit) ?? "a unit") : "a unit");
  const out: string[] = [];
  const viewOf = new Map(inspection.views.flatMap((v) => v.members.map((m) => [m, v] as const)));
  const cardName = (card: string) => `"${short(cardTitle(viewOf.get(card) ?? { title: "", body: card }), 60)}"`;
  for (const item of inspection.exactMissing) out.push(`"${short(item.value, 200)}" (${name(item.unit)}) is missing: keep it exactly as the source has it, on a card citing ${name(item.unit)}.`);
  for (const [unit, state] of Object.entries(inspection.accounting.state)) {
    if (state !== "restored") continue;
    const values = inspection.items.filter((i) => i.unit === unit && i.tier === "exact").map((i) => `"${short(i.value, 60)}"`);
    out.push(`${name(unit)} was omitted, but it holds details that must stay exact (${values.join(", ")}): cite it on the card it belongs to.`);
  }
  for (const f of inspection.accounting.flags) {
    if (f.code === "unaccounted") out.push(`${name(f.unit)} is neither cited nor omitted: cite it on the card it belongs to, or omit it for one of the listed reasons.`);
    else if (f.code === "critical_omitted") out.push(criticalOmittedReason(name(f.unit), (f.unit && inspection.accounting.critical[f.unit]) || []));
    else if (f.code === "duplicate_of_uncited") out.push(`${name(f.unit)} was omitted as a duplicate of a unit no card cites: cite it, or name the cited unit it repeats.`);
    else if (f.code === "uncited_card" && f.card) out.push(`Node "${f.card}" cites no source unit: give it "cites".`);
    else if (f.code === "citation_unrelated" && f.card) out.push(`Node "${f.card}" cites ${name(f.unit)}, but says nothing of it: cite only the units the card represents.`);
  }
  // Each dropped condition, caveat or requirement, word for word, with the one card it belongs on (`limitHost`).
  for (const d of droppedClauses(inspection, options.units)) {
    out.push(`Put "${d.clause}" (${name(d.unit)}) on card ${cardName(d.card.id)}: it is the ${d.kind} of that card's claim, and the card leaves it out. Keep it on that card, in words a reader can't miss.`);
  }
  for (const p of problems) if (!/cites no source unit|neither cited nor omitted/.test(p)) out.push(`The reply's citations: ${short(p, 300)}.`);
  if (options.withHints) {
    for (const h of inspection.hints) {
      if (h.code === "longer_than_source") out.push(`Card ${cardName(h.card ?? "")} is longer than the source passages it cites (${h.detail.replace(/^the card /, "")}): say it in fewer words, keeping every condition and exact detail.`);
      else out.push(`Check node "${h.card ?? "?"}" against ${h.unit ? name(h.unit) : "the passages it cites"} (an automatic check suggests the meaning may have changed: ${short(h.detail, 300)}); keep the source's meaning.`);
    }
  }
  return [...new Set(out)].slice(0, MAX_RETRY_REASONS);
}

/**
 * §3.3: what is still missing after the retry goes back on the canvas, word for word, so nothing protected is lost
 * silently. An exact item missing from the cards citing its unit becomes a "From the source" line on the first of them
 * (a card with text; else a small "From the source" card linked from it); a protected unit the model omitted
 * (accounting's `restored`) goes on one "From the source" card of the section. Both cite their units.
 */
export function restoreProtected(raw: unknown, inspection: SectionInspection, units: readonly SourceUnit[]): { raw: unknown; items: ProtectedItem[]; units: UnitId[] } {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return { raw, items: [], units: [] };
  const restoredUnits = units.filter((u) => inspection.accounting.state[u.id] === "restored");
  if (!inspection.exactMissing.length && !restoredUnits.length) return { raw, items: [], units: [] };
  const nodes = raw.nodes.map((n) => (isObject(n) ? { ...n } : n));
  const relationships = Array.isArray(raw.relationships) ? [...raw.relationships] : [];
  const taken = new Set(nodes.flatMap((n) => (isObject(n) && typeof n.id === "string" ? [n.id] : [])));
  let next = 1;
  const freshId = () => {
    let id = `fs${next++}`;
    while (taken.has(id)) id = `fs${next++}`;
    taken.add(id);
    return id;
  };
  const citing = (unit: UnitId) =>
    nodes.filter((n): n is Record<string, unknown> => isObject(n) && n[BY_REFERENCE] !== true && Array.isArray(n[CITES]) && (n[CITES] as unknown[]).includes(unit));
  for (const item of inspection.exactMissing) {
    const cards = citing(item.unit);
    const host = cards.find((n) => isObject(n.content) && typeof n.content.markdown === "string" && (n.type === "text" || n.type === "page"));
    const line = item.kind === "code" ? `\`\`\`\n${item.value}\n\`\`\`` : item.value;
    if (host && isObject(host.content)) {
      host.content = { ...host.content, markdown: `${String(host.content.markdown)}\n\n**From the source:** ${line}` };
      continue;
    }
    const id = freshId();
    nodes.push({ id, type: "text", title: "From the source", content: { markdown: line }, [CITES]: [item.unit] });
    const from = cards[0]?.id;
    if (typeof from === "string") relationships.push({ from, to: id, type: "explained_by" });
  }
  if (restoredUnits.length) {
    const markdown = restoredUnits.map((u) => (u.kind === "code" ? `\`\`\`\n${u.text}\n\`\`\`` : `- ${plainText(u.text)}`)).join("\n");
    nodes.push({ id: freshId(), type: "text", title: "From the source", content: { markdown }, [CITES]: restoredUnits.map((u) => u.id) });
  }
  return { raw: { ...raw, nodes, relationships }, items: [...inspection.exactMissing], units: restoredUnits.map((u) => u.id) };
}

/**
 * §3.3/§3.4 for conditions and caveats: a critical unit's condition, caveat or requirement that every card citing it
 * still drops after the one retry goes on the card it belongs on (`droppedClauses`) as a short "Limit:" line, word for
 * word from the source, so nothing critical is lost silently. The line goes on the card's first text or page node that
 * cites the unit (else any of its text or page nodes), as a detail of a shape with no text, else on a small "Limit"
 * text node explaining the card. The node then cites the unit. `units` names the units put back this way: the
 * accounting counts them `restored` (Represented), not merely `cited`.
 */
export function restoreLimits(raw: unknown, inspection: Pick<SectionInspection, "flags" | "views">, units: readonly SourceUnit[]): { raw: unknown; units: UnitId[]; lines: { unit: UnitId; card: string; text: string }[] } {
  const dropped = droppedClauses(inspection, units);
  if (!dropped.length || !isObject(raw) || !Array.isArray(raw.nodes)) return { raw, units: [], lines: [] };
  const nodes = raw.nodes.map((n) => (isObject(n) ? { ...n } : n));
  const relationships = Array.isArray(raw.relationships) ? [...raw.relationships] : [];
  const byId = new Map(nodes.flatMap((n) => (isObject(n) && typeof n.id === "string" ? [[n.id, n] as const] : [])));
  const taken = new Set(byId.keys());
  let next = 1;
  const freshId = () => {
    let id = `lim${next++}`;
    while (taken.has(id)) id = `lim${next++}`;
    taken.add(id);
    return id;
  };
  const cite = (n: Record<string, unknown>, unit: UnitId) => {
    const had = Array.isArray(n[CITES]) ? (n[CITES] as unknown[]).filter((u): u is string => typeof u === "string") : [];
    if (!had.includes(unit)) n[CITES] = [...had, unit];
  };
  const isText = (n: Record<string, unknown> | undefined): n is Record<string, unknown> & { content: Record<string, unknown> } =>
    !!n && (n.type === "text" || n.type === "page") && isObject(n.content) && typeof n.content.markdown === "string";
  const lines: { unit: UnitId; card: string; text: string }[] = [];
  for (const d of dropped) {
    const text = d.clause.charAt(0).toUpperCase() + d.clause.slice(1);
    const members = d.card.members.map((m) => byId.get(m)).filter((n): n is Record<string, unknown> => !!n && n[BY_REFERENCE] !== true);
    const citesUnit = (n: Record<string, unknown>) => Array.isArray(n[CITES]) && (n[CITES] as unknown[]).includes(d.unit);
    const host = members.find((n) => isText(n) && citesUnit(n)) ?? members.find((n) => isText(n));
    if (isText(host)) {
      host.content = { ...host.content, markdown: `${String(host.content.markdown)}\n\n**Limit:** ${text}` };
      cite(host, d.unit);
      lines.push({ unit: d.unit, card: String(host.id), text });
      continue;
    }
    const shape = members.find((n) => n.type === "shape" && isObject(n.content));
    const details = shape && isObject(shape.content) && Array.isArray(shape.content.details) ? shape.content.details.map(String) : [];
    // A shape shows at most 8 details of 200 characters (`DIAGRAM_LIMITS`): a longer line goes on its own "Limit" node.
    if (shape && isObject(shape.content) && details.length < 8 && text.length + 7 <= 200) {
      shape.content = { ...shape.content, details: [...details, `Limit: ${text}`] };
      cite(shape, d.unit);
      lines.push({ unit: d.unit, card: String(shape.id), text });
      continue;
    }
    const id = freshId();
    nodes.push({ id, type: "text", title: "Limit", content: { markdown: text }, [CITES]: [d.unit] });
    relationships.push({ from: d.card.id, to: id, type: "explained_by" });
    lines.push({ unit: d.unit, card: id, text });
  }
  return { raw: { ...raw, nodes, relationships }, units: [...new Set(dropped.map((d) => d.unit))], lines };
}

// ---------------------------------------------------------------- the optional model check (§3.4, OD5)

/**
 * The items of the section's one batched model check: the cards the rules hint about (`"flagged"`, OD5) or every citing
 * card (`"all"`, OD5b). Analysis cards may infer, and blocks placed by reference are verbatim, so neither is checked.
 * A card is read with its explanations (`SectionInspection.views`): a shape labelled "Retrieve Candidates" is checked
 * together with the text node linked from it, against every unit either cites, as one item; the text node is not checked
 * on its own. Its verdict goes on the card's id (`cardOf`); `inspectSection` and `cardReviews` give it to every node of
 * the card.
 */
export function checkItems(inspection: SectionInspection, units: readonly SourceUnit[], cards: "flagged" | "all"): { items: SemanticCheckItem[]; cardOf: Map<string, string> } {
  const byId = new Map(units.map((u) => [u.id, u] as const));
  // Length is no question of meaning: a `longer_than_source` hint alone doesn't pick a card for the check.
  const hinted = new Set(inspection.hints.flatMap((h) => (h.card && h.code !== "longer_than_source" ? [h.card] : [])));
  const items: SemanticCheckItem[] = [];
  const cardOf = new Map<string, string>();
  for (const idea of inspection.views) {
    if (idea.origin === "analysis" || idea.byReference || !idea.cites.length) continue;
    if (cards === "flagged" && !idea.members.some((m) => hinted.has(m))) continue;
    const source = idea.cites.flatMap((u) => byId.get(u)?.text ?? []).join("\n");
    const card = [idea.title, idea.body].filter((s) => s.trim()).join("\n");
    if (!source.trim() || !card.trim()) continue;
    const ref = `c${items.length + 1}`;
    items.push({ ref, source, card });
    cardOf.set(ref, idea.id);
  }
  return { items, cardOf };
}

export type CardVerdict = { verdict: SemanticVerdict; reason: string } | "unanswered";

/**
 * A check item's identity across replies: the card's text and the source it cites. The same card in the retry's reply
 * (or after a "Limit:" line, a different text) is known by it, so only cards whose text changed are checked again.
 */
export const checkItemKey = (item: Pick<SemanticCheckItem, "source" | "card">): string => `${item.source}\u0000${item.card}`;

/**
 * The model check's findings as retry reasons (the check runs before the one retry, so the retry can fix what it found):
 * one line per card it answered "partly" or "not supported", naming the card and the false belief. A card with no answer
 * gives no reason: there is nothing to tell the model.
 */
export function aiRetryReasons(inspection: Pick<SectionInspection, "views">, verdicts: ReadonlyMap<string, CardVerdict>): string[] {
  const viewOf = new Map(inspection.views.flatMap((v) => v.members.map((m) => [m, v] as const)));
  return [...verdicts].flatMap(([card, v]) => {
    if (v === "unanswered" || v.verdict === "supported") return [];
    const view = viewOf.get(card);
    const name = `"${short(cardTitle(view ?? { title: "", body: card }), 60)}"`;
    const said = v.verdict === "partly" ? "only partly supported" : "not supported";
    return [`Card ${name} is ${said} by the passages it cites${v.reason ? `: ${short(v.reason, 240)}` : ""}. Make it say what those passages say, with their conditions and caveats, and nothing they don't.`];
  });
}

/** The model check's answers by card; a card it didn't answer (or a failed call) is `unanswered`, never supported. */
export function verdictsOf(answers: readonly SemanticCheckAnswer[] | null, cardOf: ReadonlyMap<string, string>): Map<string, CardVerdict> {
  const out = new Map<string, CardVerdict>();
  for (const [ref, card] of cardOf) {
    const a = answers?.find((x) => x.ref === ref);
    out.set(card, a ? { verdict: a.verdict, reason: a.reason } : "unanswered");
  }
  return out;
}

/** The review flags the verdicts add: "partly", "not supported" and no answer keep a card in Needs review (OD5). */
export function verdictFlags(verdicts: ReadonlyMap<string, CardVerdict>): ReviewFlag[] {
  return [...verdicts].flatMap(([card, v]): ReviewFlag[] => {
    if (v === "unanswered") return [{ code: "ai_check", card, detail: "checked by AI: no answer for this card" }];
    if (v.verdict === "supported") return [];
    return [{ code: "ai_check", card, detail: `checked by AI: ${v.verdict === "partly" ? "partly supported" : "not supported"}${v.reason ? `: ${short(v.reason, 240)}` : ""}` }];
  });
}

/**
 * Each card's review (§4.1, OD5): its Needs review reasons (its own flags, and those of the units it cites), the hints
 * about it as detail, and the model check's verdict. A card with only hints and no verdict gets none: hints never make
 * a card Needs review. Wording: "checked by AI", never "verified" or "correct".
 */
export function cardReviews(inspection: SectionInspection, verdicts: ReadonlyMap<string, CardVerdict> = new Map()): Record<string, CardReview> {
  const out: Record<string, CardReview> = {};
  const reviewFlags = [...inspection.flags, ...inspection.accounting.flags.filter((f) => !inspection.flags.includes(f))];
  // A node that explains a card has the card's verdict (the check read them as one).
  const headOf = new Map(inspection.views.flatMap((v) => v.members.map((m) => [m, v.id] as const)));
  for (const idea of inspection.ideas) {
    const reasons = [...new Set(reviewFlags.filter((f) => f.card === idea.id || (f.card === undefined && f.unit !== undefined && idea.cites.includes(f.unit))).map((f) => f.detail))];
    const hints = [...new Set(inspection.hints.filter((h) => h.card === idea.id).map((h) => h.detail))];
    const v = verdicts.get(idea.id) ?? verdicts.get(headOf.get(idea.id) ?? idea.id);
    const checked = v && v !== "unanswered" ? { by: "ai" as const, verdict: v.verdict, ...(v.reason ? { reason: short(v.reason, 240) } : {}) } : undefined;
    if (!reasons.length && !checked) continue;
    out[idea.id] = { reasons, ...(hints.length ? { hints } : {}), ...(checked ? { checked } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------- a section's result, kept for the run and for "Regenerate"

/** What one distil section leaves for the run (ids are the section reply's own; `prefixKnowledge` makes them the plan's). */
export interface SectionKnowledge {
  /** The section's units (whole-document ids), in order. */
  units: UnitId[];
  ideas: Idea[];
  omitted: Omission[];
  /** What the reply's citations got wrong (`readDistilReply`), for the report. */
  problems: string[];
  /** Needs review flags besides accounting's own (uncited cards, the model check's verdicts). */
  flags: ReviewFlag[];
  hints: ReviewFlag[];
  reviews: Record<string, CardReview>;
  /**
   * Content the app put back from the source: exact items as "From the source" lines and omitted protected units (§3.3),
   * and the units whose dropped condition, caveat or requirement went on their card as a "Limit:" line (`restoreLimits`).
   */
  restored: { items: string[]; units: UnitId[]; limits?: UnitId[] };
  /**
   * The cards that span several nodes (a shape with its explanations, a label shape with the card covering its units:
   * `cardViews`), as node ids, the card's own first. Report v2 and G1 count cards, not nodes (plan §9 G1).
   */
  cards?: string[][];
  /** The one retry: what ran, and whether its reply was kept. */
  retry?: { kind: "patch" | "full"; kept: boolean };
  /** The model check, when it ran. */
  checked?: { cards: number; supported: number; partly: number; notSupported: number; unanswered: number };
  /** The section failed or was cut off: its units are `pending`. */
  pending?: true;
  /** Needs review items at the end (as `SectionInspection.needsReview`), to compare a regeneration with. */
  needsReview: number;
  /** Exact items still missing before they were restored (a regeneration that loses one is worse). */
  exactMissing: string[];
}

/** A section's knowledge with its node ids as the merged plan has them (`mergeUnitPlans`: `<prefix>u<i>_<id>`). */
export function prefixKnowledge(k: SectionKnowledge, prefix: string): SectionKnowledge {
  const id = (x: string) => `${prefix}${x}`;
  const flag = (f: ReviewFlag): ReviewFlag => (f.card ? { ...f, card: id(f.card) } : f);
  return {
    ...k,
    ideas: k.ideas.map((i) => ({ ...i, id: id(i.id) })),
    flags: k.flags.map(flag),
    hints: k.hints.map(flag),
    reviews: Object.fromEntries(Object.entries(k.reviews).map(([card, r]) => [id(card), r])),
    ...(k.cards ? { cards: k.cards.map((members) => members.map(id)) } : {}),
  };
}

/** Whether a regenerated section's knowledge is worse than the earlier one's (distil's "never worse", Wave A2). */
export function knowledgeIsWorse(next: SectionKnowledge, earlier: SectionKnowledge): boolean {
  if (next.pending && !earlier.pending) return true;
  const kept = new Set(earlier.exactMissing);
  if (next.exactMissing.some((k) => !kept.has(k))) return true;
  return next.needsReview > earlier.needsReview;
}

/** The keys `SectionKnowledge.exactMissing` stores. */
export const exactMissingKeys = (items: readonly ProtectedItem[]) => items.map(itemKey);
