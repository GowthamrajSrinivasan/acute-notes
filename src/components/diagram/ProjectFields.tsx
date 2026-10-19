"use client";

/**
 * Properties-panel fields for the Project profile (plan §3.6, D33–D35, D39, D53, D59): what a decision, finding,
 * progress item and the rest carry, the "Choose" and "Promote" commands, the semantic `refs` list with its "Link to
 * node…" picker, and "Move to canvas…". A user's own edits are canvas commands (D5), one undo step each, except the
 * move (see `moveToCanvas.ts`). Rendered by `DiagramPanelSection`.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { ensureNodeKey } from "@/components/canvas/lensNodes";
import { moveSelectionToCanvas, moveTargets } from "@/components/canvas/moveToCanvas";
import { addNodeRef, chooseOption, createProjectNode, promoteNode, removeNodeRef, setFrameProfile, setProjectFields } from "@/components/canvas/projectNodes";
import { RowMenu, type MenuItem, type OpenMenu } from "@/components/common/RowMenu";
import { invalidateKeyIndex, useKeyIndex } from "@/components/lens/keyIndex";
import type { SceneElement } from "@/domain/canvas/adapter";
import { NODE_ELEMENT_TYPES, type LensProfileId } from "@/domain/canvas/diagram";
import {
  ANNOTATION_INTENTS,
  DECISION_STATUSES,
  FINDING_NOTES,
  FINDING_STAGES,
  PROGRESS_STATUSES,
  PROJECT_KIND_LABELS,
  PROJECT_KINDS,
  PROJECT_LIMITS,
  PROJECT_STYLES,
  QUESTION_STATUSES,
  RISK_SEVERITIES,
  STATUS_LABELS,
  type NodeProject,
  type ProjectKind,
} from "@/domain/canvas/nodeProject";
import { nextPromotion } from "@/domain/canvas/projectOps";
import { resolveRefs, type KeyedTarget } from "@/domain/lens/refs";

function TextCommit({ label, value, multiline, placeholder, onCommit }: { label: string; value: string; multiline?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
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
      {multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />}
    </label>
  );
}

function Choice<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T | undefined; options: readonly T[]; labels?: Partial<Record<T, string>>; onChange: (v: T | undefined) => void }) {
  return (
    <label className="acute-diagram-field">
      <span>{label}</span>
      <select className="acute-diagram-field__input" aria-label={label} value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Move to canvas…" (D59): the selection keeps its keys, so references to it keep resolving. */
