"use client";

/**
 * Panel sections for selections that aren't text (F11): an arrow's optional
 * semantic relationship (F23), a page preview's display mode, and interactive
 * diagram fields (frame switch, node kind and details, arrow explanation).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { createPortal } from "react-dom";
import { togglePagePreview } from "@/components/canvas/pagePreviews";
import { setArrowRelation } from "@/components/canvas/relations";
import { RELATION_TYPES, type RelationType } from "@/domain/types";
import { pagePanel } from "@/state/pagePanel";
import { DiagramEdgeField, DiagramPanelSection } from "@/components/diagram/DiagramPanelSection";
import { usePanelSlot } from "./panelSlot";
import { useSelectedObject } from "./selectedBlockStore";

const RELATION_LABELS: Record<RelationType, string> = {
  relates_to: "Relates to",
  flows_to: "Flows to",
  caused_by: "Caused by",
  depends_on: "Depends on",
  supports: "Supports",
  blocks: "Blocks",
  implements: "Implements",
  derived_from: "Derived from",
  references: "References",
  explained_by: "Explained by",
  supersedes: "Supersedes",
  deviates_from: "Deviates from",
  option_of: "Option",
  calls: "Calls",
  reads: "Reads",
  writes: "Writes",
  publishes: "Publishes",
  subscribes: "Subscribes",
  contains: "Contains",
};

export function ObjectSection({ api }: { api: ExcalidrawImperativeAPI }) {
  const selected = useSelectedObject();
  const slot = usePanelSlot("acute-object-slot");
  if (!selected) return null;

  if (selected.kind === "frame" || selected.kind === "diagram-node") {
    return createPortal(<DiagramPanelSection api={api} selected={selected} />, slot);
  }

  if (selected.kind === "arrow") {
    return createPortal(
      <fieldset className="acute-text-section">
        <legend>Relationship</legend>
        {selected.connected ? (
          <select
            className="acute-text-section__font"
            aria-label="Relationship"
            title="What this connection means (for search and AI); the arrow looks the same"
            value={selected.relation ?? ""}
            onChange={(e) => setArrowRelation(api, selected.elementId, (e.target.value || null) as RelationType | null)}
          >
            <option value="">None</option>
            {RELATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {RELATION_LABELS[type]}
              </option>
            ))}
          </select>
        ) : (
          <p className="acute-text-section__hint">Connect both ends to objects to give this arrow a meaning.</p>
        )}
        {selected.diagram && <DiagramEdgeField api={api} arrowId={selected.elementId} explanation={selected.diagram.explanation ?? ""} />}
      </fieldset>,
      slot,
    );
  }

  return createPortal(
    <fieldset className="acute-text-section">
      <legend>Page</legend>
      <div className="buttonList acute-text-section__wide">
        {([false, true] as const).map((preview) => (
          <label key={String(preview)} className={selected.preview === preview ? "active" : ""}>
            <input
              type="radio"
              name="acute-page-display"
              checked={selected.preview === preview}
              onChange={() => togglePagePreview(api, selected.elementId)}
            />
            <span className="acute-text-section__glyph">{preview ? "Preview" : "Card"}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="acute-text-section__convert"
        onClick={() => pagePanel.open(selected.pageId, { elementId: selected.elementId })}
      >
        Open page
      </button>
    </fieldset>,
    slot,
  );
}
