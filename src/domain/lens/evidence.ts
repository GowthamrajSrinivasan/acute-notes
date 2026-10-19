/**
 * A Lens node's evidence (plan §3.3, Phase 1B): derived from the canvas, never stored. Built from the element
 * itself (always), the sources the user entered in the properties panel (`acuteNode.sources`), and the repo code
 * locations an agent stamped as provenance (`sourceRefs`, `path#La-b@commit`). Pure, like `lensView`.
 */
import { getNodeLens, SOURCE_ROLES, type SourceRole } from "@/domain/canvas/diagram";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { evidenceOriginOf, sourceRefsOf } from "@/domain/provenance";
import { parseRepoRef } from "@/domain/sourceRef";
import type { DocumentRecord } from "@/domain/types";

export type EvidenceOrigin = "user" | "ai" | "mcp";

export interface LensEvidence {
  /** "conversation" and "commit" are reserved for later phases; nothing produces them yet. */
  source: "canvas" | "code" | "document" | "conversation" | "commit";
  /** "payment.service.ts:143-158". */
  label: string;
  path?: string;
  lines?: [number, number];
  commit?: string;
  /** D48: lets "tests linked to this node" be a read. */
  role?: SourceRole;
  /** A web link an imported source carried (already restricted to http/https by provenance). */
  url?: string;
  /** For "show on canvas". */
  ref?: { canvasId: string; elementId: string };
  origin: EvidenceOrigin;
}

export const EVIDENCE_ORIGIN_LABELS: Record<EvidenceOrigin, string> = { user: "you", ai: "AI", mcp: "your IDE agent" };

function codeLabel(path: string, lines?: [number, number]): string {
  if (!lines) return path;
  return lines[0] === lines[1] ? `${path}:${lines[0]}` : `${path}:${lines[0]}-${lines[1]}`;
}

function sameLocation(a: LensEvidence, b: LensEvidence): boolean {
  return a.path === b.path && a.lines?.[0] === b.lines?.[0] && a.lines?.[1] === b.lines?.[1];
}

/**
 * Evidence for one canvas element, user-entered sources first, then agent references, then the element itself.
 * An agent reference to the same path and lines as a user source is listed once (the user's).
 */
export function lensEvidence(
  el: Pick<SceneElement, "id" | "customData">,
  canvas: { canvasId: string; label: string },
  getDocument: (id: string) => DocumentRecord | null | undefined = () => undefined,
): LensEvidence[] {
  const out: LensEvidence[] = [];
  for (const s of getNodeLens(el)?.sources ?? []) {
    out.push({ source: "code", label: codeLabel(s.path, s.lines), path: s.path, ...(s.lines ? { lines: s.lines } : {}), ...(s.commit ? { commit: s.commit } : {}), ...(s.role ? { role: s.role } : {}), origin: "user" });
  }
  const origin = evidenceOriginOf(el, getDocument);
  for (const ref of sourceRefsOf(el, getDocument)) {
    const loc = parseRepoRef(ref);
    if (loc) {
      const item: LensEvidence = { source: "code", label: codeLabel(loc.path, loc.lines), path: loc.path, ...(loc.lines ? { lines: loc.lines } : {}), commit: loc.commit, origin };
      if (!out.some((e) => e.source === "code" && sameLocation(e, item))) out.push(item);
    } else {
      out.push({ source: "document", label: ref.externalId ? `${ref.provider} · ${ref.externalId}` : ref.provider, ...(ref.url ? { url: ref.url } : {}), origin });
    }
  }
  out.push({ source: "canvas", label: canvas.label, ref: { canvasId: canvas.canvasId, elementId: el.id }, origin });
  return out;
}

/** Code locations only: what the L5 source card shows. */
export function codeEvidence(evidence: readonly LensEvidence[]): LensEvidence[] {
  return evidence.filter((e) => e.source === "code" && e.path);
}

/** Evidence grouped by role (D48), in `SOURCE_ROLES` order; code with no role is "implementation". */
export function evidenceByRole(evidence: readonly LensEvidence[]): { role: SourceRole; items: LensEvidence[] }[] {
  const code = codeEvidence(evidence);
  return SOURCE_ROLES.map((role) => ({ role, items: code.filter((e) => (e.role ?? "implementation") === role) })).filter((g) => g.items.length);
}

/**
 * The code a Repo Map `code` card holds for these source locations (plan §5.2, Phase 2): a code card (≤ 40 lines) whose
 * own source cites the same path, the one overlapping the lines first. Shown on the L5 card; Acute never reads files.
 */
export function mapCodeFor(
  evidence: readonly LensEvidence[],
  elements: readonly SceneElement[],
  getDocument: (id: string) => DocumentRecord | null | undefined,
): { source: string; language?: string; path: string } | undefined {
  const wanted = codeEvidence(evidence);
  if (!wanted.length) return undefined;
  const overlap = (a?: [number, number], b?: [number, number]) => !a || !b || (a[0] <= b[1] && b[0] <= a[1]);
  let best: { source: string; language?: string; path: string; score: number } | undefined;
  for (const el of elements) {
    if (el.isDeleted) continue;
    const ref = getEmbedRef(el);
    if (ref?.kind !== "rich-block" || ref.blockType !== "code") continue;
    const own = codeEvidence(lensEvidence(el, { canvasId: "", label: "" }, getDocument));
    const hit = own.find((o) => wanted.some((w) => w.path === o.path && overlap(w.lines, o.lines)));
    if (!hit) continue;
    const block = getDocument(ref.documentId)?.snapshot.find((b) => b.type === "codeBlock") as { content?: unknown; props?: { language?: string } } | undefined;
    const source = typeof block?.content === "string" ? block.content : undefined;
    if (!source) continue;
    const score = wanted.some((w) => w.path === hit.path && w.lines && hit.lines) ? 2 : 1;
    if (!best || score > best.score) best = { source, ...(block?.props?.language ? { language: block.props.language } : {}), path: hit.path!, score };
  }
  return best && { source: best.source, ...(best.language ? { language: best.language } : {}), path: best.path };
}