export function MoveToCanvasButton({ api }: { api: ExcalidrawImperativeAPI }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget.getBoundingClientRect();
    const home = getCanvasCommands()?.home();
    if (!home) return;
    void moveTargets(home.workspaceId, home.canvasId).then((targets) => {
      const items: MenuItem[] = targets.length
        ? targets.map((t) => ({
            label: t.title,
            onSelect: () =>
              void moveSelectionToCanvas(api, home, t.id).then((r) =>
                api.setToast({ message: r.ok ? `Moved ${r.count} item${r.count === 1 ? "" : "s"} to “${r.targetTitle}”. Keys kept; to reverse, move it back.` : r.reason, duration: 5000 }),
              ),
          }))
        : [{ label: "No other canvas in this workspace", disabled: true }];
      setMenu({ id: "move-to-canvas", label: "Move to canvas", anchor, items });
    });
  };
  return (
    <>
      <button type="button" className="acute-text-section__convert" data-acute-menu-anchor="" title="Moves the selection and keeps its keys, so references to it still resolve" onClick={open}>
        Move to canvas…
      </button>
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/** A frame's Lens profile, and (for a project frame) the "Add to project…" menu that creates its nodes. */
export function ProjectFrameTools({ api, frameId, profile }: { api: ExcalidrawImperativeAPI; frameId: string; profile: LensProfileId | undefined }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const add = (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = PROJECT_KINDS.map((k) => ({ label: PROJECT_KIND_LABELS[k], onSelect: () => createProjectNode(api, frameId, k) }));
    setMenu({ id: `add-project-node:${frameId}`, label: "Add to project", anchor, items });
  };
  return (
    <>
      <label className="acute-diagram-field">
        <span>Profile</span>
        <select className="acute-diagram-field__input" aria-label="Lens profile" value={profile ?? "architecture"} onChange={(e) => setFrameProfile(api, frameId, e.target.value === "project" ? "project" : null)}>
          <option value="architecture">Architecture</option>
          <option value="project">Project</option>
        </select>
      </label>
      {profile === "project" && (
        <button type="button" className="acute-text-section__convert" data-acute-menu-anchor="" onClick={add}>
          Add to project…
        </button>
      )}
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/** The nodes a ref can point at: every keyed node and frame on other canvases, and every shape on the open canvas. */
function RefPicker({ api, nodeId, taken, targets }: { api: ExcalidrawImperativeAPI; nodeId: string; taken: readonly string[]; targets: readonly KeyedTarget[] }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget.getBoundingClientRect();
    const home = getCanvasCommands()?.home();
    const here = api
      .getSceneElements()
      .filter((el) => el.id !== nodeId && NODE_ELEMENT_TYPES.includes(el.type) && !taken.includes(ensureKeyless(el as unknown as SceneElement)))
      .map((el) => ({ label: labelOf(api, el.id) || "Untitled", onSelect: () => addNodeRef(api, nodeId, ensureNodeKey(api, el.id)), hint: "this canvas" }));
    const elsewhere = targets
      .filter((t) => t.canvasId !== home?.canvasId && t.elementId !== nodeId && !taken.includes(t.key))
      .sort((a, b) => a.canvasId.localeCompare(b.canvasId) || a.label.localeCompare(b.label))
      .slice(0, 200)
      .map((t) => ({ label: t.label, hint: t.what === "frame" ? "frame" : "other canvas", onSelect: () => addNodeRef(api, nodeId, t.key) }));
    const items: MenuItem[] = [...here, ...elsewhere];
    setMenu({ id: `link-node:${nodeId}`, label: "Link to node", anchor, items: items.length ? items : [{ label: "Nothing to link to yet", disabled: true }] });
  };
  return (
    <>
      <button type="button" className="acute-text-section__convert" data-acute-menu-anchor="" onClick={open}>
        Link to node…
      </button>
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/** A shape's key if it has one, else a value that never matches a taken ref (the picker assigns keys on select). */
const ensureKeyless = (el: SceneElement): string => (el.customData?.acuteNode as { key?: string } | undefined)?.key ?? `\u0000${el.id}`;

function labelOf(api: ExcalidrawImperativeAPI, elementId: string): string {
  const t = api.getSceneElements().find((e) => e.type === "text" && e.containerId === elementId) as { originalText?: string; text?: string } | undefined;
  return (t?.originalText ?? t?.text ?? "").trim();
}

/** `refs` (D53): what this node concerns, resolved across canvases; an unresolved ref is shown, never dropped. */
function RefsField({ api, nodeId, refs }: { api: ExcalidrawImperativeAPI; nodeId: string; refs: readonly string[] }) {
  const home = getCanvasCommands()?.home();
  const index = useKeyIndex(home, () => api.getSceneElements() as unknown as readonly SceneElement[], refs.join("\n"));
  const resolved = index ? resolveRefs(index, refs) : [];
  // Each node once, by its key (id aliases are for resolving, D53); keyless nodes on other canvases aren't offered.
  const targets = index ? [...index.byKey.values()].flat().filter((t) => !t.alias && (t.what === "frame" || t.key !== t.elementId)) : [];
  return (
    <div className="acute-diagram-field" role="group" aria-label="References">
      <span>References</span>
      {refs.length > 0 && (
        <ul className="acute-diagram-sources">
          {refs.map((key, i) => {
            const r = resolved[i];
            const text = !r ? key : r.status === "resolved" ? r.target.label : r.status === "ambiguous" ? `${key} (found ${r.targets.length} times)` : `${key} (unresolved)`;
            return (
              <li key={key} data-status={r?.status}>
                <code title={key}>{text}</code>
                <button type="button" aria-label={`Remove reference ${key}`} onClick={() => removeNodeRef(api, nodeId, key)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {refs.length < PROJECT_LIMITS.refs && <RefPicker api={api} nodeId={nodeId} taken={refs} targets={targets} />}
    </div>
  );
}

/** A decision's options (D34): add, remove, and Choose one. */
function OptionsField({ api, nodeId, project }: { api: ExcalidrawImperativeAPI; nodeId: string; project: NodeProject }) {
  const [label, setLabel] = useState("");
  const [tradeoffs, setTradeoffs] = useState("");
  const options = project.options ?? [];
  const full = options.length >= PROJECT_LIMITS.options;
  const add = () => {
    const l = label.trim();
    if (!l || full || options.some((o) => o.label === l)) return;
    setProjectFields(api, nodeId, { options: [...options, tradeoffs.trim() ? { label: l, tradeoffs: tradeoffs.trim() } : { label: l }] });
    setLabel("");
    setTradeoffs("");
  };
  const stop = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="acute-diagram-field" role="group" aria-label="Options">
      <span>Options</span>
      {options.length > 0 && (
        <ul className="acute-diagram-sources acute-project-options">
          {options.map((o) => (
            <li key={o.label} data-chosen={project.chosen === o.label ? "" : undefined}>
              <code title={o.tradeoffs}>{o.label}</code>
              {project.chosen === o.label ? <em>chosen</em> : null}
              <button type="button" aria-label={project.chosen === o.label ? `Reopen without ${o.label}` : `Choose ${o.label}`} onClick={() => chooseOption(api, nodeId, project.chosen === o.label ? null : o.label)}>
                {project.chosen === o.label ? "Reopen" : "Choose"}
              </button>
              <button type="button" aria-label={`Remove option ${o.label}`} onClick={() => setProjectFields(api, nodeId, { options: options.filter((x) => x.label !== o.label) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="acute-diagram-sources__add">
          <input className="acute-diagram-field__input" aria-label="Option label" placeholder="Option" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={stop} />
          <input className="acute-diagram-field__input" aria-label="Option tradeoffs" placeholder="Tradeoffs (optional)" value={tradeoffs} onChange={(e) => setTradeoffs(e.target.value)} onKeyDown={stop} />
          <button type="button" className="acute-text-section__convert" disabled={!label.trim()} onClick={add}>
            Add option
          </button>
        </div>
      )}
    </div>
  );
}

/** The per-kind fields of a project-knowledge node, plus Promote, refs and Move. */
export function ProjectNodeFields({ api, nodeId, kind, project }: { api: ExcalidrawImperativeAPI; nodeId: string; kind: ProjectKind; project: NodeProject }) {
  const set = (patch: NodeProject) => setProjectFields(api, nodeId, patch);
  const promotion = nextPromotion(kind, project);
  return (
    <div className="acute-project-fields" data-kind={kind}>
      {kind === "project" && (
        <>
          <Choice label="Style" value={project.style} options={PROJECT_STYLES} onChange={(style) => set({ style })} />
          <TextCommit key={`focus:${project.focus ?? ""}`} label="Focus" placeholder="What the project is working on now" value={project.focus ?? ""} onCommit={(focus) => set({ focus: focus || undefined })} />
        </>
      )}
      {(kind === "decision" || kind === "constraint") && (
        <>
          <Choice label="Status" value={project.status} options={DECISION_STATUSES} labels={STATUS_LABELS} onChange={(status) => set({ status })} />
          <TextCommit key={`reason:${project.reason ?? ""}`} label="Reason" placeholder="Why" multiline value={project.reason ?? ""} onCommit={(reason) => set({ reason: reason || undefined })} />
          <OptionsField api={api} nodeId={nodeId} project={project} />
          {kind === "decision" && (
            <label className="acute-diagram-switch" title="Raise this decision as a warning to agents (a constraint always does)">
              <input type="checkbox" checked={project.enforce === true} onChange={(e) => set({ enforce: e.target.checked || undefined })} />
              <span>Enforce as a warning</span>
            </label>
          )}
        </>
      )}
      {kind === "finding" && (
        <>
          <Choice label="Stage" value={project.stage} options={FINDING_STAGES} onChange={(stage) => set({ stage })} />
          <Choice label="Kind of finding" value={project.note} options={FINDING_NOTES} onChange={(note) => set({ note })} />
        </>
      )}
      {kind === "open_question" && (
        <>
          <Choice label="Status" value={project.status} options={QUESTION_STATUSES} labels={STATUS_LABELS} onChange={(status) => set({ status })} />
          <TextCommit key={`answer:${project.answer ?? ""}`} label="Answer" multiline value={project.answer ?? ""} onCommit={(answer) => set({ answer: answer || undefined })} />
        </>
      )}
      {kind === "risk" && <Choice label="Severity" value={project.severity} options={RISK_SEVERITIES} onChange={(severity) => set({ severity })} />}
      {(kind === "milestone" || kind === "progress_item") && (
        <label className="acute-diagram-field">
          <span>Order</span>
          <input
            className="acute-diagram-field__input"
            type="number"
            min={0}
            aria-label="Order"
            defaultValue={project.order ?? ""}
            key={`order:${project.order ?? ""}`}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={(e) => set({ order: e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value) })}
          />
        </label>
      )}
      {kind === "progress_item" && (
        <>
          <Choice label="Status" value={project.status} options={PROGRESS_STATUSES} labels={STATUS_LABELS} onChange={(status) => set({ status })} />
          <label className="acute-diagram-switch">
            <input type="checkbox" checked={project.next === true} onChange={(e) => set({ next: e.target.checked || undefined })} />
            <span>Up next</span>
          </label>
        </>
      )}
      {kind === "annotation" && <Choice label="Intent" value={project.intent} options={ANNOTATION_INTENTS} onChange={(intent) => set({ intent })} />}
      {promotion && (
        <button type="button" className="acute-text-section__convert" disabled={!!promotion.blocked} title={promotion.blocked} onClick={() => promoteNode(api, nodeId)}>
          {promotion.label}
        </button>
      )}
    </div>
  );
}

/** Refs and Move, shown for any node of an interactive frame (an architecture node can be linked to as well). */
export function NodeLinkFields({ api, nodeId, refs }: { api: ExcalidrawImperativeAPI; nodeId: string; refs: readonly string[] }) {
  return (
    <>
      <RefsField api={api} nodeId={nodeId} refs={refs} />
      <MoveToCanvasButton api={api} />
    </>
  );
}

export { invalidateKeyIndex };
