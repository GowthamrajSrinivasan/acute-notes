/**
 * Where Visualize can merge new content (topic merge plan G2.2): the content sources of this canvas that still have
 * objects on it and whose latest version is on this device, newest first. Each is named by its text's first heading
 * (else its first line), the way the user would recognise those notes.
 */
import { loadLatest } from "@/ai/content/sources";
import { existingObjects } from "@/ai/reconcile/existing";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";

export interface MergeTarget {
  sourceId: string;
  label: string;
  updatedAt: number;
}

const LABEL_MAX = 60;

export async function findMergeTargets(
  repo: ContentSourceRepository,
  canvasId: string,
  elements: readonly SceneElement[],
  getDocument: (id: string) => DocumentRecord | null | undefined,
): Promise<MergeTarget[]> {
  const sources = await repo.listByCanvas(canvasId);
  const targets = await Promise.all(
    sources.map(async (s): Promise<MergeTarget | null> => {
      if (!existingObjects(elements, getDocument, s.id).length) return null;
      const latest = await loadLatest(repo, s.id);
      return latest ? { sourceId: s.id, label: notesLabel(latest.version.text), updatedAt: s.updatedAt } : null;
    }),
  );
  return targets.filter((t): t is MergeTarget => t !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Which notes Visualize merges into and whether it merges at all, when the canvas has `found` notes: the notes the caller asked for
 * (`requested`: "Update from ChatGPT chats" opens on a source) and merge whatever the content is; else the newest notes, merging
 * unless the content is a selection's own (it is added as new notes).
 */
export function chooseMergeTarget(found: readonly MergeTarget[], requested: string | undefined, label: string | undefined): { targetId: string; mode: "merge" | "new" } | null {
  if (!found.length) return null;
  const chosen = requested && found.some((t) => t.sourceId === requested) ? requested : null;
  return { targetId: chosen ?? found[0]!.sourceId, mode: chosen ? "merge" : label === "Selection" ? "new" : "merge" };
}

/** The text's first heading, else its first non-empty line, as plain text. */
export function notesLabel(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => /^#{1,6}\s/.test(l)) ?? lines[0] ?? "Notes";
  const plain = first.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").trim() || "Notes";
  return plain.length > LABEL_MAX ? `${plain.slice(0, LABEL_MAX - 1)}…` : plain;
}
