"use client";

/**
 * Properties-panel fields for interactive diagram frames: the frame's "Interactive diagram" switch and level, a
 * node's kind, sublabel, tag, details, detail-frame link and sources, and an arrow's explanation. Rendered inside
 * `ObjectSection`'s panel slot.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import { LENS_LIMITS, NODE_KIND_LABELS, NODE_KINDS, type NodeKind, type NodeLens, type NodeSource, type SourceRole } from "@/domain/canvas/diagram";
import type { SelectedObject } from "@/components/properties/selectedBlockStore";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { setEdgeExplanation, setFrameInteractive, setNodeKind, setNodeSemantics } from "@/components/canvas/diagramNodes";
import { createDetailFrame, detailFrameCandidates, ensureNodeKey, linkDetailFrame, linkDetailFrameElsewhere, setFrameLevel, setNodeSources } from "@/components/canvas/lensNodes";
import { RowMenu, type MenuItem, type OpenMenu } from "@/components/common/RowMenu";
import { linkableFramesElsewhere } from "@/components/lens/lensScenes";
import { isProjectKind, PROJECT_KIND_LABELS } from "@/domain/canvas/nodeProject";
import { lensProfile } from "@/domain/lens/lensProfile";
import { parseLineRange } from "@/domain/sourceRef";
import { lensPanel } from "@/state/lensPanel";
import { MoveToCanvasButton, NodeLinkFields, ProjectFrameTools, ProjectNodeFields } from "./ProjectFields";

type Selected = Extract<SelectedObject, { kind: "frame" | "diagram-node" }>;

/**
 * A text field that commits once, on blur or Enter (one undo step per edit, not per keystroke). Uncontrolled: call
 * sites key it by its value, so an outside change (undo, another client) resets it.
 */
function CommitField({ label, value, multiline, placeholder, onCommit }: { label: string; value: string; multiline?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  const commit = (next: string) => {
    if (next !== value) onCommit(next);
  };
  const props = {
    className: "acute-diagram-field__input",
    "aria-label": label,
    placeholder,
    defaultValue: value,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(e.currentTarget.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation(); // keep canvas shortcuts out of the field
      if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit(e.currentTarget.value);
      }
      if (e.key === "Escape") e.currentTarget.blur();
    },
  };
  return (
    <label className="acute-diagram-field">
      <span>{label}</span>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
    </label>
  );
}

/** Opens Lens at `frameId`; from a node, assigns its key first (plan §3.1.1) and selects it there (AC1). */
function openInLens(frameId: string, api?: ExcalidrawImperativeAPI, nodeId?: string): void {
  const canvasId = getCanvasCommands()?.home().canvasId;
  if (!canvasId) return;
  const nodeKey = api && nodeId ? ensureNodeKey(api, nodeId) : undefined;
  lensPanel.open({ canvasId, frameId }, { nodeKey });
}

const PROFILE_LEVELS = lensProfile().levels;

