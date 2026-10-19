/**
 * AI mode On / Off (PRD §6.6). Off hides every `✨` entry point and makes
 * `AIRuntime` refuse to run, so no AI network request is made. Device-local,
 * like connections: stored in the `meta` store, never in workspace documents.
 * A build with the AI feature off (`src/config/features.ts`) always reads Off,
 * whatever is stored.
 */
import { isAIFeatureEnabled } from "@/config/features";
import { getPersistence } from "@/persistence";

export type AIMode = "on" | "off";

const META_KEY = "ai.mode";
const DEFAULT_MODE: AIMode = "on";

let mode: AIMode = DEFAULT_MODE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getAIMode(): AIMode {
  return isAIFeatureEnabled() ? mode : "off";
}

export async function setAIMode(next: AIMode): Promise<void> {
  if (!isAIFeatureEnabled() || next === mode) return;
  mode = next;
  emit();
  await getPersistence().meta.set(META_KEY, next);
}

export function subscribeAIMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Restores the stored mode. Call once at app start (with `loadConnections`). */
export async function loadAIMode(): Promise<void> {
  if (!isAIFeatureEnabled()) return;
  const stored = await getPersistence().meta.get<AIMode>(META_KEY);
  if ((stored === "on" || stored === "off") && stored !== mode) {
    mode = stored;
    emit();
  }
}
