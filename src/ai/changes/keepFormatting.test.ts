// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { canonicalContent, fingerprintContent } from "@/ai/content/fingerprint";
import { markdownToContent } from "@/components/blocks/editor/markdown";
import { contentToMarkdown } from "@/domain/content/markdown";
import type { RichContent } from "@/domain/types";
import { keepFormatting } from "./keepFormatting";

const live: RichContent = [
  { id: "h1", type: "heading", props: { level: 2, textColor: "red" }, content: "Retries" },
  { id: "p1", type: "paragraph", props: { textColor: "blue", backgroundColor: "yellow" }, content: "Retries happen five times." },
  { id: "p2", type: "paragraph", props: { textAlignment: "center" }, content: [{ type: "text", text: "Calls are logged.", styles: { textColor: "green" } }] },
  { id: "l1", type: "bulletListItem", props: { textColor: "purple" }, content: "Backoff is exponential", children: [{ id: "l1a", type: "bulletListItem", content: "capped at 30s" }] },
];

describe("keepFormatting (user decision 2: preserve unrelated content and formatting)", () => {
  it("an update that changes one paragraph keeps every other block as it is, and the changed one its id and colours", () => {
    const md = contentToMarkdown(live).replace("five times", "three times");
    const proposed = markdownToContent(md);
    const kept = keepFormatting(live, proposed);
    expect(kept[0]).toBe(live[0]);
    expect(kept[2]).toBe(live[2]); // inline colour too
    expect(kept[3]).toBe(live[3]); // children with their ids
    expect(kept[1]).toMatchObject({ id: "p1", type: "paragraph", props: { textColor: "blue", backgroundColor: "yellow" } });
    expect(contentToMarkdown([kept[1]!])).toContain("Retries happen three times.");
    // Says exactly what the proposal says: the same fingerprint, so stale-target protection is unchanged.
    expect(fingerprintContent(kept)).toBe(fingerprintContent(proposed));
  });

  it("added, removed and retyped blocks take the new content; matched blocks around them are kept", () => {
    const md = ["## Retries", "A new first point.", "Another new point.", "- Backoff is exponential\n  - capped at 30s"].join("\n\n");
    const proposed = markdownToContent(md);
    const kept = keepFormatting(live, proposed);
    expect(kept[0]).toBe(live[0]);
    expect(kept.at(-1)).toBe(live[3]);
    // Two live paragraphs replaced by two new ones in place: ids and style props carried, content new.
    expect(kept.slice(1, 3).map((b) => b.id)).toEqual(["p1", "p2"]);
    expect(canonicalContent(kept)).toBe(canonicalContent(proposed));

    const retyped = markdownToContent("## Retries\n\n> Retries happen five times.");
    const out = keepFormatting(live, retyped);
    expect(out[0]).toBe(live[0]);
    expect(out[1]).toBe(retyped[1]); // a quote now: nothing carried
  });

  it("a run of a different length takes the new blocks as parsed", () => {
    const proposed = markdownToContent("## Retries\n\nOne.\n\nTwo.\n\nThree.\n\n- Backoff is exponential\n  - capped at 30s");
    const kept = keepFormatting(live, proposed);
    expect(kept.slice(1, 4)).toEqual(proposed.slice(1, 4));
    expect(kept[0]).toBe(live[0]);
    expect(kept[4]).toBe(live[3]);
  });

  it("never changes what the content says (a carried prop that would show in Markdown is not carried)", () => {
    const code: RichContent = [{ id: "c1", type: "codeBlock", props: { language: "ts", textColor: "red" }, content: "let a = 1;" }];
    const proposed: RichContent = [{ id: "n1", type: "codeBlock", props: {}, content: "let a = 2;" }];
    const kept = keepFormatting(code, proposed);
    expect(kept[0]).toMatchObject({ id: "c1", props: { textColor: "red" } });
    expect(kept[0]!.props).not.toHaveProperty("language");
    expect(canonicalContent(kept)).toBe(canonicalContent(proposed));
  });

  it("without live content, the proposal as it is", () => {
    const proposed = markdownToContent("Hello");
    expect(keepFormatting(null, proposed)).toBe(proposed);
    expect(keepFormatting([], proposed)).toBe(proposed);
  });
});