function LevelSelect({ level, onChange }: { level: number | undefined; onChange: (level: number | null) => void }) {
  return (
    <label className="acute-diagram-field">
      <span>Level</span>
      <select className="acute-diagram-field__input" aria-label="Set level" value={level ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">Inferred</option>
        {PROFILE_LEVELS.map((l) => (
          <option key={l.index} value={l.index}>
            {l.short} {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * "Link to detail frame…" (plan §5.3, D23): a flat picker menu, the same idiom as Navigator's "Move to". Frames on
 * this workspace's other canvases (a detail canvas, Phase 1B) are added once they've loaded, read-only.
 */
function LinkDetailFrameButton({ api, nodeId, frameId, linked }: { api: ExcalidrawImperativeAPI; nodeId: string; frameId: string; linked?: NodeLens["expandsTo"] }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget.getBoundingClientRect();
    const candidates = detailFrameCandidates(api, frameId);
    const head: MenuItem[] = [
      // `createDetailFrame` links the node itself, in the same undo step.
      { label: "New detail frame", onSelect: () => void createDetailFrame(api, frameId, nodeId) },
      ...(candidates.length ? [{ label: "Existing frames", heading: true, separatorBefore: true }] : []),
      ...candidates.map((c) => ({ label: c.title, disabled: !linked?.canvasId && c.id === linked?.frameKey, onSelect: () => linkDetailFrame(api, nodeId, c.id) })),
    ];
    const tail: MenuItem[] = linked ? [{ label: "Unlink", separatorBefore: true, onSelect: () => linkDetailFrame(api, nodeId, null) }] : [];
    // A fresh id per open, so a slow scan from an earlier open can't fill this menu with stale items.
    const id = `link-detail-frame:${nodeId}:${++menuOpens}`;
    setMenu({ id, label: "Link to detail frame", anchor, items: [...head, ...tail] });
    const home = getCanvasCommands()?.home();
    if (!home) return;
    void linkableFramesElsewhere(home.workspaceId, home.canvasId).then(
      (frames) => {
        if (!frames.length) return;
        const elsewhere: MenuItem[] = [
          { label: "On other canvases", heading: true, separatorBefore: true },
          ...frames.map((f) => ({
            label: f.title,
            hint: f.canvasTitle,
            disabled: linked?.canvasId === f.canvasId && linked.frameKey === f.frameKey,
            onSelect: () => linkDetailFrameElsewhere(api, nodeId, f.canvasId, f.frameKey),
          })),
        ];
        setMenu((m) => (m?.id === id ? { ...m, items: [...head, ...elsewhere, ...tail] } : m));
      },
      (err: unknown) => console.error("[acute-notes] Couldn't list frames on other canvases", err),
    );
  };
  return (
    <>
      <button type="button" className="acute-text-section__convert" data-acute-menu-anchor="" onClick={open}>
        Link to detail frame…
      </button>
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

let menuOpens = 0;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const ROLE_OPTIONS: { value: SourceRole; label: string }[] = [
  { value: "implementation", label: "Implementation" },
  { value: "test", label: "Test" },
  { value: "config", label: "Config" },
  { value: "doc", label: "Doc" },
];

/**
 * "Source" (plan §3.3, §5.3, Phase 1B): the code a node is implemented by — a path, optional lines and a role
 * (D48) — so a hand-drawn L4 node reaches L5 without a Repo Map. Each add or remove is one undo step.
 */
function SourceField({ api, nodeId, sources }: { api: ExcalidrawImperativeAPI; nodeId: string; sources: readonly NodeSource[] }) {
  const [path, setPath] = useState("");
  const [lines, setLines] = useState("");
  const [role, setRole] = useState<SourceRole>("implementation");
  const range = parseLineRange(lines);
  const full = sources.length >= LENS_LIMITS.sources;
  const p = path.trim();
  // What `getNodeLens` would drop on save: say so here instead of clearing the field and losing it.
  const badPath = p.length > LENS_LIMITS.path || CONTROL_CHARS.test(p);
  const add = () => {
    if (!p || badPath || range === null || full) return;
    setNodeSources(api, nodeId, [...sources, { path: p, ...(range ? { lines: range } : {}), ...(role !== "implementation" ? { role } : {}) }]);
    setPath("");
    setLines("");
  };
  const stop = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep canvas shortcuts out of the fields
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="acute-diagram-field" role="group" aria-label="Source">
      <span>Source</span>
      {sources.length > 0 && (
        <ul className="acute-diagram-sources">
          {sources.map((s, i) => (
            <li key={`${s.path}:${s.lines?.join("-") ?? ""}:${i}`}>
              <code>{s.lines ? `${s.path}:${s.lines[0]}${s.lines[1] !== s.lines[0] ? `-${s.lines[1]}` : ""}` : s.path}</code>
              {s.role && s.role !== "implementation" && <em>{s.role}</em>}
              <button type="button" aria-label={`Remove source ${s.path}`} onClick={() => setNodeSources(api, nodeId, sources.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="acute-diagram-sources__add">
          <input className="acute-diagram-field__input" aria-label="Source path" aria-invalid={badPath || undefined} title={badPath ? `A path of at most ${LENS_LIMITS.path} characters, on one line` : undefined} placeholder="src/payment.service.ts" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={stop} />
          <input
            className="acute-diagram-field__input"
            aria-label="Source lines"
            aria-invalid={range === null || undefined}
            placeholder="143-158"
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            onKeyDown={stop}
          />
          <select className="acute-diagram-field__input" aria-label="Source role" value={role} onChange={(e) => setRole(e.target.value as SourceRole)}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" className="acute-text-section__convert" disabled={!p || badPath || range === null} onClick={add}>
            Add source
          </button>
        </div>
      )}
    </div>
  );
}

export function DiagramPanelSection({ api, selected }: { api: ExcalidrawImperativeAPI; selected: Selected }) {
  if (selected.kind === "frame") {
    return (
      <fieldset className="acute-text-section">
        <legend>Diagram</legend>
        <label className="acute-diagram-switch" title="Treat this frame as an architecture diagram: node kinds, relationship cards and a legend">
          <input type="checkbox" checked={selected.interactive} onChange={(e) => setFrameInteractive(api, selected.elementId, e.target.checked)} />
          <span>Interactive diagram</span>
        </label>
        {selected.interactive && (
          <>
            <button type="button" className="acute-text-section__convert" onClick={() => openInLens(selected.elementId)}>
              ✨ Open in Lens
            </button>
            {/* A project frame's levels are its banner and lanes, not a drill depth (plan §3.6). */}
            {selected.profile !== "project" && <LevelSelect level={selected.level} onChange={(level) => setFrameLevel(api, selected.elementId, level)} />}
            <ProjectFrameTools api={api} frameId={selected.elementId} profile={selected.profile} />
          </>
        )}
        <MoveToCanvasButton api={api} />
      </fieldset>
    );
  }

  const s = selected.semantics;
  const projectKind = isProjectKind(s.kind) ? s.kind : undefined;
  // Keyed by element so fields reset when the selection moves to another node.
  return (
    <fieldset className="acute-text-section" key={selected.elementId}>
      <legend>Diagram node</legend>
      <button type="button" className="acute-text-section__convert" onClick={() => openInLens(selected.frameId, api, selected.elementId)}>
        ✨ Open in Lens
      </button>
      {projectKind ? (
        // A project kind changes only through Promote (D33), so it isn't offered in the architecture kind list.
        <p className="acute-text-section__hint" data-testid="project-kind">
          {PROJECT_KIND_LABELS[projectKind]}
        </p>
      ) : (
        <select
          className="acute-text-section__font"
          aria-label="Node kind"
          value={s.kind ?? ""}
          onChange={(e) => setNodeKind(api, selected.elementId, (e.target.value || null) as NodeKind | null)}
        >
          <option value="">No kind</option>
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {NODE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      )}
      {projectKind && <ProjectNodeFields api={api} nodeId={selected.elementId} kind={projectKind} project={selected.project ?? {}} />}
      <CommitField key={`sub:${s.sublabel ?? ""}`} label="Sublabel" placeholder="e.g. query.py · dev_ui.py" value={s.sublabel ?? ""} onCommit={(v) => setNodeSemantics(api, selected.elementId, { sublabel: v })} />
      <CommitField key={`tag:${s.tag ?? ""}`} label="Tag" placeholder="e.g. STEP 0 · $0" value={s.tag ?? ""} onCommit={(v) => setNodeSemantics(api, selected.elementId, { tag: v })} />
      <CommitField
        key={`details:${(s.details ?? []).join("\n")}`}
        label="Details"
        placeholder="One per line"
        multiline
        value={(s.details ?? []).join("\n")}
        onCommit={(v) => setNodeSemantics(api, selected.elementId, { details: v.split("\n") })}
      />
      {/* Drill links and code evidence are architecture levels; a project node has neither (plan §3.6). */}
      {!projectKind && (
        <>
          <LinkDetailFrameButton api={api} nodeId={selected.elementId} frameId={selected.frameId} linked={selected.lens.expandsTo} />
          <SourceField api={api} nodeId={selected.elementId} sources={selected.lens.sources ?? []} />
        </>
      )}
      <NodeLinkFields api={api} nodeId={selected.elementId} refs={selected.project?.refs ?? []} />
    </fieldset>
  );
}

/** The explanation field shown under an arrow's relationship when the arrow belongs to a diagram. */
export function DiagramEdgeField({ api, arrowId, explanation }: { api: ExcalidrawImperativeAPI; arrowId: string; explanation: string }) {
  return (
    <div key={arrowId}>
      <CommitField key={explanation} label="Explanation" placeholder="Why this connection exists" multiline value={explanation} onCommit={(v) => setEdgeExplanation(api, arrowId, v)} />
    </div>
  );
}
