/**
 * Lightweight, read-only renderer for rich content snapshots. Inactive blocks
 * and page previews use this instead of a BlockNote editor instance, so a
 * canvas with many blocks costs plain DOM only.
 */
import { memo, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { BlockFontId } from "@/domain/content/blockStyle";
import { inlineOf, isTableContent } from "@/domain/content/richContent";
import type { ContentBlock, InlineContent, InlineStyles, RichContent } from "@/domain/types";
import { fontCss } from "./blockFonts";
import { resolveImageUrl } from "./imageAssets";
import { ChartPreview } from "./ChartPreview";
import { MermaidPreview } from "./MermaidPreview";
import { BACKGROUND_PALETTE, isCustomColor, resolveColor, TEXT_PALETTE } from "./palette";

/**
 * Inline CSS for value styles — the same resolution the editor schema uses
 * (see editor/schema.ts), so compact preview, Editor view and the live editor
 * render identically.
 */
function inlineCss(styles: InlineStyles): CSSProperties | undefined {
  const css: CSSProperties = {};
  const color = resolveColor(styles.textColor, TEXT_PALETTE);
  const background = resolveColor(styles.backgroundColor, BACKGROUND_PALETTE);
  if (color) css.color = color;
  if (background) css.backgroundColor = background;
  if (styles.fontFamily) css.fontFamily = fontCss(styles.fontFamily as BlockFontId);
  if (styles.fontSize) css.fontSize = `${Number(styles.fontSize)}px`;
  return Object.keys(css).length ? css : undefined;
}

function styled(text: string, styles: InlineStyles, key: number): ReactNode {
  let node: ReactNode = text;
  if (styles.code) node = <code>{node}</code>;
  if (styles.bold) node = <strong>{node}</strong>;
  if (styles.italic) node = <em>{node}</em>;
  if (styles.underline) node = <u>{node}</u>;
  if (styles.strike) node = <s>{node}</s>;
  return (
    <span key={key} data-custom-color={isCustomColor(styles.textColor) || undefined} style={inlineCss(styles)}>
      {node}
    </span>
  );
}

/** Block-level props (BlockNote side-menu colours, alignment). */
function blockCss(props: ContentBlock["props"]): CSSProperties | undefined {
  if (!props) return undefined;
  const css: CSSProperties = {};
  const color = resolveColor(props.textColor, TEXT_PALETTE);
  const background = resolveColor(props.backgroundColor, BACKGROUND_PALETTE);
  if (color) css.color = color;
  if (background) css.backgroundColor = background;
  const align = props.textAlignment;
  if (align === "center" || align === "right" || align === "justify") css.textAlign = align;
  return Object.keys(css).length ? css : undefined;
}

function Inline({ nodes }: { nodes: InlineContent[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.type === "link" ? (
          <a key={i} href={n.href} tabIndex={-1}>
            {n.content.map((c, j) => styled(c.text, c.styles ?? {}, j))}
          </a>
        ) : (
          styled(n.text, n.styles ?? {}, i)
        ),
      )}
    </>
  );
}

