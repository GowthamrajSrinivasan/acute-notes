/**
 * The append-only guard for merges (topic merge plan G2): a merge only ever *adds* text to the notes, so the plan it
 * proposes may add and extend, never take away or restate. A model regenerating a grown section sometimes rebuilds
 * it instead — dropping objects, or redrawing what is already there under new keys — which would deviate from the
 * structure the user already has. Applied deterministically to the new plan before it is compared with the canvas:
 *
 * - every node of the previous plan the new one dropped is kept as it was (with its links), so nothing is removed;
 * - a new node that only restates its section's existing nodes (nearly all of its significant words already there)
 *   is left out, with its links; a node carrying the new content keeps it, so it stays.
 *
 * Updates of existing nodes are left alone: that is how a section takes in the new passage.
 */
import { coverageOf, nodeStrings, significant } from "@/ai/fidelity/information";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { unitOfKey } from "./keys";

/** A new node whose words its section already holds to this share is a restatement. */
const RESTATED = 0.85;
const MIN_WORDS = 3;

export function appendOnly(plan: VisualPlan, previous: VisualPlan): VisualPlan {
  const keys = new Set(plan.nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
  const previousKeys = new Set(previous.nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
  const restored = previous.nodes.filter((n) => n.stableKey && !keys.has(n.stableKey));

  // What each section already says, by the namespace its nodes' keys share.
  const said = new Map<string, Set<string>>();
  for (const n of previous.nodes) {
    const section = n.stableKey ? unitOfKey(n.stableKey) : null;
    if (!section) continue;
    const words = said.get(section) ?? new Set<string>();
    for (const w of significant(nodeStrings(n).join(" "))) words.add(w);
    said.set(section, words);
  }
  const restates = (n: VisualNode) => {
    if (!n.stableKey || previousKeys.has(n.stableKey) || n.type === "heading") return false;
    const words = said.get(unitOfKey(n.stableKey) ?? "");
    const text = nodeStrings(n).join(" ");
    return !!words && new Set(significant(text)).size >= MIN_WORDS && coverageOf(text, words) >= RESTATED;
  };
  const dropped = new Set(plan.nodes.filter(restates).map((n) => n.id));

  const nodes = [...plan.nodes.filter((n) => !dropped.has(n.id)), ...restored];
  const ids = new Set(nodes.map((n) => n.id));
  const pair = (r: { from: string; to: string }) => `${r.from}>${r.to}`;
  const kept = plan.relationships.filter((r) => ids.has(r.from) && ids.has(r.to));
  const have = new Set(kept.map(pair));
  const restoredLinks = previous.relationships.filter((r) => ids.has(r.from) && ids.has(r.to) && !have.has(pair(r)));
  return { ...plan, nodes, relationships: [...kept, ...restoredLinks] };
}
