"use client";

/**
 * Agent Sync (Lens plan §8.2, Phase 4): what the browser knows about an IDE agent keeping the architecture current.
 * There is no file watcher (D15): the signal is the agent's own MCP writes reaching a canvas.
 *
 * - **Activity:** when an MCP write was last staged on each canvas, and how many there have been. Lens shows
 *   `● Agent Sync · updated 12 s ago` while the last one is under `AGENT_SYNC_WINDOW_MS` old.
 * - **Pause:** freezes Lens's view (current and ghosts) and counts the writes that arrive meanwhile (Δ). It never stops
 *   the agent, the review bar or Accept on the canvas.
 * - **Unseen:** frames an accepted agent change touched, until the frame is viewed in Lens (the canvas chip's `Δ`).
 *
 * Memory only, per tab: a hint about this session, never document state.
 */
import { useSyncExternalStore } from "react";
import { diffScenes } from "@/ai/changes/agentState";
import type { SceneElement } from "@/domain/canvas/adapter";

/** "An MCP session has written in the last 10 minutes" (plan §8.2). */
export const AGENT_SYNC_WINDOW_MS = 10 * 60 * 1000;

interface Activity {
  lastWriteAt: number;
  writes: number;
}
interface Pause {
  /** The canvas's write count when paused: Δ is what arrived since. */
  writesAtPause: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const activity = new Map<string, Activity>();
const unseen = new Map<string, ReadonlySet<string>>();
let paused: Map<string, Pause> = new Map();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

type El = Pick<SceneElement, "id" | "isDeleted" | "customData" | "type" | "frameId"> & { version?: number };

/** The frames a write touched: each changed element's frame, or the frame itself when it is one. */
export function framesTouched(before: readonly El[], after: readonly El[]): string[] {
  const byId = new Map<string, El>([...before.map((e) => [e.id, e] as const), ...after.map((e) => [e.id, e] as const)]);
  const was = new Map(before.map((e) => [e.id, e] as const));
  const frames = new Set<string>();
  for (const t of diffScenes(before, after).touched) {
    for (const el of [byId.get(t.elementId), was.get(t.elementId)]) {
      if (!el) continue;
      if (el.type === "frame") frames.add(el.id);
      else if (el.frameId) frames.add(el.frameId);
    }
  }
  return [...frames];
}

export const agentSync = {
  /** An MCP write was staged (or merged) on this canvas. */
  touch(canvasId: string, at = Date.now()): void {
    const a = activity.get(canvasId);
    activity.set(canvasId, { lastWriteAt: at, writes: (a?.writes ?? 0) + 1 });
    emit();
  },
  lastWriteAt: (canvasId: string): number | undefined => activity.get(canvasId)?.lastWriteAt,
  /** Whether an agent wrote to this canvas within the Agent Sync window. */
  isOn: (canvasId: string, now = Date.now()): boolean => {
    const at = activity.get(canvasId)?.lastWriteAt;
    return at !== undefined && now - at < AGENT_SYNC_WINDOW_MS;
  },

  pause(canvasId: string): void {
    if (paused.has(canvasId)) return;
    paused = new Map(paused).set(canvasId, { writesAtPause: activity.get(canvasId)?.writes ?? 0 });
    emit();
  },
  resume(canvasId: string): void {
    if (!paused.has(canvasId)) return;
    paused = new Map(paused);
    paused.delete(canvasId);
    emit();
  },
  isPaused: (canvasId: string): boolean => paused.has(canvasId),
  /** Writes that arrived on this canvas since Lens was paused there (0 when it isn't). */
  heldWrites(canvasId: string): number {
    const p = paused.get(canvasId);
    return p ? (activity.get(canvasId)?.writes ?? 0) - p.writesAtPause : 0;
  },

  /** An accepted agent change touched these frames. */
  markUnseen(canvasId: string, frameIds: readonly string[]): void {
    if (!frameIds.length) return;
    const current = unseen.get(canvasId) ?? EMPTY_SET;
    if (frameIds.every((id) => current.has(id))) return;
    unseen.set(canvasId, new Set([...current, ...frameIds]));
    emit();
  },
  /** The frame was viewed in Lens. */
  markSeen(canvasId: string, frameId: string): void {
    const current = unseen.get(canvasId);
    if (!current?.has(frameId)) return;
    const next = new Set(current);
    next.delete(frameId);
    if (next.size) unseen.set(canvasId, next);
    else unseen.delete(canvasId);
    emit();
  },
  unseen: (canvasId: string): ReadonlySet<string> => unseen.get(canvasId) ?? EMPTY_SET,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** For tests: forgets everything. */
  reset(): void {
    activity.clear();
    unseen.clear();
    paused = new Map();
    emit();
  },
};

/** Re-renders on any Agent Sync change; read the store with `agentSync.*` in the component. */
export function useAgentSync(): number {
  return useSyncExternalStore(agentSync.subscribe, () => version, () => 0);
}
