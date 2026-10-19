"use client";

/**
 * Which frame Acute Lens has open, how deep it has drilled, and at what node (plan §5.1). A tiny external store
 * shaped like `pagePanel`, so the diagram panel ("Open in Lens"), the Lens panel itself and the canvas can share it
 * without lifting state through the shell.
 *
 * `path` holds node keys (plan §3.1.1), outermost first: `path[i]` is the node selected at level `i` whose child
 * frame is level `i + 1`. `selectedKey` is the node selected at the *current* (deepest) level, so stepping back up
 * naturally lands on the node you drilled through (plan AC5) — it's the key `up`/`jumpTo` just popped off `path`.
 */
import { useSyncExternalStore } from "react";
import type { FrameRef } from "@/domain/lens/lensView";
import type { TraceKind } from "@/domain/lens/trace";
import { claimSlot, registerSlotCloser, releaseSlot } from "./sidePanelSlot";

/** A node anywhere in the workspace, as Lens addresses it: its canvas and its Lens key (else its element id). */
export interface LensNodeRef {
  canvasId: string;
  key: string;
  label: string;
}

/**
 * The Trace node action (plan §5.2, Phase 3): from one node to a second picked on any level. Started from a node
 * (`startTrace`) or from the "Path" button (`beginTrace`), which picks the start first, as archify's route probe does.
 */
export interface LensTraceState {
  /** Null while the start is being picked. */
  from: LensNodeRef | null;
  /** Null while the second node is being picked. */
  to: LensNodeRef | null;
  kind: TraceKind;
}

export interface LensPanelState {
  root: FrameRef | null;
  path: readonly string[];
  selectedKey: string | null;
  /** Full width over the canvas (the canvas stays mounted underneath). */
  expanded: boolean;
  /** Node keys an agent asked to highlight (`focus_lens`), on whatever level shows them. */
  highlight: readonly string[];
  trace: LensTraceState | null;
  /** The node whose impact the inspector shows (the Impact node action). */
  impact: LensNodeRef | null;
}

const CLOSED: LensPanelState = { root: null, path: [], selectedKey: null, expanded: false, highlight: [], trace: null, impact: null };

let state: LensPanelState = CLOSED;
const listeners = new Set<() => void>();

function set(next: LensPanelState) {
  state = next;
  for (const l of listeners) l();
}

export const lensPanel = {
  get: (): LensPanelState => state,
  /** Opens Lens at `root` (and `path`). Keeps a trace or impact in progress: they're workspace-wide, not per level. */
  open(root: FrameRef, options: { path?: readonly string[]; nodeKey?: string | null; highlight?: readonly string[]; trace?: LensTraceState } = {}): void {
    claimSlot("lens");
    set({ ...state, root, path: options.path ?? [], selectedKey: options.nodeKey ?? null, highlight: options.highlight ?? [], ...(options.trace ? { trace: options.trace, impact: null } : {}) });
  },
  /** Starts a path with nothing chosen yet: the start is picked first, then the end. */
  beginTrace(): void {
    set({ ...state, trace: { from: null, to: null, kind: state.trace?.kind ?? "any" }, impact: null, highlight: [] });
  },
  /** Chooses (or changes) the start; the end is picked next. */
  setTraceFrom(from: LensNodeRef): void {
    set({ ...state, trace: { from, to: null, kind: state.trace?.kind ?? "any" }, impact: null, highlight: [] });
  },
  /** Goes back to picking the end, keeping the start. */
  pickTraceEnd(): void {
    if (state.trace?.to) set({ ...state, trace: { ...state.trace, to: null } });
  },
  /** Starts a trace from `from`; the second node is picked next ("Trace to here"). */
  startTrace(from: LensNodeRef): void {
    set({ ...state, trace: { from, to: null, kind: state.trace?.kind ?? "any" }, impact: null, highlight: [] });
  },
  traceTo(to: LensNodeRef): void {
    if (state.trace?.from) set({ ...state, trace: { ...state.trace, to } });
  },
  setTraceKind(kind: TraceKind): void {
    if (state.trace && state.trace.kind !== kind) set({ ...state, trace: { ...state.trace, kind } });
  },
  /** Shows what changing `node` affects (or hides it, with null). */
  showImpact(node: LensNodeRef | null): void {
    set({ ...state, impact: node, ...(node ? { trace: null, highlight: [] } : {}) });
  },
  /** Ends a trace, an impact view and an agent's highlight. */
  clearOverlays(): void {
    if (state.trace || state.impact || state.highlight.length) set({ ...state, trace: null, impact: null, highlight: [] });
  },
  select(key: string | null): void {
    if (state.selectedKey !== key) set({ ...state, selectedKey: key });
  },
  /** Zooms in through the node keyed `key` (one level deeper). */
  drill(key: string): void {
    set({ ...state, path: [...state.path, key], selectedKey: null });
  },
  /** Drops path steps past `length` that no longer resolve, keeping the selection where it is. */
  trimPath(length: number): void {
    if (length < state.path.length) set({ ...state, path: state.path.slice(0, length) });
  },
  /** Zooms out `n` levels (default 1), selecting the node that led to the level left behind. */
  up(n = 1): void {
    lensPanel.jumpTo(Math.max(0, state.path.length - n));
  },
  /** Zooms out to the breadcrumb at `index` (0 = root). */
  jumpTo(index: number): void {
    if (index >= state.path.length) return;
    const path = state.path.slice(0, index);
    set({ ...state, path, selectedKey: state.path[index] ?? null });
  },
  close(): void {
    releaseSlot("lens");
    if (state.root) set({ ...CLOSED, expanded: state.expanded });
  },
  setExpanded(expanded: boolean): void {
    if (state.expanded !== expanded) set({ ...state, expanded });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

registerSlotCloser("lens", lensPanel.close);

const SERVER_STATE: LensPanelState = CLOSED;

export function useLensPanel(): LensPanelState {
  return useSyncExternalStore(lensPanel.subscribe, lensPanel.get, () => SERVER_STATE);
}
