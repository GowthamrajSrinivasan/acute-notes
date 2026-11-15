/**
 * The Source tab's data from storage (knowledge-notes-plan §5.1, WP2.1): the source version a card was made from
 * (`ContentSourceRepository.getVersion` by its `contentSourceVersion`), its units, the run's outcome per unit and the
 * user's passage resolutions (`ai/content/sourceReview.ts`), the section outline from the text's headings, and, when
 * the source has a newer version, that version's lineage for "What changed". "Source not on this device" when the
 * source or that version isn't stored here (an import made without sources).
 */
import { parseContent } from "@/ai/content/parser";
import { loadSourceReview, type SourceReviewRecord } from "@/ai/content/sourceReview";
import type { SourcePanelData, SourcePanelState, UnitId } from "@/ai/fidelity/contracts";
import type { ParsedSection } from "@/ai/content/types";
import { rekey } from "@/ai/reconcile/topicIds";
import type { ContentSourceRepository, MetaRepository } from "@/persistence/repositories/types";
import type { ContentSourceVersion } from "@/domain/types";

/** A heading line whose text may carry inline Markdown (emphasis, code, links, HTML): only the parser reads it as units do. */
const INLINE_MARKUP = /[*_`[\]<>\\]/;
/** A setext underline (`===` / `---` under a line of text): only the parser tells it from a thematic break. */
const SETEXT = /(^|\n)[^\n#>\s][^\n]*\n {0,3}(=+|-+)[ \t]*(\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/**
 * The outline by scanning heading lines, when that is what the parser would say (ATX headings of plain text, fences
 * skipped): a 200k-character source in a few milliseconds, where a full parse takes hundreds (§5.2's 300 ms budget).
 * Null when the text has headings only the parser reads right (inline markup, setext); `outlineOf` then parses.
 */
export function scanOutline(text: string, pathIds?: Record<string, string>): SourcePanelData["sections"] | null {
  if (SETEXT.test(text)) return null;
  const out: SourcePanelData["sections"] = [];
  const open: { level: number; index: number; text: string }[] = [];
  let fence: string | null = null;
  let at = 0;
  for (const line of text.split("\n")) {
    const start = at;
    at += line.length + 1;
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    const h = ATX.exec(line);
    if (!h) continue;
    const heading = (h[2] ?? "").trim();
    if (!heading || INLINE_MARKUP.test(heading)) return null;
    const level = h[1]!.length;
    while (open.length && open.at(-1)!.level >= level) out[open.pop()!.index]!.span.end = start;
    const path = [...open.map((o) => o.text), heading];
    out.push({ topic: rekey(path.join(" › "), pathIds), heading, level, span: { start, end: text.length } });
    open.push({ level, index: out.length - 1, text: heading });
  }
  // Spans run to the end of the last subsection; a section still open at the end runs to the end of the text.
  for (const o of open) out[o.index]!.span.end = Math.max(out[o.index]!.span.start, text.length);
  return out;
}

/** The section outline (§5.2): every heading with its topic id (as units name it), level and span. */
export async function outlineOf(text: string, pathIds?: Record<string, string>): Promise<SourcePanelData["sections"]> {
  const scanned = scanOutline(text, pathIds);
  if (scanned) return scanned;
  try {
    const parsed = await parseContent(text);
    const out: SourcePanelData["sections"] = [];
    const visit = (s: ParsedSection) => {
      if (s.heading) out.push({ topic: rekey(s.path.join(" › "), pathIds), heading: s.heading.text, level: s.heading.level, span: { start: s.span.start, end: s.span.end } });
      s.subsections.forEach(visit);
    };
    parsed.sections.forEach(visit);
    return out;
  } catch {
    return [];
  }
}

/** The panel's outcome maps with the user's passage resolutions applied: Dismiss confirms an omission, Include represents it. */
export function withResolutions(record: SourceReviewRecord | null): Pick<SourcePanelData, "outcome" | "reasons"> {
  if (!record) return { outcome: {}, reasons: {} };
  const outcome = { ...record.outcome };
  const reasons = { ...record.reasons };
  for (const [unit, resolution] of Object.entries(record.resolutions)) {
    if (resolution === "dismissed") {
      outcome[unit] = "omitted";
      reasons[unit] = ["you confirmed leaving this out"];
    } else if (resolution === "included") {
      outcome[unit] = "represented";
      delete reasons[unit];
    }
  }
  return { outcome, reasons };
}

/** Versions are append-only, so a version and its outline are read once and kept (a few, the latest used). */
type CachedVersion = ContentSourceVersion & { sections: Promise<SourcePanelData["sections"]> };
const cache = new WeakMap<ContentSourceRepository, Map<string, Promise<CachedVersion | null>>>();
const MAX_VERSIONS = 8;

function versionOf(repo: ContentSourceRepository, sourceId: string, version: number): Promise<CachedVersion | null> {
  const versions = cache.get(repo) ?? cache.set(repo, new Map()).get(repo)!;
  const key = `${sourceId}@${version}`;
  let hit = versions.get(key);
  if (hit) {
    versions.delete(key);
    versions.set(key, hit);
    return hit;
  }
  hit = repo
    .getVersion(sourceId, version)
    .then((v) => (v ? { ...v, sections: outlineOf(v.text, v.pathIds) } : null))
    .catch(() => null);
  // A version not found isn't kept: it may be recorded a moment later (an Accept still writing).
  void hit.then((v) => (v ? undefined : versions.delete(key)));
  versions.set(key, hit);
  while (versions.size > MAX_VERSIONS) versions.delete(versions.keys().next().value!);
  return hit;
}

export interface LoadedSource {
  state: SourcePanelState;
  /** The stored outcomes and resolutions (null for a version recorded without them). */
  review: SourceReviewRecord | null;
}

/** Everything the Source tab shows for a card made from `version` of `sourceId`; `onCanvas`: units some card on the canvas cites. */
export async function loadSourcePanel(repo: ContentSourceRepository, meta: MetaRepository, sourceId: string, version: number, onCanvas: readonly UnitId[]): Promise<LoadedSource> {
  const source = await repo.get(sourceId).catch(() => null);
  const v = source ? await versionOf(repo, sourceId, version) : null;
  if (!source || !v) return { state: { kind: "unavailable" }, review: null };
  const [review, sections] = await Promise.all([loadSourceReview(meta, sourceId, version).catch(() => null), v.sections]);
  const latest = source.latestVersion > version ? await repo.getVersion(sourceId, source.latestVersion).catch(() => null) : null;
  // "What changed" needs the lineage from this version: the next version's, when the newer one is the next.
  const lineage = latest?.lineage && latest.lineage.fromVersion === version ? latest.lineage : undefined;
  const data: SourcePanelData = {
    sourceId,
    version,
    latestVersion: source.latestVersion,
    text: v.text,
    sections,
    units: v.units?.units ?? [],
    ...withResolutions(review),
    onCanvas: [...new Set(onCanvas)],
    ...(lineage ? { lineage } : {}),
  };
  return { state: { kind: "ready", data }, review };
}
