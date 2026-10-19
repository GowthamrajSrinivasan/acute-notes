/**
 * Binds a renderer scene (a list of versioned elements) to a Y.Map keyed by
 * element id. Only elements whose `version` changed since the last commit are
 * written, so a commit costs O(n) number comparisons plus O(changed) writes —
 * never a full-scene serialization.
 */
import type * as Y from "yjs";

export interface VersionedElement {
  id: string;
  version: number;
  /** Fractional z-order index (Excalidraw ≥0.17). */
  index?: string | null;
}

export class SceneBinding<E extends VersionedElement> {
  private readonly versions = new Map<string, number>();

  constructor(private readonly map: Y.Map<E>) {}

  /** Reads the persisted scene in z-order and seeds the version cache. */
  readScene(): E[] {
    const elements = [...this.map.values()];
    for (const el of elements) this.versions.set(el.id, el.version);
    return elements.sort(compareIndex);
  }

  /**
   * Writes changed elements. Must be called inside the caller's Yjs
   * transaction (or it creates one per `set`). Returns the number written.
   */
  commit(elements: readonly E[]): number {
    let written = 0;
    for (const el of elements) {
      if (this.versions.get(el.id) === el.version) continue;
      this.map.set(el.id, el);
      this.versions.set(el.id, el.version);
      written++;
    }
    return written;
  }

  /** True when any element differs from the last committed version. */
  hasChanges(elements: readonly E[]): boolean {
    for (const el of elements) if (this.versions.get(el.id) !== el.version) return true;
    return false;
  }
}

function compareIndex(a: VersionedElement, b: VersionedElement): number {
  const ai = a.index ?? "";
  const bi = b.index ?? "";
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}
