import { describe, expect, it } from "vitest";
import { ContentTooLargeError, MAX_CONTENT_CHARS, parseContent, parsePlainText } from "./parser";
import type { ParsedBlock } from "./types";

const DOC = `# Checkout revamp

Retries fail **4%** of the time — see [the RFC](https://example.com/rfc) and \`chargeWithRetry\`.

## Tasks

- [x] Write the retry RFC
- [ ] Add idempotency keys
  - [ ] Store keys for 24 hours

## Endpoints

| Path | Method | p95 |
| :--- | :----: | --: |
| /cart | GET | 120 ms |
| /checkout | POST |

## Code

\`\`\`ts
export const attempts = 3;
\`\`\`

![Diagram](diagram.png "arch")

> Keep it simple.

---

<div onclick="alert(1)">raw</div>

1. First
2. Second

See [the spec][spec].

[spec]: https://example.com/spec
`;

const kinds = (blocks: readonly ParsedBlock[]) => blocks.map((b) => b.type);

describe("parseContent (Markdown)", () => {
  it("produces a typed tree of every supported block", async () => {
    const p = await parseContent(DOC);
    expect(p.format).toBe("markdown");
    expect(p.length).toBe(DOC.length);
    expect(kinds(p.blocks)).toEqual([
      "heading", "paragraph", "heading", "list", "heading", "table", "heading", "code", "image", "quote", "divider", "paragraph", "list", "paragraph",
    ]);
  });

  it("keeps inline structure: marks, links (incl. reference links) and plain text runs", async () => {
    const p = await parseContent(DOC);
    const para = p.blocks[1] as Extract<ParsedBlock, { type: "paragraph" }>;
    expect(para.text).toBe("Retries fail 4% of the time — see the RFC and chargeWithRetry.");
    expect(para.inline.find((i) => i.type === "text" && i.marks?.includes("strong"))).toMatchObject({ text: "4%" });
    expect(para.inline.find((i) => i.type === "link")).toMatchObject({ href: "https://example.com/rfc", children: [{ text: "the RFC" }] });
    expect(para.inline.find((i) => i.type === "text" && i.marks?.includes("code"))).toMatchObject({ text: "chargeWithRetry" });
    const ref = p.blocks.at(-1) as Extract<ParsedBlock, { type: "paragraph" }>;
    expect(ref.inline.find((i) => i.type === "link")).toMatchObject({ href: "https://example.com/spec" });
  });

  it("parses checklists (with nesting), tables (with alignment), code with language and images as references", async () => {
    const p = await parseContent(DOC);
    const list = p.blocks[3] as Extract<ParsedBlock, { type: "list" }>;
    expect(list.items.map((i) => [i.text, i.checked])).toEqual([
      ["Write the retry RFC", true],
      ["Add idempotency keys", false],
    ]);
    expect((list.items[1]!.children[0] as Extract<ParsedBlock, { type: "list" }>).items[0]).toMatchObject({ text: "Store keys for 24 hours", checked: false });
    expect(p.blocks[5]).toMatchObject({
      type: "table",
      columns: ["Path", "Method", "p95"],
      rows: [["/cart", "GET", "120 ms"], ["/checkout", "POST", ""]],
      align: ["left", "center", "right"],
    });
    expect(p.blocks[7]).toMatchObject({ type: "code", language: "ts", source: "export const attempts = 3;" });
    expect(p.blocks[8]).toMatchObject({ type: "image", src: "diagram.png", alt: "Diagram" });
    expect(p.blocks[12]).toMatchObject({ type: "list", ordered: true, start: 1 });
  });

  it("keeps raw HTML as text, never as markup", async () => {
    const p = await parseContent(DOC);
    expect(p.blocks[11]).toMatchObject({ type: "paragraph", text: '<div onclick="alert(1)">raw</div>' });
  });

  it("gives every block a source span that slices back to its source", async () => {
    const p = await parseContent(DOC);
    const src = (b: ParsedBlock) => DOC.slice(b.span.start, b.span.end);
    expect(src(p.blocks[0]!)).toBe("# Checkout revamp");
    expect(src(p.blocks[3]!)).toMatch(/^- \[x\] Write the retry RFC[\s\S]*Store keys for 24 hours$/);
    expect(src(p.blocks[5]!)).toMatch(/^\| Path[\s\S]*\| \/checkout \| POST \|$/);
    expect(src(p.blocks[7]!)).toBe("```ts\nexport const attempts = 3;\n```");
    const para = p.blocks[1] as Extract<ParsedBlock, { type: "paragraph" }>;
    const link = para.inline.find((i) => i.type === "link")!;
    expect(DOC.slice(link.span.start, link.span.end)).toBe("[the RFC](https://example.com/rfc)");
  });

  it("outlines the document by headings", async () => {
    const p = await parseContent("Lead in.\n\n# A\n\nText A\n\n## A1\n\nText A1\n\n## A2\n\n# B\n\nText B");
    expect(p.sections.map((s) => s.heading?.text ?? "(lead)")).toEqual(["(lead)", "A", "B"]);
    const a = p.sections[1]!;
    expect(a.subsections.map((s) => s.path)).toEqual([["A", "A1"], ["A", "A2"]]);
    expect(a.blockIndexes.map((i) => p.blocks[i]!.type)).toEqual(["paragraph"]);
    // A's span covers its subsections and ends where B starts.
    expect(p.blocks[a.headingIndex!]!.span.start).toBe(a.span.start);
    expect(a.span.end).toBe(p.blocks[p.sections[2]!.headingIndex!]!.span.start);
    expect(p.sections[0]!.blockIndexes).toEqual([0]);
  });

  it("is deterministic and handles empty input", async () => {
    expect(await parseContent(DOC)).toEqual(await parseContent(DOC));
    const empty = await parseContent("   \n\n");
    expect(empty.blocks).toEqual([]);
    expect(empty.sections).toEqual([]);
  });
});

describe("plain text and limits", () => {
  it("splits plain text into paragraphs without interpreting any syntax", () => {
    const text = "# not a heading\n- not a list\n\n\nSecond paragraph\r\nsame paragraph\n\n  ";
    const p = parsePlainText(text);
    expect(p.format).toBe("plain");
    expect(p.blocks.map((b) => (b.type === "paragraph" ? b.text : b.type))).toEqual(["# not a heading\n- not a list", "Second paragraph\r\nsame paragraph"]);
    for (const b of p.blocks) expect(text.slice(b.span.start, b.span.end)).toBe((b as { text: string }).text);
  });

  it("refuses content over the limit with a message the UI can show", async () => {
    const big = "x".repeat(MAX_CONTENT_CHARS + 1);
    await expect(parseContent(big)).rejects.toThrow(ContentTooLargeError);
    await expect(parseContent(big, { format: "plain" })).rejects.toThrow(/200,000.*Split it into smaller parts/);
  });

  it("parses a large document well inside the interaction budget", async () => {
    const section = (i: number) => `## Section ${i}\n\nSome **prose** with a [link](https://x.test/${i}).\n\n- [ ] task ${i}\n- item\n\n| a | b |\n| - | - |\n| ${i} | 2 |\n\n`;
    const doc = Array.from({ length: 400 }, (_, i) => section(i)).join(""); // ≈ 50k chars
    await parseContent(doc); // warm-up (loads the parser)
    const t0 = performance.now();
    const p = await parseContent(doc);
    const ms = performance.now() - t0;
    expect(p.blocks.length).toBe(400 * 4);
    console.info(`[F28] parsed ${doc.length.toLocaleString()} chars in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1_000);
  });
});
