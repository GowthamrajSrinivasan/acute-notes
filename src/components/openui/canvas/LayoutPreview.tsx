"use client";

/**
 * The review's layout preview (note-taking-modes plan, after Step 7): a proposed card layout drawn before Accept, beside
 * the card's layout now. Lets the user see what they accept — an `update_block` that only changes a layout otherwise reads
 * "no visible text change". Display only; loaded only when a review has a layout to show, so OpenUI stays out of the main
 * bundle otherwise. A Lang that fails the structure check, or doesn't draw, says so instead of drawing.
 *
 * Wording follows D3: the canvas checks a layout's structure, not its meaning — the user is the one confirming it.
 */
import type { OpenUIError } from "@openuidev/react-lang";
import { useState } from "react";
import { checkLayoutStructure } from "@/ai/openui/layoutCheck";
import { OpenUiCardRenderer } from "@/components/openui/OpenUiCardRenderer";
import "../interactions.css";
import "../notes/notes.css";

export interface LayoutPreviewProps {
  /** The layout the card has now (null: none — it is drawn from its text); undefined for a new card. */
  current?: string | null;
  /** The proposed layout (null: the layout is removed). */
  proposed: string | null;
  name: string;
}

function Drawn({ lang, empty }: { lang: string | null; empty: string }) {
  const [failed, setFailed] = useState(false);
  if (!lang) return <p className="acute-layout-preview__empty">{empty}</p>;
  if (failed || !checkLayoutStructure(lang).ok) return <p className="acute-layout-preview__empty">This layout doesn&apos;t draw; the card would be drawn from its text.</p>;
  return (
    <div className="acute-layout-preview__card">
      <OpenUiCardRenderer response={lang} onError={(errors: OpenUIError[]) => errors.length && setFailed(true)} />
    </div>
  );
}

export default function LayoutPreview({ current, proposed, name }: LayoutPreviewProps) {
  return (
    <div className="acute-layout-preview" aria-label={`Layout preview: ${name}`} data-testid="acute-layout-preview">
      <div className="acute-layout-preview__panes">
        {current !== undefined && (
          <figure className="acute-layout-preview__pane" data-pane="now">
            <figcaption>Now</figcaption>
            <Drawn lang={current} empty="No layout: drawn from its text." />
          </figure>
        )}
        <figure className="acute-layout-preview__pane" data-pane="proposed">
          <figcaption>Proposed</figcaption>
          <Drawn lang={proposed} empty="No layout: drawn from its text." />
        </figure>
      </div>
      <p className="acute-layout-preview__hint">The canvas checked this layout&apos;s structure, not its meaning: check it says what the card says before you accept.</p>
    </div>
  );
}
