/**
 * The propagation rule of Agent Sync (Lens plan §8.1 rule 4): a source change can affect every level above the card
 * that cites it. A section's `parent` is a card in another section, one level up; walking those links from a stale
 * key gives its ancestors (L4 → L3 → L2 → L1). Keys only: the agent re-reads them and re-sends what changed in
 * meaning — Acute never rewrites an ancestor on its own guess.
 */

/** What the walk needs of a map's sections: each one's cards and its parent card. */
export type SectionLinks = Readonly<Record<string, { parent?: string; nodes: Readonly<Record<string, unknown>> }>>;

/**
 * The ancestors of `keys` (card or section keys), nearest first, each once, leaving out the given keys themselves.
 * A key no section owns has none; a parent chain that loops stops where it repeats.
 */
export function affectedAncestors(sections: SectionLinks, keys: readonly string[]): string[] {
  const owner = new Map<string, string>();
  for (const [sk, s] of Object.entries(sections)) {
    owner.set(sk, sk);
    for (const nk of Object.keys(s.nodes)) if (!owner.has(nk)) owner.set(nk, sk);
  }
  const given = new Set(keys);
  const seen = new Set<string>();
  const out: string[] = [];
  // Breadth first over all given keys, so every key's parent comes before any grandparent.
  let frontier = [...given];
  while (frontier.length) {
    const next: string[] = [];
    for (const k of frontier) {
      const section = owner.get(k);
      const parent = section ? sections[section]?.parent : undefined;
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);
      if (!given.has(parent)) out.push(parent);
      next.push(parent);
    }
    frontier = next;
  }
  return out;
}
