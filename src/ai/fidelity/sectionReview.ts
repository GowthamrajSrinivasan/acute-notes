/**
 * What the review says about each section, at the section (content fidelity plan, Wave C: review reasons next to
 * the change they are about, not in a bar the eye has to go back and forth to). One chip per section frame of a
 * Visualize proposal: whether AI analysed it, how much of its source the AI placed itself, what was added from the
 * source, and the one action that fits (Retry a section that fell back, Regenerate one that fell short).
 *
 * Pure: from the change set alone (its frames, `fidelity` and `analysis`); the chip component draws it.
 */
import type { Box, ChangeSet } from "@/ai/changes/changeSet";
import { percent, sectionsToRegenerate } from "./report";

export type SectionTone = "warning" | "note" | "ok";

export interface SectionReview {
  /** The frame's key in the change set (where the chip sits). */
  frameKey: string;
  box: Box;
  label: string;
  tone: SectionTone;
  /** The chip's text, short. */
  text: string;
  /** More, for the chip's tooltip: added points, missed key terms, the failure's cause. */
  detail: string[];
  /** The fitting action on the section, by its section key. */
  action?: { label: "Retry" | "Regenerate"; key: string };
}

const MAX_DETAIL = 3;

/**
 * One review per section frame of `set` (frames carrying `overview`, i.e. Visualize sections), matched to the
 * section's coverage and analysis by its label. `regenerated`: sections already regenerated once (not offered again).
 */
export function sectionReviews(set: ChangeSet, options: { canRegenerate: boolean; regenerated?: ReadonlySet<string> } = { canRegenerate: false }): SectionReview[] {
  const frames = set.changes.flatMap((c) => (c.kind === "create_frame" && c.overview ? [c] : []));
  if (!frames.length) return [];
  const coverage = new Map((set.fidelity?.sections ?? []).map((s) => [s.label, s] as const));
  const fallbacks = new Map((set.analysis?.fallbacks ?? []).map((f) => [f.label, f] as const));
  const shallow = new Set(set.analysis?.shallow ?? []);
  const short = new Set(set.fidelity ? sectionsToRegenerate(set.fidelity).map((s) => s.key) : []);
  const done = options.regenerated ?? new Set<string>();
  return frames.flatMap((f): SectionReview[] => {
    const label = f.overview!.title;
    const base = { frameKey: f.key, box: f.box, label };
    const fallback = fallbacks.get(label);
    if (fallback) {
      return [
        {
          ...base,
          tone: "warning",
          text: "Structure only: AI couldn't analyse it",
          detail: [`Why: ${fallback.cause}`],
          ...(options.canRegenerate ? { action: { label: "Retry" as const, key: fallback.key } } : {}),
        },
      ];
    }
    const c = coverage.get(label);
    if (!c && !shallow.has(label)) return [];
    const parts: string[] = [];
    const detail: string[] = [];
    if (shallow.has(label)) parts.push("Not analysed");
    if (c) {
      parts.push(`AI placed ${percent(c.placedByAI, c.units)}%`);
      if (c.addedFromSource) parts.push(`+${c.addedFromSource} from source`);
      if (c.keyTerms.missing.length) parts.push(`${c.keyTerms.missing.length} key ${c.keyTerms.missing.length === 1 ? "term" : "terms"} missed`);
      for (const a of c.added.slice(0, MAX_DETAIL)) detail.push(`Added from the source: ${a.length > 120 ? `${a.slice(0, 119)}…` : a}`);
      if (c.added.length > MAX_DETAIL) detail.push(`+${c.added.length - MAX_DETAIL} more added from the source`);
      if (c.keyTerms.missing.length) detail.push(`Key terms the AI missed: ${c.keyTerms.missing.slice(0, 8).join(", ")}${c.keyTerms.missing.length > 8 ? ", …" : ""}`);
    }
    const offer = !!c && options.canRegenerate && short.has(c.key) && !done.has(c.key);
    const tone: SectionTone = shallow.has(label) ? "warning" : c && (c.addedFromSource || c.keyTerms.missing.length) ? "note" : "ok";
    return [{ ...base, tone, text: parts.join(" · "), detail, ...(offer ? { action: { label: "Regenerate" as const, key: c!.key } } : {}) }];
  });
}
