import { describe, expect, it } from "vitest";
import { detectMermaid, isMermaidLanguage } from "./detect";

describe("detectMermaid", () => {
  it.each([
    ["graph TD\nA-->B", "flowchart", "graph", true],
    ["flowchart LR\nA-->B", "flowchart", "flowchart", true],
    ["flowchart\nA", "flowchart", "flowchart", true],
    ["flowchart-elk TD\nA-->B", "flowchart", "flowchart-elk", true],
    ["graph TD; A-->B", "flowchart", "graph", true],
    ["stateDiagram-v2\n[*] --> A", "state", "stateDiagram-v2", true],
    ["stateDiagram\n[*] --> A", "state", "stateDiagram", true],
    ["sequenceDiagram\nA->>B: hi", "sequence", "sequenceDiagram", true],
    ["classDiagram\nA <|-- B", "class", "classDiagram", true],
    ["erDiagram\nA ||--o{ B : has", "er", "erDiagram", true],
    ["gantt\ntitle x", "gantt", "gantt", true],
    ["pie title Pets\n\"Dogs\" : 3", "pie", "pie", true],
    ["mindmap\n  root", "mindmap", "mindmap", false],
    ["gitGraph\ncommit", "gitgraph", "gitGraph", false],
    ["C4Context\ntitle x", "c4", "C4Context", false],
    ["architecture-beta\nservice a", "architecture", "architecture-beta", true],
  ] as const)("%j → %s", (code, kind, keyword, supported) => {
    expect(detectMermaid(code)).toMatchObject({ kind, keyword, supported });
  });

  it("skips frontmatter, blank lines, comments and init directives before the header", () => {
    const code = `---\ntitle: Checkout\n---\n\n%% a comment\n%%{init: {"theme": "dark"}}%%\n  flowchart LR\n  A-->B`;
    const d = detectMermaid(code)!;
    expect(d.kind).toBe("flowchart");
    expect(code.slice(d.headerSpan.start, d.headerSpan.end)).toBe("flowchart LR");
  });

  it("returns null for anything that doesn't start with a diagram header", () => {
    expect(detectMermaid("")).toBeNull();
    expect(detectMermaid("   \n %% only a comment")).toBeNull();
    expect(detectMermaid("const x = 1;")).toBeNull();
    expect(detectMermaid("graphs are fun")).toBeNull();
    expect(detectMermaid("A --> B")).toBeNull();
    expect(detectMermaid(undefined as unknown as string)).toBeNull();
  });
});

describe("isMermaidLanguage", () => {
  it("accepts mermaid/mmd fences in any case", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true);
    expect(isMermaidLanguage(" Mermaid ")).toBe(true);
    expect(isMermaidLanguage("mmd")).toBe(true);
    expect(isMermaidLanguage("markdown")).toBe(false);
    expect(isMermaidLanguage(undefined)).toBe(false);
    expect(isMermaidLanguage(null)).toBe(false);
  });
});
