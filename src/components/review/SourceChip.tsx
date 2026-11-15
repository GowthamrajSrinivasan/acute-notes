"use client";

/**
 * A card's source chip (knowledge-notes-plan §4.2, WP2.4; Lane H): "3 sources" in the card's corner, amber while the
 * card needs review, grey when the source isn't on this device. Clicking it opens the Source tab on those passages.
 *
 * Not positioned: the integrator places it in the renderer overlay beside the existing markers (one marker per
 * object, the indicator budget), as `SectionChips` places its chips. Pure wording in `chipView.ts`.
 */
import { sourceChipView, type SourceChipInput } from "./chipView";
import type { UnitId } from "@/ai/fidelity/contracts";
import "./review.css";

export interface SourceChipProps extends SourceChipInput {
  /** Opens the Source tab on these units. Absent: the chip is shown but not clickable. */
  onOpen?: (units: UnitId[]) => void;
}

export function SourceChip({ onOpen, ...input }: SourceChipProps) {
  const view = sourceChipView(input);
  if (!view) return null;
  return (
    <button
      type="button"
      className={`acute-kn-chip acute-kn-chip--${view.tone}`}
      aria-label={view.label}
      title={view.label}
      disabled={!onOpen}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onOpen?.(view.units)}
    >
      <span className="acute-kn-chip__dot" aria-hidden="true" />
      {view.text}
    </button>
  );
}
