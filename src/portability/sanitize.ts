/**
 * Imported files are untrusted: links may only use web/mail/phone schemes
 * (no `javascript:` or `data:` URLs). Unsafe content links keep their text;
 * images keep only web URLs and stored-asset (`acute-asset://`) URLs.
 */
import { ACUTE_LINK_PREFIX } from "@/domain/canvas/adapter";
import { assetIdOf } from "@/domain/content/assetUrl";
import { isTableContent } from "@/domain/content/richContent";
import type { ContentBlock, InlineContent, ObjectMetadata, RichContent, TableCell } from "@/domain/types";
import { normalizeAIMetadata, normalizeObjectMetadata } from "@/domain/provenance";

/** Reduces raw object metadata to its known, bounded fields (or undefined when invalid). */
export type MetadataNormalizer = (raw: unknown) => ObjectMetadata | undefined;

/**
 * Object metadata that also keeps the reconciliation link (`contentSourceId`, `contentSourceVersion`, …), which the
 * default (`normalizeObjectMetadata`) drops. Only used when a bundle carries its sources (§6.4), so citations resolve.
 */
export function objectMetadataWithLinks(raw: unknown): ObjectMetadata | undefined {
  const meta = normalizeObjectMetadata(raw);
  if (!meta?.ai) return meta;
  const ai = normalizeAIMetadata((raw as { ai?: unknown }).ai, { reconciliation: true });
  return ai ? { ...meta, ai } : meta;
}

/** The content source an object's raw metadata links to (an element's `acuteMeta`, a document's `metadata`), if any. */
export function linkedSourceOf(raw: unknown): string | undefined {
  return objectMetadataWithLinks(raw)?.ai?.contentSourceId;
}

/** The raw object metadata an element carries (`customData.acuteMeta`). */
export function elementMetadataOf(el: Record<string, unknown>): unknown {
  return (el.customData as { acuteMeta?: unknown } | undefined)?.acuteMeta;
}

/**
 * A normalizer that keeps an object's reconciliation link only when `resolve` knows its source, pointing it at the id
 * `resolve` gives (a bundle's new source id on import, the same id on export). An object whose source isn't carried
 * loses the whole link, as every bundle did before sources travelled with it: nothing ever points at a missing source.
 */
export function metadataLinkedTo(resolve: (sourceId: string) => string | undefined): MetadataNormalizer {
  return (raw) => {
    const meta = objectMetadataWithLinks(raw);
    const sourceId = meta?.ai?.contentSourceId;
    const to = sourceId ? resolve(sourceId) : undefined;
    if (!meta?.ai || !to) return normalizeObjectMetadata(raw);
    return { ...meta, ai: { ...meta.ai, contentSourceId: to } };
  };
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    // Relative links resolve against a placeholder origin and are allowed.
    return SAFE_PROTOCOLS.has(new URL(trimmed, "https://relative.invalid").protocol);
  } catch {
    return false;
  }
}

function sanitizeInline(nodes: InlineContent[]): InlineContent[] {
  return nodes.flatMap((n) => (n.type === "link" && !isSafeUrl(n.href) ? n.content : [n]));
}

function sanitizeCell(cell: TableCell): TableCell {
  if (typeof cell === "string") return cell;
  if (Array.isArray(cell)) return sanitizeInline(cell);
  return { ...cell, content: sanitizeInline(cell.content ?? []) };
}

export function sanitizeContent(blocks: RichContent): RichContent {
  return blocks.map((b): ContentBlock => {
    let content = b.content;
    if (Array.isArray(content)) content = sanitizeInline(content);
    else if (isTableContent(content)) {
      content = { ...content, rows: content.rows.map((r) => ({ ...r, cells: r.cells.map(sanitizeCell) })) };
    }
    // Images may show web URLs or the bundle's own stored assets only.
    const url = b.type === "image" ? b.props?.url : undefined;
    const props = typeof url === "string" && url && !isSafeUrl(url) && !assetIdOf(url) ? { ...b.props, url: "" } : b.props;
    return {
      ...b,
      ...(props !== undefined ? { props } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(b.children ? { children: sanitizeContent(b.children) } : {}),
    };
  });
}

/** Drops unsafe element links (Acute's own `acute://` embed links are kept). */
export function sanitizeElement<E extends Record<string, unknown>>(el: E, normalize: MetadataNormalizer = normalizeObjectMetadata): E {
  let out = el;
  if (typeof el.link === "string" && !el.link.startsWith(ACUTE_LINK_PREFIX) && !isSafeUrl(el.link)) {
    out = { ...out, link: null };
  }
  const acute = (el.customData as { acute?: { href?: unknown } } | undefined)?.acute;
  if (acute && typeof acute.href === "string" && !isSafeUrl(acute.href)) {
    const { href: _href, ...rest } = acute;
    out = { ...out, customData: { ...(el.customData as object), acute: rest } };
  }
  return withSanitizedMetadata(out, normalize);
}

/**
 * The element with its object metadata (F25 provenance, tags) reduced to the
 * known, bounded fields — or removed when invalid. Used on import and export; `normalize` keeps the reconciliation
 * link too when the bundle carries its sources.
 */
export function withSanitizedMetadata<E extends Record<string, unknown>>(el: E, normalize: MetadataNormalizer = normalizeObjectMetadata): E {
  const customData = el.customData as Record<string, unknown> | undefined;
  if (!customData || !("acuteMeta" in customData)) return el;
  const { acuteMeta, ...rest } = customData;
  const meta = normalize(acuteMeta);
  return { ...el, customData: meta ? { ...rest, acuteMeta: meta } : rest };
}
