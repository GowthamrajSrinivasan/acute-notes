"use client";

/**
 * Where the selected object came from (F25): one compact properties-panel
 * section with its origin ("Created by AI · Summarize · GitHub Copilot ·
 * gpt-5") and three actions:
 *
 * - View context: the saved conversation that produced it (AI panel).
 * - View changes: selects everything the same AI operation created.
 * - Undo: reverts the operation when its step is still the latest one; later,
 *   "Remove" deletes what it created, as one new undoable step.
 *
 * Shown only when the object has non-user provenance. Displaying it is the
 * one thing provenance is for: nothing here changes how the object behaves.
 *
 * For one object made from a content source (F37), two reconciliation
 * controls (F39), each a deliberate user action: "Don't update this from AI"
 * (the opt-out; "Allow AI updates" reverses it) and, when the object maps back
 * to a span of the source, "Update source from this edit".
 */
import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getDescriptor } from "@/ai/connections";
import { getOperationLog } from "@/ai/changes/operations";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import { aiPanel, useAIMode } from "@/components/ai/askAI";
import type { SceneElement } from "@/domain/canvas/adapter";
import { describeProvenance, objectsFromOperation, provenanceOf } from "@/domain/provenance";
import type { DocumentHome } from "@/domain/types";
import type { CanvasHistory } from "@/history/canvasHistory";
import { choiceOptionOf, reconcileStatus, setExcludedFromReconciliation, sourceEditTarget, textWithOptionChosen, updateSourceFromEdit } from "@/components/canvas/reconcileActions";
import { visualizeDialog } from "@/components/ai/visualizeStore";
import { getDocumentStore } from "@/state/documents";
import { usePanelSlot } from "./panelSlot";
import { useSelection } from "./selectedBlockStore";
import { prefersReducedMotion } from "@/components/canvas/motion";

type History = Pick<CanvasHistory<ExcalidrawElement>, "record" | "undo" | "subscribe" | "lastStepId">;

const getDocument = (id: string) => getDocumentStore().get(id);

