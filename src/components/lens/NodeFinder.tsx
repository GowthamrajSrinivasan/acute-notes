"use client";

/**
 * "Find start" / "Find end" for the path probe, in Lens's Trace card and on the canvas: a small search over node
 * labels. The caller says which nodes may be offered (the end step offers only what the start can reach).
 */
import { useId, useMemo, useState } from "react";

const FINDER_LIMIT = 8;

export function NodeFinder<T extends { label: string }>({
  items,
  itemKey,
  step,
  loading,
  onPick,
}: {
  items: readonly T[];
  itemKey: (item: T) => string;
  step: "start" | "end";
  loading?: boolean;
  onPick: (item: T) => void;
}) {
  const [text, setText] = useState("");
  const listId = useId();
  const wanted = text.trim().toLowerCase();
  const matches = useMemo(() => (wanted ? items.filter((n) => n.label.toLowerCase().includes(wanted)).slice(0, FINDER_LIMIT) : []), [items, wanted]);
  return (
    <div className="acute-lens-overlay__finder">
      <input type="search" aria-label={`Find ${step}`} aria-controls={listId} placeholder={`Find ${step}…`} value={text} onChange={(e) => setText(e.target.value)} />
      {wanted && !matches.length && <span className="acute-lens-overlay__muted">{loading ? "Loading the workspace…" : `No ${step === "end" ? "reachable " : ""}node matches.`}</span>}
      {matches.length > 0 && (
        <ul id={listId} aria-label={`${step} matches`}>
          {matches.map((n) => (
            <li key={itemKey(n)}>
              <button
                type="button"
                className="acute-lens-overlay__link"
                onClick={() => {
                  setText("");
                  onPick(n);
                }}
              >
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
