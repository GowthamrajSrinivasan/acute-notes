import { describe, expect, it } from "vitest";
import { parseSequence } from "./sequence";
import type { SequenceGraph } from "./types";

function parse(source: string): SequenceGraph {
  const r = parseSequence(source);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error.message}`);
  return r.graph;
}

function fails(source: string) {
  const r = parseSequence(source);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

const messages = (g: SequenceGraph) => g.messages.map((m) => `${m.from}>${m.to}:${m.text}`);

describe("parseSequence", () => {
  it("reads participants (with aliases) and a plain message", () => {
    const g = parse("sequenceDiagram\nparticipant A as Alice\nactor B as Bob\nA->>B: Hello");
    expect(g.kind).toBe("sequence");
    expect(g.participants).toEqual([
      { id: "A", label: "Alice", span: expect.any(Object) },
      { id: "B", label: "Bob", span: expect.any(Object) },
    ]);
    expect(messages(g)).toEqual(["A>B:Hello"]);
  });

  it("every arrow variant, in order, never deduped", () => {
    const g = parse(["sequenceDiagram", "A->B: a", "A-->B: b", "A->>B: c", "A-->>B: d", "A-xB: e", "A--xB: f", "A-)B: g", "A--)B: h", "A->>B: c"].join("\n"));
    expect(messages(g)).toEqual(["A>B:a", "A>B:b (async)", "A>B:c", "A>B:d (async)", "A>B:e", "A>B:f (async)", "A>B:g", "A>B:h (async)", "A>B:c"]);
  });

  it("participants implicit in a message are still recorded, in order of first mention", () => {
    const g = parse("sequenceDiagram\nB->>A: first\nA->>C: second");
    expect(g.participants.map((p) => p.id)).toEqual(["B", "A", "C"]);
  });

  it("activate/deactivate and the +/- shorthand are read past, not dropped silently", () => {
    const g = parse("sequenceDiagram\nA->>+B: call\nactivate B\nB-->>-A: reply\ndeactivate A");
    expect(messages(g)).toEqual(["A>B:call", "B>A:reply (async)"]);
    expect(g.skipped.some((s) => s.includes("activate/deactivate"))).toBe(true);
  });

  it("a single-line note attaches to the message it follows", () => {
    const g = parse("sequenceDiagram\nA->>B: Submit\nNote right of B: checks the payload\nB-->>A: Ack");
    expect(g.notes).toEqual([{ afterMessageIndex: 0, text: "checks the payload" }]);
  });

  it("a note before any message attaches to message index -1 (the builder clamps it to the first)", () => {
    const g = parse("sequenceDiagram\nNote over A,B: setup\nA->>B: Go");
    expect(g.notes).toEqual([{ afterMessageIndex: -1, text: "setup" }]);
  });

  it("a block note (`Note … \\n … \\n end note`) joins its lines", () => {
    const g = parse("sequenceDiagram\nA->>B: Submit\nNote over A,B\nline one\nline two\nend note");
    expect(g.notes).toEqual([{ afterMessageIndex: 0, text: "line one\nline two" }]);
  });

  it("loop/opt/alt/par/critical/break prefix messages with their block's label", () => {
    const g = parse(
      ["sequenceDiagram", "loop Retry up to 3x", "A->>B: Submit", "end", "alt Success", "B-->>A: Ack", "else Failure", "B-->>A: Nack", "end"].join("\n"),
    );
    expect(messages(g)).toEqual(["A>B:[loop: Retry up to 3x] Submit", "B>A:[alt: Success] Ack (async)", "B>A:[alt: Failure] Nack (async)"]);
  });

  it("nested blocks compose their prefixes", () => {
    const g = parse(["sequenceDiagram", "loop Outer", "alt Inner", "A->>B: Go", "end", "end"].join("\n"));
    expect(messages(g)).toEqual(["A>B:[loop: Outer] [alt: Inner] Go"]);
  });

  it("rect/box are visual-only: no label prefix, but noted as skipped", () => {
    const g = parse(["sequenceDiagram", "box Services", "participant A", "participant B", "end", "rect rgb(200,150,255)", "A->>B: Go", "end"].join("\n"));
    expect(messages(g)).toEqual(["A>B:Go"]);
    expect(g.skipped.some((s) => s.includes("box/rect"))).toBe(true);
  });

  it("title and autonumber are read, not dropped as errors", () => {
    const g = parse("sequenceDiagram\ntitle Checkout flow\nautonumber\nA->>B: Go");
    expect(g.title).toBe("Checkout flow");
    expect(g.skipped.some((s) => s.includes("autonumber"))).toBe(true);
  });

  it("syntax errors: no header, unclosed block, unmatched end/else, unknown construct", () => {
    expect(fails("A->>B: Hi")).toMatchObject({ code: "syntax", kind: "sequence" });
    expect(fails("sequenceDiagram\nloop Retry\nA->>B: Hi")).toMatchObject({ code: "syntax" });
    expect(fails("sequenceDiagram\nend")).toMatchObject({ code: "syntax" });
    expect(fails("sequenceDiagram\nelse Nope")).toMatchObject({ code: "syntax" });
    expect(fails("sequenceDiagram\ncreate participant A")).toMatchObject({ code: "syntax" });
  });

  it("a single-line note with no message afterward isn't a syntax error (just nothing to draw)", () => {
    expect(fails("sequenceDiagram\nNote right of A: no end")).toMatchObject({ code: "no_nodes" });
  });

  it("a syntax error names its line and column", () => {
    const e = fails("sequenceDiagram\nA->>B: ok\nnonsense here");
    expect(e).toMatchObject({ code: "syntax", line: 3 });
  });

  it("no messages at all is reported distinctly", () => {
    expect(fails("sequenceDiagram\nparticipant A")).toMatchObject({ code: "no_nodes" });
  });
});
