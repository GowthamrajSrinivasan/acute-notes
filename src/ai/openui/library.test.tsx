/**
 * Phase 1 acceptance (`.ai/docs/open-intelligent-ui-audit.md`, Option A): "validate streaming and deterministic
 * rendering." No model calls here — a static OpenUI Lang fixture, parsed and rendered through the real
 * `@openuidev/react-lang` runtime against `acuteCardLibrary`.
 */
import { createParser, createStreamingParser, type ElementNode } from "@openuidev/react-lang";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { acuteCardLibrary } from "./library";
import { OpenUiCardRenderer } from "@/components/openui/OpenUiCardRenderer";

const FIXTURE = `
root = IdeaCard("Idempotency keys prevent duplicate charges", "When a client retries a payment request after a timeout, the server matches the request's idempotency key and returns the original result instead of charging twice.", "high", [c1, c2])
c1 = CitationChip("u4")
c2 = CitationChip("u7", "u7")
`.trim();

const schema = acuteCardLibrary.toJSONSchema();

function asIdeaCard(root: ElementNode | null) {
  if (!root || root.typeName !== "IdeaCard") throw new Error(`expected an IdeaCard root, got ${root?.typeName}`);
  return root;
}

describe("acuteCardLibrary — deterministic parsing", () => {
  it("parses the same fixture identically across independent parser instances", () => {
    const first = createParser(schema).parse(FIXTURE);
    const second = createParser(schema).parse(FIXTURE);

    for (const result of [first, second]) {
      expect(result.meta.incomplete).toBe(false);
      expect(result.meta.errors).toEqual([]);
      expect(result.meta.unresolved).toEqual([]);
      expect(result.meta.statementCount).toBe(3);
    }

    const a = asIdeaCard(first.root);
    const b = asIdeaCard(second.root);
    expect(a.props).toEqual(b.props);
  });

  it("maps positional args to named props in the library's Zod key order", () => {
    const { root } = createParser(schema).parse(FIXTURE);
    const card = asIdeaCard(root);

    expect(card.props.title).toBe("Idempotency keys prevent duplicate charges");
    expect(card.props.importance).toBe("high");

    const citations = card.props.citations as ElementNode[];
    expect(citations).toHaveLength(2);
    expect(citations[0]!.typeName).toBe("CitationChip");
    expect(citations[0]!.props.unit).toBe("u4");
    expect(citations[1]!.props.label).toBe("u7");
  });
});

describe("acuteCardLibrary — streaming parser", () => {
  it("converges to the same result as a one-shot parse as chunks arrive", () => {
    const streaming = createStreamingParser(schema);
    const chunkSize = 24;
    let sawIncomplete = false;

    for (let i = chunkSize; i < FIXTURE.length; i += chunkSize) {
      const partial = streaming.set(FIXTURE.slice(0, i));
      if (partial.meta.incomplete) sawIncomplete = true;
    }
    const final = streaming.set(FIXTURE, true);

    // The point of streaming: it actually was incomplete at some point, not just complete from chunk one.
    expect(sawIncomplete).toBe(true);
    expect(final.meta.incomplete).toBe(false);
    expect(final.meta.statementCount).toBe(3);

    const oneShot = createParser(schema).parse(FIXTURE);
    expect(asIdeaCard(final.root).props).toEqual(asIdeaCard(oneShot.root).props);
  });
});

describe("OpenUiCardRenderer — renders the parsed tree", () => {
  it("renders the card's title, body and citation chips to markup", () => {
    const html = renderToStaticMarkup(<OpenUiCardRenderer response={FIXTURE} isStreaming={false} />);

    expect(html).toContain("Idempotency keys prevent duplicate charges");
    expect(html).toContain("openui-idea-card");
    expect(html).toContain('data-unit="u4"');
    expect(html).toContain('data-unit="u7"');
  });

  it("renders nothing unsafe when response is null (nothing streamed in yet)", () => {
    expect(() => renderToStaticMarkup(<OpenUiCardRenderer response={null} isStreaming />)).not.toThrow();
  });
});