export function ProvenanceSection({ api, home, history }: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: History }) {
  const selection = useSelection();
  const slot = usePanelSlot("acute-provenance-slot");
  const mode = useAIMode();
  const lastStepId = useSyncExternalStore(
    (l) => history.subscribe(l),
    () => history.lastStepId,
    () => null,
  );

  // Bumped after a reconciliation control writes metadata, so the section re-reads it.
  const [revision, setRevision] = useState(0);
  const info = useMemo(() => {
    void revision;
    const ids = Object.keys(selection);
    const elements = api.getSceneElements() as unknown as readonly SceneElement[];
    const selected = elements.filter((el) => ids.includes(el.id) && !(el.type === "text" && el.containerId));
    if (!selected.length) return null;
    const described = describeProvenance(provenanceOf(selected[0]!, getDocument), (id) => getDescriptor(id)?.name);
    if (!described) return null;
    const operationId = described.operationId;
    const members = operationId ? objectsFromOperation(elements, operationId, getDocument) : [];
    // Several selected objects: only when they all come from the same operation.
    if (selected.length > 1 && (!operationId || !selected.every((el) => members.includes(el.id)))) return null;
    const single = selected.length === 1 ? selected[0]!.id : null;
    return { ...described, operationId, members, single, reconcile: single ? reconcileStatus(api, single) : null, option: single ? choiceOptionOf(api, single) : null };
  }, [api, selection, revision]);

  // "Update source from this edit" applies only to a local-tier node with a known source span.
  const single = info?.reconcile ? info.single : null;
  const [editable, setEditable] = useState<{ id: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!single) return;
    let live = true;
    void sourceEditTarget(api, single).then((t) => live && setEditable({ id: single, ok: !!t }), () => live && setEditable({ id: single, ok: false }));
    return () => {
      live = false;
    };
  }, [api, single, revision]);
  const canEditSource = !!single && editable?.id === single && editable.ok;

  if (!info) return null;
  const accepted = info.operationId ? getOperationLog().find(home.canvasId, info.operationId) : undefined;
  const canUndo = !!accepted && accepted.stepId === lastStepId;

  const viewChanges = () => {
    const els = api.getSceneElements().filter((el) => info.members.includes(el.id));
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(els.map((el) => [el.id, true as const])), selectedGroupIds: {} } });
    api.scrollToContent(els, { fitToContent: els.length > 1, animate: !prefersReducedMotion(), duration: 250 });
  };

  const viewContext = async () => {
    const id = info.operationId && (await getConversationStore().findByOperation(home.workspaceId, home.canvasId, info.operationId));
    if (id) aiPanel.openChat({ conversationId: id });
    else api.setToast({ message: "No saved conversation for this AI change.", duration: 3000 });
  };

  const undoOrRemove = () => {
    if (canUndo) {
      history.undo();
      return;
    }
    // Remove what the operation created (with bound labels), as one step Ctrl+Z restores.
    const ids = new Set(info.members);
    history.record(() =>
      api.updateScene({
        elements: api
          .getSceneElementsIncludingDeleted()
          .map((el) => (!el.isDeleted && (ids.has(el.id) || (el.type === "text" && el.containerId && ids.has(el.containerId))) ? newElementWith(el, { isDeleted: true }) : el)),
        appState: { selectedElementIds: {}, activeEmbeddable: null },
      }),
    );
  };

  const toggleExcluded = () => {
    if (!info.single || !info.reconcile) return;
    setExcludedFromReconciliation(api, info.single, !info.reconcile.excluded);
    setRevision((r) => r + 1);
  };

  const updateSource = async () => {
    if (!info.single) return;
    const outcome = await updateSourceFromEdit(api, home, info.single);
    const messages = {
      updated: "Updated the content source from this edit.",
      unchanged: "This already matches its content source.",
      unavailable: "This object can't be written back to its content source.",
    } as const;
    api.setToast({ message: messages[outcome], duration: 3000 });
    setRevision((r) => r + 1);
  };

  /** "Use this option" (G3): its source with this option chosen, applied as an update — reviewed like any other. */
  const chooseOption = async () => {
    if (!info.option) return;
    const text = await textWithOptionChosen(info.option.sourceId, info.option.choiceId, info.option.option);
    if (!text) {
      api.setToast({ message: "This choice is no longer open in its content source.", duration: 3000 });
      return;
    }
    visualizeDialog.open({ text, updateSourceId: info.option.sourceId, autoRun: { title: "Use this option" } });
  };

  const count = info.members.length;
  return createPortal(
    <fieldset className="acute-text-section acute-provenance" aria-label="Origin">
      <legend>Origin</legend>
      <p className="acute-provenance__origin">
        <strong>{info.origin}</strong>
        {info.detail && <span className="acute-provenance__detail"> · {info.detail}</span>}
      </p>
      {info.operationId && (
        <div className="acute-provenance__actions">
          {mode === "on" && (
            <button type="button" onClick={() => void viewContext()}>
              View context
            </button>
          )}
          <button type="button" onClick={viewChanges} title={`Select the ${count} object${count === 1 ? "" : "s"} this AI change added`}>
            View changes{count > 1 ? ` (${count})` : ""}
          </button>
          <button
            type="button"
            onClick={undoOrRemove}
            disabled={!canUndo && !count}
            title={canUndo ? "Undo this AI change" : `Remove the ${count} object${count === 1 ? "" : "s"} this AI change added (Ctrl+Z brings them back)`}
          >
            {canUndo ? "Undo" : "Remove"}
          </button>
        </div>
      )}
      {info.option && (
        <div className="acute-provenance__actions">
          <button type="button" data-primary onClick={() => void chooseOption()} title="Keep this option and drop the others: the box becomes this choice, and the others move to “Changed over time”">
            Use this option
          </button>
        </div>
      )}
      {info.reconcile && (
        <div className="acute-provenance__actions">
          <button
            type="button"
            onClick={toggleExcluded}
            aria-pressed={info.reconcile.excluded}
            title={info.reconcile.excluded ? "Let “Update from new content” change this object again" : "“Update from new content” will leave this object alone"}
          >
            {info.reconcile.excluded ? "Allow AI updates" : "Don't update this from AI"}
          </button>
          {canEditSource && (
            <button type="button" onClick={() => void updateSource()} title="Write this object's content back into the content it was made from">
              Update source from this edit
            </button>
          )}
        </div>
      )}
    </fieldset>,
    slot,
  );
}
