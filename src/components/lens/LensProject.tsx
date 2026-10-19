"use client";

/**
 * The Lens inspector's project-knowledge section (plan §3.6, D33–D35, D53): a project node's fields, "Choose" an
 * option and "Promote", its `refs` resolved across canvases, and — for any node, architecture ones included — which
 * project nodes refer to it ("which decisions affect this node?"). Choose and Promote are the same small canvas
 * commands as the properties panel (D5: one undo step each), offered only when the node is on the open canvas.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { chooseOption, promoteNode } from "@/components/canvas/projectNodes";
import type { SceneElement } from "@/domain/canvas/adapter";
import { NODE_KIND_LABELS } from "@/domain/canvas/diagram";
import { isProjectKind } from "@/domain/canvas/nodeProject";
import { nextPromotion } from "@/domain/canvas/projectOps";
import type { LensNode } from "@/domain/lens/lensView";
import { inboundRefs, resolveRefs } from "@/domain/lens/refs";
import { useKeyIndex } from "./keyIndex";

export function ProjectInspector({
  api,
  node,
  home,
  editable,
  revision,
  onShowOnCanvas,
}: {
  api: ExcalidrawImperativeAPI;
  node: LensNode;
  home: { workspaceId: string; canvasId: string };
  /** The node is on the open canvas, so the canvas commands can reach it. */
  editable: boolean;
  /** Changes when the open scene does, so the key index is rebuilt. */
  revision: unknown;
  onShowOnCanvas: (ref: { canvasId: string; elementId: string }) => void;
}) {
  const index = useKeyIndex(home, () => api.getSceneElements() as unknown as readonly SceneElement[], revision);
  const kind = isProjectKind(node.semantics.kind) ? node.semantics.kind : undefined;
  const p = node.project ?? {};
  const refs = p.refs ?? [];
  const resolved = index ? resolveRefs(index, refs) : [];
  const inbound = index ? inboundRefs(index, [node.key]).filter((h) => h.elementId !== node.id) : [];
  const promotion = kind ? nextPromotion(kind, p) : null;
  const decision = kind === "decision" || kind === "constraint";

  if (!kind && !refs.length && !inbound.length) return null;
  return (
    <section className="acute-lens-project" aria-label="Project">
      {kind && (
        <p className="acute-lens-project__row">
          <b>{NODE_KIND_LABELS[kind]}</b>
          {node.badge ? ` · ${node.badge}` : ""}
        </p>
      )}
      {p.focus && (
        <p className="acute-lens-project__row">
          <b>Focus</b> {p.focus}
        </p>
      )}
      {p.reason && (
        <p className="acute-lens-project__row">
          <b>Reason</b> {p.reason}
        </p>
      )}
      {decision && !!p.options?.length && (
        <div role="group" aria-label="Options">
          <b className="acute-lens-project__row">Options</b>
          <ul>
            {p.options.map((o) => (
              <li key={o.label}>
                <code title={o.tradeoffs}>{o.label}</code>
                {o.tradeoffs && <span className="acute-lens-project__row">— {o.tradeoffs}</span>}
                {p.chosen === o.label ? (
                  <em>chosen</em>
                ) : (
                  editable && (
                    <button type="button" className="acute-lens-panel__zoom-in" aria-label={`Choose ${o.label}`} onClick={() => chooseOption(api, node.id, o.label)}>
                      Choose
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.answer && (
        <p className="acute-lens-project__row">
          <b>Answer</b> {p.answer}
        </p>
      )}
      {editable && promotion && (
        <button type="button" className="acute-lens-panel__zoom-in" disabled={!!promotion.blocked} title={promotion.blocked} onClick={() => promoteNode(api, node.id)}>
          {promotion.label}
        </button>
      )}
      {refs.length > 0 && (
        <div role="group" aria-label="References">
          <b className="acute-lens-project__row">Concerns</b>
          <ul>
            {refs.map((key, i) => {
              const r = resolved[i];
              return (
                <li key={key} data-status={r?.status}>
                  {r?.status === "resolved" ? (
                    <button type="button" className="acute-lens-panel__zoom-in" title={`Show on canvas (${key})`} onClick={() => onShowOnCanvas(r.target)}>
                      {r.target.label}
                    </button>
                  ) : (
                    <code title={key}>{!r ? key : r.status === "ambiguous" ? `${key} (found ${r.targets.length} times)` : `${key} (unresolved)`}</code>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {inbound.length > 0 && (
        <div role="group" aria-label="Referenced by">
          <b className="acute-lens-project__row">Referenced by</b>
          <ul>
            {inbound.map((h) => (
              <li key={`${h.canvasId}/${h.elementId}`}>
                <button type="button" className="acute-lens-panel__zoom-in" title="Show on canvas" onClick={() => onShowOnCanvas(h)}>
                  {h.label}
                </button>
                {h.kind && <em>{NODE_KIND_LABELS[h.kind]}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
