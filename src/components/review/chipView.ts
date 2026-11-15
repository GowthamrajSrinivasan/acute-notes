/**
 * What a card's source chip says (knowledge-notes-plan §4.2, §5.1, WP2.4; Lane H): "3 sources" in the card's corner,
 * amber while the card needs review, grey when its source isn't on this device. Pure; `SourceChip.tsx` draws it.
 */
import type { CardReview, UnitId } from "@/ai/fidelity/contracts";
import { isOpenReview } from "./wording";

export type SourceChipTone = "ok" | "review" | "unavailable";

export interface SourceChipView {
  /** Visible text: "1 source", "3 sources". */
  text: string;
  /** For screen readers and the tooltip. */
  label: string;
  tone: SourceChipTone;
  /** The units to open the Source tab on (cited order, without repeats). */
  units: UnitId[];
}

export interface SourceChipInput {
  cites: readonly UnitId[];
  review?: CardReview;
  /** False when the card's source isn't stored here (an import without sources): the chip stays, in grey. */
  available?: boolean;
}

/**
 * Null for a card that cites nothing: no chip — unless it needs review (a card citing no passage is flagged for exactly
 * that): then an amber "No source" chip, so what is uncertain stays visible (U8, integrator 2026-10-19).
 */
export function sourceChipView({ cites, review, available = true }: SourceChipInput): SourceChipView | null {
  const units = [...new Set(cites)];
  if (!units.length) {
    if (!isOpenReview(review)) return null;
    return { text: "No source", units, tone: available ? "review" : "unavailable", label: `No source cited, needs review: ${review!.reasons[0]!}. Open the source` };
  }
  const n = units.length;
  const text = `${n} ${n === 1 ? "source" : "sources"}`;
  if (!available) return { text, units, tone: "unavailable", label: `${text}: source not on this device` };
  if (isOpenReview(review)) {
    const first = review!.reasons[0]!;
    const more = review!.reasons.length - 1;
    return { text, units, tone: "review", label: `${text}, needs review: ${first}${more ? ` (+${more} more)` : ""}. Open the source` };
  }
  return { text, units, tone: "ok", label: `${text}. Open the source` };
}
