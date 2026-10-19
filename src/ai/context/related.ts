/**
 * "Find related items" (F18) — deterministic and local, like F22's MVP
 * search tier: no model call. Ranks the scope's other objects by direct
 * connections to the selection plus shared distinctive terms (weighted so
 * words that appear everywhere count for little).
 */
import type { ContextItem, SelectionContext } from "./selectionContext";

export interface RelatedMatch {
  item: ContextItem;
  score: number;
  connected: boolean;
  /** Shared terms, most distinctive first. */
  terms: string[];
}

const STOP_WORDS = new Set(
  "about above after again against because been before being below between both could does doing down during each from further have having here into itself just more most much must once only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your yours also".split(
    " ",
  ),
);

const CONNECTION_WEIGHT = 3;
const MAX_TERMS = 4;

export function termsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{3,}/gu) ?? []) {
    if (!STOP_WORDS.has(word)) out.add(word);
  }
  return out;
}

const fullText = (item: ContextItem) => (item.title ? `${item.title}\n${item.text}` : item.text);

/** Related objects for the context's selection, best first. `ctx` should be a canvas- or workspace-scope context. */
export function findRelated(ctx: SelectionContext, limit = 8): RelatedMatch[] {
  const selected = new Set(ctx.selectedObjectIds);
  const sources = ctx.items.filter((i) => selected.has(i.id));
  const candidates = ctx.items.filter((i) => !selected.has(i.id));
  if (!sources.length || !candidates.length) return [];

  const query = new Set<string>();
  for (const s of sources) for (const t of termsOf(fullText(s))) query.add(t);

  const candidateTerms = new Map(candidates.map((c) => [c.id, termsOf(fullText(c))]));
  const documentFrequency = new Map<string, number>();
  for (const terms of candidateTerms.values()) {
    for (const t of terms) if (query.has(t)) documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1);
  }
  const weight = (t: string) => Math.log(1 + candidates.length / (documentFrequency.get(t) ?? 1));

  const connected = new Set(
    ctx.relations.flatMap((r) => (selected.has(r.from) ? [r.to] : selected.has(r.to) ? [r.from] : [])),
  );

  const matches: RelatedMatch[] = [];
  for (const item of candidates) {
    const shared = [...candidateTerms.get(item.id)!].filter((t) => query.has(t)).sort((a, b) => weight(b) - weight(a));
    const isConnected = connected.has(item.id);
    const score = (isConnected ? CONNECTION_WEIGHT : 0) + shared.reduce((sum, t) => sum + weight(t), 0);
    if (score > 0) matches.push({ item, score, connected: isConnected, terms: shared.slice(0, MAX_TERMS) });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}
