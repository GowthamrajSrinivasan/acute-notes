/**
 * The pure rules behind the project-knowledge commands (plan D33, D34): what "Promote" does to a node in its current
 * state, and what choosing an option changes. The canvas commands (`components/canvas/projectNodes.ts`) apply the
 * result; the panel and the Lens inspector read it to label and disable their buttons, so all three agree.
 */
import type { NodeKind } from "./diagram";
import { PROGRESS_STATUSES, type NodeProject, type ProgressStatus, type ProjectKind } from "./nodeProject";

export interface Promotion {
  /** The button's label: "Mark validated", "Promote to decision", "Accept decision". */
  label: string;
  /** The kind after promotion, when it changes (finding → decision). */
  kind?: NodeKind;
  /** The project fields after promotion (merged over the node's own, validated by the writer). */
  patch: NodeProject;
  /** Why the button is disabled, when it is. */
  blocked?: string;
}

/**
 * The next promotion step for a node, or null when it has none (D33): finding ephemeral → validated → decision;
 * decision proposed → accepted (needs a chosen option when it has options). Promotion edits the same node, so it
 * keeps its key and refs; it is never a copy.
 */
export function nextPromotion(kind: ProjectKind | undefined, project: NodeProject | undefined): Promotion | null {
  const p = project ?? {};
  if (kind === "finding") {
    return p.stage === "validated"
      ? { label: "Promote to decision", kind: "decision", patch: { status: "proposed" } }
      : { label: "Mark validated", patch: { stage: "validated" } };
  }
  if (kind === "decision" && (p.status ?? "proposed") === "proposed") {
    const open = !!p.options?.length && !p.chosen;
    return { label: "Accept decision", patch: { status: "accepted" }, ...(open ? { blocked: "Choose an option first" } : {}) };
  }
  return null;
}

/**
 * The fields choosing `label` sets on a decision (D34): the option becomes `chosen` and a proposed decision is
 * accepted; `null` reopens it (no choice, back to proposed). Returns null when `label` isn't one of its options.
 */
export function chooseOptionPatch(project: NodeProject | undefined, label: string | null): NodeProject | null {
  if (label === null) return { chosen: undefined, status: "proposed" };
  if (!project?.options?.some((o) => o.label === label)) return null;
  return { chosen: label, status: project.status === "superseded" ? "superseded" : "accepted" };
}

/** The progress statuses in the order a user steps through them, for a status select. */
export const PROGRESS_STATUS_ORDER: readonly ProgressStatus[] = PROGRESS_STATUSES;

/** Adds `key` to `refs` (deduplicated, in order), or returns `refs` unchanged when it is already there or `key` is blank. */
export function withRef(refs: readonly string[] | undefined, key: string): string[] {
  const k = key.trim();
  const list = [...(refs ?? [])];
  return k && !list.includes(k) ? [...list, k] : list;
}

export function withoutRef(refs: readonly string[] | undefined, key: string): string[] {
  return (refs ?? []).filter((r) => r !== key);
}

/** A node key unique among `taken`: `base`, else `base-2`, `base-3`, … (an ambiguous key would not resolve, D53). */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
