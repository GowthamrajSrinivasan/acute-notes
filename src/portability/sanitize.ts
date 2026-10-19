/**
 * Imported files are untrusted: links may only use web/mail/phone schemes
 * (no `javascript:` or `data:` URLs). Unsafe content links keep their text;
 * images keep only web URLs and stored-asset (`acute-asset://`) URLs.
 */
import { ACUTE_LINK_PREFIX } from "@/domain/canvas/adapter";
import { assetIdOf } from "@/domain/content/assetUrl";
import { isTableContent } from "@/domain/content/richContent";
import type { ContentBlock, InlineContent, RichContent, TableCell } from "@/domain/types";
import { normalizeObjectMetadata } from "@/domain/provenance";

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
export function sanitizeElement<E extends Record<string, unknown>>(el: E): E {
  let out = el;
  if (typeof el.link === "string" && !el.link.startsWith(ACUTE_LINK_PREFIX) && !isSafeUrl(el.link)) {
    out = { ...out, link: null };
  }
  const acute = (el.customData as { acute?: { href?: unknown } } | undefined)?.acute;
  if (acute && typeof acute.href === "string" && !isSafeUrl(acute.href)) {
    const { href: _href, ...rest } = acute;
    out = { ...out, customData: { ...(el.customData as object), acute: rest } };
  }
  return withSanitizedMetadata(out);
}

/**
 * The element with its object metadata (F25 provenance, tags) reduced to the
 * known, bounded fields — or removed when invalid. Used on import and export.
 */
export function withSanitizedMetadata<E extends Record<string, unknown>>(el: E): E {
  const customData = el.customData as Record<string, unknown> | undefined;
  if (!customData || !("acuteMeta" in customData)) return el;
  const { acuteMeta, ...rest } = customData;
  const meta = normalizeObjectMetadata(acuteMeta);
  return { ...el, customData: meta ? { ...rest, acuteMeta: meta } : rest };
}
