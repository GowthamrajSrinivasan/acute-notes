/**
 * How a connector's relation type looks on the canvas (content fidelity plan, Wave C: signaling). Every relation
 * was drawn as the same solid arrow, with its type only in Properties; now the kind is visible on the arrow itself
 * — no separate legend to look up (a legend adds the split-attention cost the research warns about):
 *
 * - `flows_to` — solid arrow: the order of a sequence.
 * - `depends_on`, `derived_from` — dashed arrow: needs / comes from, not "happens next".
 * - `blocks` — solid, ending in a bar: a stop.
 * - `caused_by` — solid, triangle head, labelled "caused by" when it has no label of its own.
 * - `supports`, `implements` — solid, open-triangle head.
 * - `explained_by` — dotted, a dot at the detail: "more about this", the quietest link.
 * - `references` — dotted arrow.
 * - `supersedes` — solid, triangle head, labelled "supersedes": a later decision replacing an earlier one.
 * - `deviates_from` — dashed, open-triangle head, labelled "deviates from": a documented exception.
 * - `option_of` — dotted, no head: a "Needs your call" box to one of its options (G3), until the user chooses.
 * - `calls` — solid arrow, labelled "calls"; `reads` / `writes` — dashed / solid arrow to the store, labelled so;
 *   `publishes` / `subscribes` — dashed arrow, labelled so; `contains` — solid, a dot at the part (plan D9).
 * - `relates_to` (and anything unknown) — solid line, no head: an association without direction.
 *
 * Pure: a look-up table. Colour is left alone — colour carries no meaning here (product rule: never decoration).
 */
import type { RelationType } from "@/domain/types";

type Head = "arrow" | "bar" | "dot" | "triangle" | "triangle_outline";

export interface RelationStyle {
  strokeStyle: "solid" | "dashed" | "dotted";
  endArrowhead: Head | null;
  /** Shown on the arrow when the connector has no label of its own. */
  defaultLabel?: string;
}

const STYLES: Readonly<Record<RelationType, RelationStyle>> = {
  flows_to: { strokeStyle: "solid", endArrowhead: "arrow" },
  depends_on: { strokeStyle: "dashed", endArrowhead: "arrow" },
  derived_from: { strokeStyle: "dashed", endArrowhead: "arrow" },
  blocks: { strokeStyle: "solid", endArrowhead: "bar" },
  caused_by: { strokeStyle: "solid", endArrowhead: "triangle", defaultLabel: "caused by" },
  supports: { strokeStyle: "solid", endArrowhead: "triangle_outline" },
  implements: { strokeStyle: "solid", endArrowhead: "triangle_outline" },
  explained_by: { strokeStyle: "dotted", endArrowhead: "dot" },
  references: { strokeStyle: "dotted", endArrowhead: "arrow" },
  supersedes: { strokeStyle: "solid", endArrowhead: "triangle", defaultLabel: "supersedes" },
  deviates_from: { strokeStyle: "dashed", endArrowhead: "triangle_outline", defaultLabel: "deviates from" },
  option_of: { strokeStyle: "dotted", endArrowhead: null },
  calls: { strokeStyle: "solid", endArrowhead: "arrow", defaultLabel: "calls" },
  reads: { strokeStyle: "dashed", endArrowhead: "arrow", defaultLabel: "reads" },
  writes: { strokeStyle: "solid", endArrowhead: "arrow", defaultLabel: "writes" },
  publishes: { strokeStyle: "dashed", endArrowhead: "triangle", defaultLabel: "publishes" },
  subscribes: { strokeStyle: "dashed", endArrowhead: "triangle_outline", defaultLabel: "subscribes" },
  contains: { strokeStyle: "solid", endArrowhead: "dot" },
  relates_to: { strokeStyle: "solid", endArrowhead: null },
};

/** The look of a connector of `relation`; a connector with no relation keeps the plain arrow it always had. */
export function relationStyle(relation: RelationType | undefined): RelationStyle {
  return relation ? (STYLES[relation] ?? STYLES.relates_to) : { strokeStyle: "solid", endArrowhead: "arrow" };
}
