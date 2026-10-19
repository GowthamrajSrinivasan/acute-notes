/**
 * Rich content → Markdown (GFM), our own serializer (F17): no BlockNote or
 * renderer dependency, so export works without an editor instance.
 *
 * Mapping: headings `#`, lists `-` / `1.`, to-dos `- [ ]` / `- [x]`, quotes `>`,
 * dividers `---`, fenced code with language, GFM tables, images `![caption](url)`
 * (stored images keep their `acute-asset://` URL), toggles as list items with
 * their children nested. Inline: **bold**, *italic*, ~~strike~~,
 * `code`, [links](url); underline and colours have no Markdown form and are
 * dropped.
 */
import type { ContentBlock, InlineContent, InlineStyles, RichContent, TableCell } from "../types";
import { inlineOf, isTableContent } from "./richContent";

const INDENT = "   ";

function escapeText(text: string): string {
  return text.replace(/([\\`*_~[\]<>|])/g, "\\$1");
}

function styledText(text: string, styles: InlineStyles | undefined): string {
  if (!text) return "";
  if (styles?.code) {
    const fence = text.includes("`") ? "``" : "`";
    return `${fence}${text}${fence}`;
  }
  // Markdown emphasis must hug the text: keep surrounding spaces outside.
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? ["", "", text, ""];
  if (!core) return text;
  let out = escapeText(core);
  if (styles?.bold) out = `**${out}**`;
  if (styles?.italic) out = `*${out}*`;
  if (styles?.strike) out = `~~${out}~~`;
  return `${lead}${out}${trail}`;
}

export function inlineToMarkdown(nodes: InlineContent[]): string {
  return nodes
    .map((n) =>
      n.type === "link"
        ? `[${n.content.map((c) => styledText(c.text, c.styles)).join("")}](${n.href.replace(/[()\s]/g, encodeURIComponent)})`
        : styledText(n.text, n.styles),
    )
    .join("")
    .replace(/\n/g, "  \n");
}

function cellText(cell: TableCell): string {
  // `|` is already escaped as Markdown text; cells only need line breaks flattened.
  return inlineToMarkdown(inlineOf(cell)).replace(/ {2}\n/g, " ");
}

function tableToMarkdown(block: ContentBlock): string[] {
  if (!isTableContent(block.content)) return [];
  const rows = block.content.rows.map((r) => r.cells.map(cellText));
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  // GFM needs a header row; an unheadered table gets an empty one.
  const header = (block.content.headerRows ?? 0) > 0 ? rows[0]! : Array<string>(width).fill("");
  const body = (block.content.headerRows ?? 0) > 0 ? rows.slice(1) : rows;
  return [line(header), line(Array<string>(width).fill("---")), ...body.map(line)];
}

function blocksToLines(blocks: RichContent, depth: number): string[] {
  const out: string[] = [];
  const indent = INDENT.repeat(depth);
  let number = 0;
  let previousList = false;

  blocks.forEach((block, i) => {
    const isList = ["bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"].includes(block.type);
    number = block.type === "numberedListItem" ? number + 1 : 0;
    // Blank line between blocks, except inside a run of list items.
    if (i > 0 && !(isList && previousList)) out.push("");
    previousList = isList;

    const text = inlineToMarkdown(inlineOf(block.content));
    switch (block.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1)));
        out.push(`${indent}${"#".repeat(level)} ${text}`);
        break;
      }
      case "bulletListItem":
      case "toggleListItem":
        out.push(`${indent}- ${text}`);
        break;
      case "numberedListItem":
        out.push(`${indent}${number}. ${text}`);
        break;
      case "checkListItem":
        out.push(`${indent}- [${block.props?.checked === true ? "x" : " "}] ${text}`);
        break;
      case "quote":
        out.push(...(text || " ").split("\n").map((l) => `${indent}> ${l}`));
        break;
      case "divider":
        out.push(`${indent}---`);
        break;
      case "codeBlock": {
        const code = inlineOf(block.content)
          .map((n) => (n.type === "text" ? n.text : ""))
          .join("");
        const language = typeof block.props?.language === "string" && block.props.language !== "text" ? block.props.language : "";
        const fence = code.includes("```") ? "````" : "```";
        out.push(`${indent}${fence}${language}`, ...code.split("\n").map((l) => indent + l), `${indent}${fence}`);
        break;
      }
      case "table":
        out.push(...tableToMarkdown(block).map((l) => indent + l));
        break;
      case "image": {
        const url = typeof block.props?.url === "string" ? block.props.url : "";
        const alt = [block.props?.caption, block.props?.name].find((v) => typeof v === "string" && v) as string | undefined;
        if (url) out.push(`${indent}![${escapeText(alt ?? "")}](${url.replace(/[()\s]/g, encodeURIComponent)})`);
        break;
      }
      default:
        out.push(indent + text);
    }
    if (block.children?.length) {
      const childLines = blocksToLines(block.children, depth + 1);
      if (!isList) out.push("");
      out.push(...childLines);
    }
  });
  return out;
}

/** Markdown for a document body. */
export function contentToMarkdown(blocks: RichContent): string {
  const text = blocksToLines(blocks, 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? `${text}\n` : "";
}

/** A page as a Markdown file: its title as the top heading, then the body. */
export function pageToMarkdown(title: string, blocks: RichContent): string {
  const body = contentToMarkdown(blocks);
  const heading = `# ${escapeText(title.trim() || "Untitled")}\n`;
  return body ? `${heading}\n${body}` : heading;
}