/** An image block; stored images resolve to a blob URL asynchronously. */
function PreviewImage({ props }: { props: ContentBlock["props"] }) {
  const url = typeof props?.url === "string" ? props.url : "";
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (url) void resolveImageUrl(url).then((resolved) => live && setSrc(resolved));
    return () => {
      live = false;
    };
  }, [url]);
  const caption = typeof props?.caption === "string" ? props.caption : "";
  const name = typeof props?.name === "string" ? props.name : "";
  const width = typeof props?.previewWidth === "number" ? props.previewWidth : undefined;
  return (
    <figure className="acute-preview__image">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs; next/image cannot optimise them */}
      {src ? <img src={src} alt={name} width={width} draggable={false} /> : <div className="acute-preview__image-missing">{url ? "" : "Image"}</div>}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function BlockNode({ block, number }: { block: ContentBlock; number: number }) {
  const inline = <Inline nodes={inlineOf(block.content)} />;
  const children = block.children?.length ? (
    <div className="acute-preview__children">
      <Blocks blocks={block.children} />
    </div>
  ) : null;

  switch (block.type) {
    case "heading": {
      const level = Number(block.props?.level ?? 1);
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      // A toggle heading is shown collapsed, as a toggle list is, until someone opens it in the editor.
      if (block.props?.isToggleable === true) {
        return (
          <Tag className="acute-preview__toggle-heading">
            <span className="acute-preview__marker acute-preview__toggle" aria-hidden="true">▸</span>
            {inline}
          </Tag>
        );
      }
      return (
        <>
          <Tag>{inline}</Tag>
          {children}
        </>
      );
    }
    case "bulletListItem":
      return (
        <div className="acute-preview__li">
          <span className="acute-preview__marker" aria-hidden="true">•</span>
          <div>
            {inline}
            {children}
          </div>
        </div>
      );
    case "numberedListItem":
      return (
        <div className="acute-preview__li">
          <span className="acute-preview__marker" aria-hidden="true">{number}.</span>
          <div>
            {inline}
            {children}
          </div>
        </div>
      );
    case "checkListItem": {
      const checked = block.props?.checked === true;
      return (
        <div className="acute-preview__li" data-checked={checked || undefined}>
          <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden="true" />
          <div className="acute-preview__check-text">
            {inline}
            {children}
          </div>
        </div>
      );
    }
    case "codeBlock": {
      const code = inlineOf(block.content).map((n) => (n.type === "text" ? n.text : "")).join("");
      const language = typeof block.props?.language === "string" ? block.props.language : "";
      const source = (
        <div className="acute-preview__code">
          {language && <span className="acute-preview__lang">{language}</span>}
          <pre>
            <code>{code || " "}</code>
          </pre>
        </div>
      );
      if (language === "mermaid" && code.trim()) return <MermaidPreview code={code} fallback={source} />;
      if (language === "acute-chart" && code.trim()) return <ChartPreview source={code} fallback={source} />;
      return source;
    }
    case "quote":
      return (
        <>
          <blockquote className="acute-preview__quote">{inline}</blockquote>
          {children}
        </>
      );
    case "divider":
      return <hr className="acute-preview__divider" />;
    case "image":
      return <PreviewImage props={block.props} />;
    case "toggleListItem":
      // Collapsed, as a toggle is shown until someone opens it.
      return (
        <div className="acute-preview__li">
          <span className="acute-preview__marker acute-preview__toggle" aria-hidden="true">▸</span>
          <div>{inline}</div>
        </div>
      );
    case "table": {
      if (!isTableContent(block.content)) return null;
      const headerRows = block.content.headerRows ?? 0;
      // Column widths the table was given (Visualize sizes long-text columns wider), as shares of the table's width.
      const widths = block.content.columnWidths ?? [];
      const total = widths.reduce<number>((n, w) => n + (w ?? 0), 0);
      const cols = block.content.rows[0]?.cells.length ?? 0;
      const sized = total > 0 && widths.length === cols && widths.every((w) => typeof w === "number" && w > 0);
      return (
        <table className="acute-preview__table">
          {sized && (
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: `${((w as number) / total) * 100}%` }} />
              ))}
            </colgroup>
          )}
          <tbody>
            {block.content.rows.map((row, r) => (
              <tr key={r}>
                {row.cells.map((cell, c) => {
                  const Cell = r < headerRows ? "th" : "td";
                  // A cell's own alignment and colours (set in the editor), as BlockNote renders them.
                  const props = typeof cell === "object" && !Array.isArray(cell) ? cell.props : undefined;
                  return (
                    <Cell key={c} style={blockCss(props as ContentBlock["props"])}>
                      <Inline nodes={inlineOf(cell)} />
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    default:
      return (
        <>
          <p>{inline}</p>
          {children}
        </>
      );
  }
}

/** 1-based position within each run of consecutive numbered list items. */
function listNumbers(blocks: RichContent): number[] {
  const out: number[] = [];
  blocks.forEach((b, i) => out.push(b.type === "numberedListItem" ? (i > 0 ? out[i - 1]! : 0) + 1 : 0));
  return out;
}

function Blocks({ blocks }: { blocks: RichContent }) {
  const numbers = listNumbers(blocks);
  return (
    <>
      {blocks.map((b, i) => {
        const css = blockCss(b.props);
        // `data-block-id` lets a click be mapped to the same character in the editor.
        return (
          <div
            key={b.id ?? i}
            className={css ? "acute-preview__styled" : "acute-preview__block"}
            data-block-id={b.id}
            style={css}
          >
            <BlockNode block={b} number={numbers[i]!} />
          </div>
        );
      })}
    </>
  );
}

export const BlockPreview = memo(function BlockPreview({
  content,
  placeholder,
}: {
  content: RichContent | undefined;
  placeholder?: string;
}) {
  const empty = !content || content.length === 0;
  return (
    <div className="acute-preview">
      {empty ? <p className="acute-preview__placeholder">{placeholder ?? "Empty"}</p> : <Blocks blocks={content} />}
    </div>
  );
});
