/**
 * Frame splitting (organisation-layout plan §3.3, F6; organisation "v2" only). Distil mode writes more, smaller cards,
 * so a section can grow into a frame nobody can read whole. Such a frame is split **at render time**, along meaning
 * boundaries only, into parts drawn as frames of their own, side by side in packing order. The plan, the stored plan
 * and every reconciliation key stay as they are (§7 Q4): cards keep their ids and stable keys, part 1 keeps the
 * section's frame, title object and takeaway, and later parts add only layout objects (a frame and a title) with no
 * stable key, like the takeaway.
 *
 * | Rule | Value (§7 Q5) |
 * |---|---|
 * | Trigger | the section's frame is wider than 3,200 px or taller than 1,800 px (`FIT_SCREEN` at `READABLE_FIT_ZOOM`) |
 * | Never split | a diagram section, a section with a Lens `level`, a comparison section, fewer than 4 core members |
 * | Where | sub-groups, else sub-topics (≥ 2 headings), else link components; an explanation goes with its card |
 * | Parts | ≥ 2 core members each; no boundary → no split |
 * | Titles | "Section — sub-topic" (or the sub-group's label); "Section (2 of 3)" for link components |
 *
 * This module is the pure part: whether a section may split, its boundaries, and how they group into parts. The
 * layout (`layout.ts`) measures each part and draws it; `render.ts` turns each part into a frame.
 */
import { isDiagramGroup } from "@/ai/visual-plan/architectureFrame";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { FIT_SCREEN, READABLE_FIT_ZOOM } from "./screen";

/** A section needs at least this many core members (cards that aren't another card's explanation) to split. */
export const MIN_SPLIT_CORE = 4;
/** Every part keeps at least this many core members. */
export const MIN_PART_CORE = 2;
/** The largest frame that can still be read whole at the readable zoom on the fit screen (3,200 × 1,800). */
export const SPLIT_MAX = { width: FIT_SCREEN.width / READABLE_FIT_ZOOM, height: FIT_SCREEN.height / READABLE_FIT_ZOOM } as const;

/** Frame key of part `index` (1-based) of a split section; part 1 is the section's own frame (`groupId`). */
export const partFrameKey = (groupId: string, index: number) => (index === 1 ? groupId : `${groupId}::part${index}`);
/** Key of the continuation title drawn at the top of a later part (part 1 keeps the section's title object). */
export const partTitleKey = (groupId: string, index: number) => `${groupId}::part${index}::title`;
/** The keys a split adds to a layout: later parts' frames and their titles. */
export const isPartKey = (key: string) => /::part\d+(::title)?$/.test(key);

/** Separator between a section's title and the part's sub-topic. */
export const PART_TITLE_SEPARATOR = " — ";

export type SplitBoundary = "sub-groups" | "sub-topics" | "links";

/** One piece a section may be cut between: a sub-group, a sub-topic or a link component, with its explanations. */
export interface SplitUnit {
  /** Its core members (not another card's explanation), in the order they lay out. */
  core: VisualNode[];
  /** Its core members and their explanations. */
  members: VisualNode[];
  /** What it is about: the sub-topic's heading, the sub-group's label; none for a link component. */
  label?: string;
  /** Sub-topics: the topic's position among the section's sub-topics (its backdrop key's index). */
  topic?: number;
}

/** One part of a split section, as drawn: its frame, its title, and the keys of what it holds. */
export interface FramePart {
  /** 1-based. */
  index: number;
  /** Parts of the section. */
  count: number;
  /** The frame's change key: the section's own id for part 1, `partFrameKey` after. */
  key: string;
  /** The title object's key: the section's title for part 1, `partTitleKey` after. */
  titleKey: string;
  /** The title text: the section's label for part 1, "Section — sub-topic" or "Section (2 of 3)" after. */
  title: string;
  /** Every layout key inside the frame: its title, the takeaway (part 1), backdrops, sub-group titles and cards. */
  children: string[];
}

/** Whether a frame of this size can be read whole at the readable zoom on the fit screen. */
export function fitsScreen(size: { width: number; height: number }): boolean {
  return size.width <= SPLIT_MAX.width && size.height <= SPLIT_MAX.height;
}

