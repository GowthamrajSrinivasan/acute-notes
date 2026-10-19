"use client";

/**
 * A diagram node's passport card: kind, sublabel, tag, details, reach, and its incoming and outgoing relationships
 * (hover one to highlight its arrow, click it to go to the neighbour). Shared by the canvas overlay
 * (`DiagramOverlay`) and Acute Lens, which place it themselves.
 */
import { NODE_KIND_LABELS, RELATION_LABELS, type DiagramNode, type NodeNeighborhood } from "@/domain/canvas/diagram";
import { NODE_KIND_STYLES } from "@/domain/canvas/nodeKindStyle";

export function KindChip({ kind }: { kind?: DiagramNode["semantics"]["kind"] }) {
  if (!kind) return null;
  return (
    <span className="acute-diagram-chip" style={{ ["--acute-kind" as string]: NODE_KIND_STYLES[kind].accent }}>
      {NODE_KIND_LABELS[kind]}
    </span>
  );
}

export function Passport({
  frameTitle,
  hood,
  onHoverEdge,
  onGoTo,
  onClose,
}: {
  frameTitle: string;
  hood: NodeNeighborhood;
  onHoverEdge: (id: string | null) => void;
  onGoTo: (id: string) => void;
  onClose: () => void;
}) {
  const { node } = hood;
  const s = node.semantics;
  const groups = [
    { title: "Outgoing", arrow: "→", rows: hood.outgoing },
    { title: "Incoming", arrow: "←", rows: hood.incoming },
  ].filter((g) => g.rows.length);
  return (
    <>
      <header className="acute-diagram-card__head">
        <div className="acute-diagram-card__meta">
          <KindChip kind={s.kind} />
          <span className="acute-diagram-card__frame">{frameTitle}</span>
        </div>
        <button type="button" className="acute-diagram-card__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <strong className="acute-diagram-card__title">{node.label}</strong>
      {s.sublabel && <span className="acute-diagram-card__sub">{s.sublabel}</span>}
      {s.tag && <code className="acute-diagram-card__tag">{s.tag}</code>}
      {s.details && (
        <ul className="acute-diagram-card__details">
          {s.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      <p className="acute-diagram-card__reach" title="Nodes reachable against and along the arrows' direction">
        {hood.upstream} upstream · {hood.downstream} downstream
      </p>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.title} className="acute-diagram-card__group" aria-label={g.title}>
            <span className="acute-diagram-card__group-title">
              {g.title} · {g.rows.length}
            </span>
            {g.rows.map(({ edge, neighbor }) => (
              <button
                key={edge.id}
                type="button"
                className="acute-diagram-card__rel"
                onPointerEnter={() => onHoverEdge(edge.id)}
                onPointerLeave={() => onHoverEdge(null)}
                onFocus={() => onHoverEdge(edge.id)}
                onBlur={() => onHoverEdge(null)}
                onClick={() => onGoTo(neighbor.id)}
                title={`Go to ${neighbor.label}`}
              >
                <span className="acute-diagram-card__rel-dir" aria-hidden="true">
                  {g.arrow}
                </span>
                <span className="acute-diagram-card__rel-body">
                  <strong>{neighbor.label}</strong>
                  {(edge.label || edge.relation) && <small>{[edge.label, edge.relation && RELATION_LABELS[edge.relation]].filter(Boolean).join(" · ")}</small>}
                  {edge.explanation && <small className="acute-diagram-card__why">{edge.explanation}</small>}
                  {edge.confidence !== undefined && (
                    <small className="acute-diagram-card__confidence" title="How sure the AI was that this link exists; not verified">
                      AI · {Math.round(edge.confidence * 100)}% sure
                    </small>
                  )}
                </span>
              </button>
            ))}
          </section>
        ))
      ) : (
        <p className="acute-diagram-card__empty">No connected relationships yet. Draw arrows to other nodes in this frame.</p>
      )}
    </>
  );
}
