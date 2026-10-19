/**
 * Sections in "Update from new content" (F42 Phase 3). Plans are reconciled
 * flat — each section as its title heading (`ungroup`) — so which section a
 * node belongs to is recovered here: from the grouped plan's `parent` links on
 * the local tier, or, on the AI tier (whose section titles are flat headings
 * keyed `<section> § group#0`), from the section key every member's
 * `stableKey` is namespaced by. An explanation belongs to its concept's
 * section. Placement uses it to put new objects into their section's frame,
 * and to frame a new section as a whole.
 */
import { explanationParents } from "@/ai/renderer/layout";
import { UNIT_SECTION_SUFFIX } from "@/ai/visual-plan/groups";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { unitOfKey } from "./keys";

/**
 * Node id → the id of its section's title node in `flat` (sections whose title
 * isn't in `flat` are left out). `grouped` is the plan before `ungroup`, when
 * there is one with real groups.
 */
export function sectionOfNode(flat: VisualPlan, grouped: VisualPlan | null): Map<string, string> {
  const ids = new Set(flat.nodes.map((n) => n.id));
  const direct = new Map<string, string>();
  if (grouped?.nodes.some((n) => n.type === "group")) {
    const groups = new Set(grouped.nodes.flatMap((n) => (n.type === "group" && ids.has(n.id) ? [n.id] : [])));
    for (const n of grouped.nodes) if (n.parent && groups.has(n.parent) && ids.has(n.id)) direct.set(n.id, n.parent);
  } else {
    const titleOfUnit = new Map(
      flat.nodes.flatMap((n) => (n.type === "heading" && n.stableKey?.endsWith(UNIT_SECTION_SUFFIX) ? [[unitOfKey(n.stableKey) ?? "", n.id] as const] : [])),
    );
    for (const n of flat.nodes) {
      const title = n.stableKey ? titleOfUnit.get(unitOfKey(n.stableKey) ?? "") : undefined;
      if (title && title !== n.id) direct.set(n.id, title);
    }
  }
  // An explanation (and its own explanations) is in its concept's section.
  const parents = explanationParents(flat);
  const out = new Map<string, string>();
  for (const n of flat.nodes) {
    let at = n.id;
    for (let hops = 0; !direct.has(at) && parents.has(at) && hops < flat.nodes.length; hops++) at = parents.get(at)!;
    const section = direct.get(at);
    if (section && section !== n.id) out.set(n.id, section);
  }
  return out;
}
