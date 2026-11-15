/**
 * Card descriptors (intelligent-update-engine-plan Stage 2b): what the router — and a person picking a destination —
 * reads about a card at a glance. A title, a one-line summary, a few distinctive keywords, and the section it is in with
 * that section's own summary where Visualize wrote one (the frame's overview takeaway, knowledge-notes Wave D): the
 * summaries the notes already have are reused, never re-derived.
 *
 * Deterministic and local. Computed incrementally: a descriptor is kept until the card's text or its section changes.
 */
import { cyrb53 } from "@/ai/content/fingerprint";
import { significant, words } from "@/ai/fidelity/information";
import { sentenceSpans } from "@/ai/fidelity/sourceUnits";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { IndexedObject } from "@/search/workspaceIndex";

export interface SectionInfo {
  /** The frame's element id. */
  id: string;
  name: string;
  /** The section's own summary (its overview takeaway), when Visualize wrote one. */
  takeaway?: string;
}

export interface CardDescriptor {
  id: string;
  title: string;
  /** Its first sentence, cut to `SUMMARY_CHARS`. */
  summary: string;
  /** Its most distinctive words (rare in the workspace, frequent in the card), best first. */
  keywords: string[];
  section?: SectionInfo;
}

export const SUMMARY_CHARS = 160;
export const KEYWORDS = 6;

/** The sections of a canvas: each frame by id, and the frame each object is in. */
export function sectionsOf(scene: readonly SceneElement[]): { frames: Map<string, SectionInfo>; frameOf: Map<string, string> } {
  const frames = new Map<string, SectionInfo>();
  const frameOf = new Map<string, string>();
  for (const el of scene) {
    if (el.isDeleted) continue;
    if (el.type === "frame") {
      const overview = el.customData?.acuteOverview as { title?: unknown; takeaway?: unknown } | undefined;
      const name = (typeof overview?.title === "string" && overview.title.trim()) || (el as { name?: string | null }).name?.trim() || "Section";
      const takeaway = typeof overview?.takeaway === "string" && overview.takeaway.trim() ? overview.takeaway.trim() : undefined;
      frames.set(el.id, { id: el.id, name, ...(takeaway ? { takeaway } : {}) });
    } else if (el.frameId) frameOf.set(el.id, el.frameId);
  }
  return { frames, frameOf };
}

/** A card's first sentence (or line), at most `SUMMARY_CHARS`. */
export function summaryOf(text: string): string {
  const first = sentenceSpans(text, { start: 0, end: text.length })[0];
  const line = (first ? text.slice(first.start, first.end) : text.split("\n")[0] ?? "").replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS - 1)}…` : line;
}

/** The card's most distinctive words: frequent in it, rare in the workspace (tf · idf over the index's document frequencies). */
export function keywordsOf(text: string, frequency: (term: string) => number, size: number, limit = KEYWORDS): string[] {
  const tf = new Map<string, number>();
  for (const w of significant(text)) tf.set(w, (tf.get(w) ?? 0) + 1);
  const score = (w: string, n: number) => n * Math.log(1 + (size + 1) / (1 + frequency(w)));
  return [...tf].sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([w]) => w);
}

/** Descriptors kept until their card's text or section changes (see module doc). */
export class DescriptorCache {
  private readonly cache = new Map<string, { hash: string; descriptor: CardDescriptor }>();
  /** Descriptors computed in all (tests check it stays incremental). */
  computed = 0;

  describe(o: IndexedObject, section: SectionInfo | undefined, frequency: (term: string) => number, size: number): CardDescriptor {
    const hash = cyrb53(`${o.title ?? ""}\u0000${o.text}\u0000${section?.id ?? ""}\u0000${section?.name ?? ""}\u0000${section?.takeaway ?? ""}`);
    const hit = this.cache.get(o.id);
    if (hit?.hash === hash) return hit.descriptor;
    const firstLine = words(o.text).length ? summaryOf(o.text) : "";
    const descriptor: CardDescriptor = {
      id: o.id,
      title: (o.title ?? firstLine) || "Untitled",
      summary: firstLine,
      keywords: keywordsOf(`${o.title ?? ""}\n${o.text}`, frequency, size),
      ...(section ? { section } : {}),
    };
    this.cache.set(o.id, { hash, descriptor });
    this.computed++;
    return descriptor;
  }
}
