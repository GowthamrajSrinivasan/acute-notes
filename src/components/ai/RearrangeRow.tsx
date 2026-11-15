"use client";

/**
 * The review row of a pending "Re-arrange layout" set (organisation-layout plan §3.4.3–3.4.4): what it left where the
 * user put it, whether it is worse than the canvas now, and the "Also move cards I placed" option, which re-plans the
 * same frames and proposes the result in place of this one (as Regenerate does).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { proposeRearrange, rearrangeReviewOf } from "./rearrangeAction";

export function RearrangeRow({ api, canvasId, set }: { api: ExcalidrawImperativeAPI; canvasId: string; set: ChangeSet }) {
  const review = rearrangeReviewOf(set.operationId);
  /** The option's new value while the re-plan runs (shown at once; the new proposal then carries it). */
  const [running, setRunning] = useState<boolean | null>(null);
  if (!review) return null;
  // The option is offered only when it changes something: cards were kept, or they are being moved now.
  const offer = review.kept > 0 || review.moveUserPlaced;
  if (!review.notes.length && !offer) return null;

  const toggle = async (moveUserPlaced: boolean) => {
    setRunning(moveUserPlaced);
    try {
      const outcome = await proposeRearrange(api, canvasId, review.sourceId, review.frames, moveUserPlaced);
      if (outcome === "no_source") api.setToast({ message: "The original content for this isn't on this device.", duration: 4000 });
      else if (outcome === "nothing") api.setToast({ message: "Nothing else would move.", duration: 3000 });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="acute-coverage acute-rearrange" aria-label="Re-arrange check">
      {review.notes.map((n) => (
        <span key={n} className="acute-review__note">
          {n}
        </span>
      ))}
      {offer && (
        <label className="acute-review__auto" title="Re-arrange the cards you moved by hand too, as if Acute had placed them">
          <input type="checkbox" checked={running ?? review.moveUserPlaced} disabled={running !== null} onChange={(e) => void toggle(e.target.checked)} />
          Also move cards I placed
        </label>
      )}
    </div>
  );
}