/** A section that may never split, whatever its size: a diagram, a Lens level, a comparison (one table), or too few cards. */
export function splittable(plan: VisualPlan, group: VisualNode, coreCount: number): boolean {
  if (group.type !== "group") return false;
  if (coreCount < MIN_SPLIT_CORE) return false;
  if (isDiagramGroup(plan, group)) return false;
  if (group.content.level !== undefined) return false;
  if (group.role === "comparison" || group.content.arrangement === "compare") return false;
  return true;
}

/**
 * The section's link components, in plan order (each starts at its first member): core members joined by any
 * relationship among them, each with its explanations. A component is never cut.
 */
export function linkComponents(core: readonly VisualNode[], members: readonly VisualNode[], relationships: readonly VisualRelationship[], explanationOf: ReadonlyMap<string, string>): SplitUnit[] {
  const index = new Map(core.map((n, i) => [n.id, i] as const));
  const root = core.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  for (const r of relationships) {
    const a = index.get(r.from);
    const b = index.get(r.to);
    if (a === undefined || b === undefined || a === b) continue;
    const [x, y] = [find(a), find(b)];
    if (x !== y) root[Math.max(x, y)] = Math.min(x, y);
  }
  const byRoot = new Map<number, VisualNode[]>();
  core.forEach((n, i) => (byRoot.get(find(i)) ?? byRoot.set(find(i), []).get(find(i))!).push(n));
  const rootOf = (id: string) => {
    let at = id;
    for (let hops = 0; explanationOf.has(at) && hops < members.length; hops++) at = explanationOf.get(at)!;
    return at;
  };
  return [...byRoot.values()].map((list) => {
    const ids = new Set(list.map((n) => n.id));
    return { core: list, members: members.filter((n) => ids.has(n.id) || ids.has(rootOf(n.id))) };
  });
}

const coreCount = (part: readonly SplitUnit[]) => part.reduce((s, u) => s + u.core.length, 0);

/**
 * The section's units grouped into parts, in order. Sub-groups and sub-topics: one part each (a reader's own
 * headings are the boundaries). Link components: as many as fit the budget together (`fits`), so a section of many
 * small unlinked cards isn't cut into pairs. Then any part with fewer than `MIN_PART_CORE` core members joins its
 * smaller neighbour (the earlier one on a tie). One part back means: don't split.
 */
export function groupParts(units: readonly SplitUnit[], boundary: SplitBoundary, fits: (part: readonly SplitUnit[]) => boolean): SplitUnit[][] {
  let parts: SplitUnit[][] = [];
  if (boundary === "links") {
    for (const u of units) {
      const last = parts.at(-1);
      if (last && fits([...last, u])) last.push(u);
      else parts.push([u]);
    }
  } else parts = units.map((u) => [u]);
  for (;;) {
    const i = parts.findIndex((p) => coreCount(p) < MIN_PART_CORE);
    if (i < 0 || parts.length < 2) break;
    const before = i > 0 ? coreCount(parts[i - 1]!) : Number.POSITIVE_INFINITY;
    const after = i < parts.length - 1 ? coreCount(parts[i + 1]!) : Number.POSITIVE_INFINITY;
    const into = before <= after ? i - 1 : i + 1;
    const [lo, hi] = into < i ? [into, i] : [i, into];
    parts = [...parts.slice(0, lo), [...parts[lo]!, ...parts[hi]!], ...parts.slice(hi + 1)];
  }
  return parts;
}

/**
 * A part's title: the section's own label for part 1 (it keeps the section's title object), "Section — sub-topic"
 * after, naming the sub-topics or sub-groups it holds, or "Section (2 of 3)" when they have no name (link components).
 */
export function partTitle(sectionLabel: string, part: readonly SplitUnit[], index: number, count: number): string {
  if (index === 1) return sectionLabel;
  const names = part.flatMap((u) => (u.label?.trim() ? [u.label.trim()] : []));
  return names.length === part.length ? `${sectionLabel}${PART_TITLE_SEPARATOR}${names.join(", ")}` : `${sectionLabel} (${index} of ${count})`;
}
