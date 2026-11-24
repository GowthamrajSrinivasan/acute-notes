/**
 * A distil run's knowledge with its flow sections collapsed into cards (note-taking-modes plan Step 6, `flowCards.ts`): the
 * ideas placed on a step or its explanation move to the step's card, so its citations and reviews are the card's — none is
 * lost — and the card's FlowDiagram shows those citations as chips.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { SectionKnowledge } from "@/ai/fidelity/knowledgeCheck";
import { flowLang, flowOfContent } from "@/ai/openui/flowLayout";
import type { VisualNode } from "@/ai/visual-plan/types";
import { CARD_LAYOUT_LANG_MAX } from "@/domain/types";

/** The sections with every idea (and its review and flags) on a collapsed node moved to that node's card. */
export function withRenamedIdeas<S extends SectionKnowledge>(sections: readonly S[], rename: ReadonlyMap<string, string>): S[] {
  if (!rename.size) return [...sections];
  const to = (id: string) => rename.get(id) ?? id;
  const flag = <F extends { card?: string }>(f: F): F => (f.card !== undefined ? { ...f, card: to(f.card) } : f);
  return sections.map((s) => {
    const reviews: SectionKnowledge["reviews"] = {};
    for (const [id, review] of Object.entries(s.reviews)) {
      const had = reviews[to(id)];
      reviews[to(id)] = had ? { ...had, reasons: [...new Set([...had.reasons, ...review.reasons])] } : review;
    }
    return { ...s, ideas: s.ideas.map((i) => ({ ...i, id: to(i.id) })), reviews, flags: s.flags.map(flag), hints: s.hints.map(flag) };
  });
}

/** Each flow card's FlowDiagram with the units the card now cites (the run's citations, by node id), as chips. */
export function withFlowCitations(changeSet: ChangeSet, cards: readonly VisualNode[], cites: Readonly<Record<string, readonly string[]>>): void {
  const ids = new Set(cards.map((c) => c.id));
  for (const change of changeSet.changes) {
    if (change.kind !== "create_block" || !change.layout || !ids.has(change.key) || !cites[change.key]?.length) continue;
    const flow = flowOfContent({ title: "Untitled", snapshot: change.content });
    const lang = flow ? flowLang(flow, cites[change.key]!) : null;
    if (lang && lang.length <= CARD_LAYOUT_LANG_MAX) change.layout = { lang };
  }
}
