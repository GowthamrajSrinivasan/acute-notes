/**
 * Whether a merge has any room left for new nodes: the real `foldOverflow` is asked, with the nodes the plan will certainly keep and one probe
 * node in a section of its own. A node is kept only while the plan holds fewer than `NODE_CAPS.sectionedPlan` content nodes (existing ones are
 * counted first, plain cards and frames never are), and that count only grows, so if the probe is folded then every node a merge adds, in any
 * section, is folded too (into a "More from this section" page). No counting rule is repeated here.
 *
 * Exact only for what it is given: `retained` must be nodes that will really be in the plan the merge validates (an unchanged section's nodes, or the
 * nodes of a section that only has paragraphs appended, which keep every node it has; unreadable charts are left out here, see below).
 * Fewer nodes than that is safe (it can only say "room left", so the model is asked as before); more is not. Any shape it does not understand
 * answers false, so the caller plans as before.
 *
 * `onCheck` receives what the check saw (diagnostics only: it changes nothing about the answer).
 */
import { foldOverflow } from "@/ai/visual-plan/repair";
import { templateFor } from "@/ai/visual-plan/templates";
import type { VisualNode } from "@/ai/visual-plan/types";
import { isUnreadableChart, NODE_CAPS, validateVisualPlan } from "@/ai/visual-plan/validate";

const PROBE_KEY = "(capacity probe) § probe";

export interface CapacityCheck {
  /** `folds`: the probe was folded, so no added node can be kept; `room`: it was kept; `unsupported`: not judged, the caller plans as before. */
  answer: "folds" | "room" | "unsupported";
  /** Why it was not judged (`unsupported` only). */
  reason?: string;
  /** The plan's content-node limit the probe was measured against. */
  cap: number;
  /** Nodes it was given, and how many of those it left out because validation may drop them (unreadable charts). */
  retained: number;
  unreadableCharts: number;
  /** What the real fold counted among the nodes it was given (the probe is not in it), and where the probe would stand: `counted` + 1. */
  counted?: number;
  projected?: number;
  probes: 1;
}

export function everyAddedNodeFolds(allRetained: readonly VisualNode[], existing: ReadonlySet<string>, onCheck?: (check: CapacityCheck) => void): boolean {
  // Validation drops an unreadable chart before it folds anything, as soon as the plan holds a table (which a merge may add), so such a node is not
  // certain to be there to be counted: leaving it out can only say "room left".
  const retained = allRetained.filter((n) => !isUnreadableChart(n));
  const base = { cap: NODE_CAPS.sectionedPlan, retained: allRetained.length, unreadableCharts: allRetained.length - retained.length, probes: 1 as const };
  const done = (check: Omit<CapacityCheck, "cap" | "retained" | "unreadableCharts" | "probes">): boolean => {
    onCheck?.({ ...base, ...check });
    return check.answer === "folds";
  };
  // Unsupported shapes: nothing retained to count, frames or parents in the plan (the probe would need a frame of its own), or a probe key that is real.
  if (!retained.length) return done({ answer: "unsupported", reason: "nothing retained to count" });
  if (retained.some((n) => n.type === "group" || n.parent)) return done({ answer: "unsupported", reason: "frames or nodes with a parent in the plan" });
  if (existing.has(PROBE_KEY)) return done({ answer: "unsupported", reason: "the probe's key is a real key" });
  const probe = { id: "capacity~probe", type: "text", stableKey: PROBE_KEY, content: { markdown: "." } } as VisualNode;
  try {
    const { folded, nodes, existingCounted } = foldOverflow([...retained, probe], templateFor("sectioned"), NODE_CAPS, existing);
    const folds = folded === 1 && !nodes.some((n) => n.id === probe.id);
    return done({ answer: folds ? "folds" : "room", counted: existingCounted, projected: existingCounted + 1 });
  } catch (err) {
    return done({ answer: "unsupported", reason: `the fold threw: ${err instanceof Error ? err.message : "error"}` });
  }
}

/**
 * The same question once the changed sections' replies are in: `planned` is every node the plan will hold so far (the unchanged sections' nodes and
 * what the replies returned), and it is asked of the real `validateVisualPlan`, which sanitises, repairs and then folds exactly as the merge's own
 * validation does (a node it drops or splits is dropped or split here too), with one probe node last, in a section of its own. Nodes the merge adds
 * afterwards come after these, so if the probe is folded they are folded too. Nothing is assumed for a section that has no reply: only the nodes
 * that exist are given. Same lower-bound rule as above for unreadable charts, and the same unsupported shapes answer false.
 */
export function planIsFull(planned: readonly unknown[], existing: ReadonlySet<string>, onCheck?: (check: CapacityCheck) => void): boolean {
  // An entry that is not an object is something validation salvages or drops: leaving it out can only say "room".
  const objects = planned.filter((n): n is VisualNode => !!n && typeof n === "object");
  const retained = objects.filter((n) => !isUnreadableChart(n));
  const base = { cap: NODE_CAPS.sectionedPlan, retained: planned.length, unreadableCharts: objects.length - retained.length, probes: 1 as const };
  const done = (check: Omit<CapacityCheck, "cap" | "retained" | "unreadableCharts" | "probes">): boolean => {
    onCheck?.({ ...base, ...check });
    return check.answer === "folds";
  };
  if (!retained.length) return done({ answer: "unsupported", reason: "nothing planned to count" });
  if (retained.some((n) => n.type === "group" || n.parent)) return done({ answer: "unsupported", reason: "frames or nodes with a parent in the plan" });
  if (existing.has(PROBE_KEY)) return done({ answer: "unsupported", reason: "the probe's key is a real key" });
  const probe = { id: "capacity~probe", type: "text", stableKey: PROBE_KEY, content: { markdown: "." } } as VisualNode;
  try {
    const validated = validateVisualPlan({ version: 1, template: "sectioned", nodes: [...retained, probe], relationships: [] }, { existing });
    const folds = !validated.plan.nodes.some((n) => n.id === probe.id) && validated.overflow.length > 0;
    return done({ answer: folds ? "folds" : "room", counted: validated.existingCounted, projected: validated.existingCounted + 1 });
  } catch (err) {
    return done({ answer: "unsupported", reason: `validation threw: ${err instanceof Error ? err.message : "error"}` });
  }
}
