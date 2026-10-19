"use client";

/** An element briefly flashed (Acute Lens's "Back to canvas", plan AC9): shown ~900ms, then removed on its own. */
import { useSyncExternalStore } from "react";

const DURATION_MS = 900;

interface FlashEntry {
  id: string;
  token: number;
}

let entries: FlashEntry[] = [];
let token = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const flashStore = {
  get: (): readonly FlashEntry[] => entries,
  flash(elementId: string): void {
    const mine = ++token;
    entries = [...entries, { id: elementId, token: mine }];
    emit();
    setTimeout(() => {
      entries = entries.filter((e) => e.token !== mine);
      emit();
    }, DURATION_MS);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const EMPTY: readonly FlashEntry[] = [];

export function useFlashed(): readonly FlashEntry[] {
  return useSyncExternalStore(flashStore.subscribe, flashStore.get, () => EMPTY);
}
