/**
 * The two ASCII-tree parsers on real-world drawings: `tree` / `tree /F` / `npm ls` output, chat-answer trees,
 * org charts and the pricing fixture's business-model diagram — plus the ASCII art that must not read as a tree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectAsciiTree, parseAsciiTree } from "./convert";
import type { AsciiTree } from "./types";

function parse(source: string): AsciiTree {
  const r = parseAsciiTree(source);
  if (!r.ok) throw new Error(`expected a tree, got ${r.error.code}: ${r.error.message}`);
  return r.tree;
}

/** "label<parent label" per node, in pre-order. */
const edges = (t: AsciiTree) => t.nodes.map((n) => `${n.label}${n.parent === null ? "" : `<${t.nodes[n.parent]!.label}`}`);
const labelOf = (t: AsciiTree) => t.nodes.map((n) => n.label);
/** Every node's span, sliced out of the source. */
const spans = (t: AsciiTree, source: string) => t.nodes.map((n) => source.slice(n.span.start, n.span.end));

const PRICING = readFileSync("e2e/ai/fixtures/pricingAnswer.md", "utf8");
const BUSINESS_MODEL = /```text\n([\s\S]*?)```/.exec(PRICING)![1]!;

describe("indented trees", () => {
  it("`tree` output (unicode), with the summary line skipped", () => {
    const src = [".", "├── package.json", "├── src", "│   ├── index.ts", "│   └── utils", "│       └── math.ts", "└── README.md", "", "2 directories, 4 files", ""].join("\n");
    const t = parse(src);
    expect(t.style).toBe("indented");
    expect(edges(t)).toEqual([".", "package.json<.", "src<.", "index.ts<src", "utils<src", "math.ts<utils", "README.md<."]);
    expect(t.roots).toEqual([0]);
    expect(t.notes.join()).toContain("skipped 1 line");
    expect(spans(t, src)).toEqual(labelOf(t));
  });

  it("`tree -A`-less ASCII output: |-- and `--", () => {
    const src = ".\n|-- app\n|   |-- main.py\n|   `-- models\n|       `-- user.py\n`-- tests\n    `-- test_user.py\n";
    expect(edges(parse(src))).toEqual([".", "app<.", "main.py<app", "models<app", "user.py<models", "tests<.", "test_user.py<tests"]);
  });

  it("+-- and \\-- (Windows `tree /A`, many docs)", () => {
    const src = "root\n+-- child1\n|   +-- grand1\n|   \\-- grand2\n\\-- child2\n";
    expect(edges(parse(src))).toEqual(["root", "child1<root", "grand1<child1", "grand2<child1", "child2<root"]);
    const win = "C:.\n+---src\n|   \\---lib\n\\---docs\n";
    expect(edges(parse(win))).toEqual(["C:.", "src<C:.", "lib<src", "docs<C:."]);
  });

  it("`tree /F`: unmarked file entries belong to the folder they sit under", () => {
    const src = [
      "Folder PATH listing for volume OS",
      "Volume serial number is 1234-ABCD",
      "C:.",
      "├───src",
      "│   │   index.ts",
      "│   │   app.ts",
      "│   │",
      "│   └───components",
      "│           Button.tsx",
      "└───docs",
      "        readme.md",
    ].join("\r\n");
    const t = parse(src);
    expect(edges(t)).toEqual(["C:.", "src<C:.", "index.ts<src", "app.ts<src", "components<src", "Button.tsx<components", "docs<C:.", "readme.md<docs"]);
    expect(spans(t, src)).toEqual(labelOf(t));
    expect(t.notes.join()).toContain("skipped 2 lines");
  });

  it("`npm ls` output: ├─┬ marks a package with dependencies", () => {
    const src = "my-app@1.0.0 /work/my-app\n├── react@18.2.0\n├─┬ next@14.0.0\n│ ├── @next/env@14.0.0\n│ └── styled-jsx@5.1.1\n└── typescript@5.3.3\n";
    expect(edges(parse(src))).toEqual([
      "my-app@1.0.0 /work/my-app",
      "react@18.2.0<my-app@1.0.0 /work/my-app",
      "next@14.0.0<my-app@1.0.0 /work/my-app",
      "@next/env@14.0.0<next@14.0.0",
      "styled-jsx@5.1.1<next@14.0.0",
      "typescript@5.3.3<my-app@1.0.0 /work/my-app",
    ]);
  });

  it("a chat-answer tree: indented under its root, one-dash markers, arrow heads, bullets and bold trimmed", () => {
    const src = "  **Company**\n    ├─ Engineering\n    │   ├─> Frontend (5)\n    │   └─> [ Backend (7) ]\n    ├─ • Sales\n    └─ `Support`\n";
    const t = parse(src);
    expect(edges(t)).toEqual(["Company", "Engineering<Company", "Frontend (5)<Engineering", "Backend (7)<Engineering", "Sales<Company", "Support<Company"]);
    // Spans point at the label as written (wrappers included), never at the drawing.
    expect(spans(t, src)).toEqual(["**Company**", "Engineering", "Frontend (5)", "[ Backend (7) ]", "• Sales", "`Support`"]);
  });

  it("the planner's own ASCII sample", () => {
    expect(edges(parse("ACUTE\n ├── FREE\n └── PAID\n      ├── PRO\n      └── BYOK"))).toEqual(["ACUTE", "FREE<ACUTE", "PAID<ACUTE", "PRO<PAID", "BYOK<PAID"]);
  });

  it("any depth", () => {
    const lines = ["L0"];
    for (let d = 1; d <= 12; d++) lines.push(`${"    ".repeat(d - 1)}└── L${d}`);
    const t = parse(lines.join("\n"));
    expect(t.nodes).toHaveLength(13);
    expect(t.nodes.every((n, i) => n.parent === (i === 0 ? null : i - 1))).toBe(true);
  });

  it("several roots, with or without a blank line between them; a tree may start with branches", () => {
    const t = parse("frontend/\n├── app\n└── lib\nbackend/\n├── api\n└── db\n\nshared/\n└── types\n");
    expect(t.roots.map((r) => t.nodes[r]!.label)).toEqual(["frontend/", "backend/", "shared/"]);
    expect(edges(t)).toContain("db<backend/");
    const bare = parse("├── one\n│   └── one.a\n└── two\n");
    expect(edges(bare)).toEqual(["one", "one.a<one", "two"]);
  });

  it("a label wrapped onto the next line continues it; trailing comments stay in the label", () => {
    const src = "Plans\n├── Free\n│   full editor, 10 AI actions\n└── Pro      # the paid tier\n";
    const t = parse(src);
    expect(labelOf(t)).toEqual(["Plans", "Free full editor, 10 AI actions", "Pro # the paid tier"]);
    expect(spans(t, src)[1]).toBe("Free\n│   full editor, 10 AI actions");
  });

  it("tabs and CRLF keep columns and offsets right", () => {
    const src = "root\r\n├──\ta\r\n│\t└── b\r\n└── c\r\n";
    const t = parse(src);
    expect(edges(t)).toEqual(["root", "a<root", "b<a", "c<root"]);
    expect(spans(t, src)).toEqual(["root", "a", "b", "c"]);
  });

  it("emoji and non-Latin labels", () => {
    expect(labelOf(parse("📁 项目\n├── 📄 说明.md\n└── 🧪 テスト"))).toEqual(["📁 项目", "📄 说明.md", "🧪 テスト"]);
  });
});

describe("box (top-down) trees", () => {
  it("the pricing fixture's business model: labels under branches, a label wrapping over three lines", () => {
    const t = parse(BUSINESS_MODEL);
    expect(t.style).toBe("box");
    expect(edges(t)).toEqual([
      "ACUTE",
      "FREE<ACUTE",
      "Full editor/canvas\nFull basic features\n10 AI actions/month<FREE",
      "PAID<ACUTE",
      "PRO<PAID",
      "Subscription<PRO",
      "LIFETIME<PAID",
      "BYOK<LIFETIME",
    ]);
    expect(t.notes).toEqual([]);
    const s = spans(t, BUSINESS_MODEL);
    expect(s.filter((_, i) => i !== 2)).toEqual(["ACUTE", "FREE", "PAID", "PRO", "Subscription", "LIFETIME", "BYOK"]);
    expect(s[2]!.startsWith("Full editor/canvas")).toBe(true);
    expect(s[2]!.endsWith("10 AI actions/month")).toBe(true);
  });

  it("an org chart of boxed labels, three reports through ┼", () => {
    const src = [
      "              ┌───────────┐",
      "              │    CEO    │",
      "              └─────┬─────┘",
      "      ┌─────────────┼─────────────┐",
      "  ┌───┴───┐     ┌───┴───┐     ┌───┴───┐",
      "  │  CTO  │     │  CFO  │     │  COO  │",
      "  └───┬───┘     └───────┘     └───────┘",
      "   ┌──┴───┐",
      "  Web    Data",
    ].join("\n");
    const t = parse(src);
    expect(edges(t)).toEqual(["CEO", "CTO<CEO", "Web<CTO", "Data<CTO", "CFO<CEO", "COO<CEO"]);
    expect(spans(t, src)).toEqual(["CEO", "CTO", "Web", "Data", "CFO", "COO"]);
  });

  it("a two-line boxed label", () => {
    const src = "    ┌──────────┐\n    │ Platform │\n    │  (core)  │\n    └────┬─────┘\n    ┌────┴────┐\n   API       SDK\n";
    expect(edges(parse(src))).toEqual(["Platform\n(core)", "API<Platform\n(core)", "SDK<Platform\n(core)"]);
  });

  it("ASCII +--+ branches with [ bracketed ] labels; ASCII boxes", () => {
    const src = "        root\n         |\n   +-----+-----+\n   |     |     |\n [ a ] [ b ]  [ c ]\n";
    const t = parse(src);
    expect(edges(t)).toEqual(["root", "a<root", "b<root", "c<root"]);
    expect(spans(t, src)).toEqual(["root", "[ a ]", "[ b ]", "[ c ]"]);
    const boxes = "   +-------+\n   | Store |\n   +---+---+\n       |\n  +----+----+\n  |         |\n+----+    +-----+\n| Web|    | App |\n+----+    +-----+\n";
    expect(edges(parse(boxes))).toEqual(["Store", "Web<Store", "App<Store"]);
  });

  it("stems without a │ (corners right under the label, ▼ heads) and hyphenated labels", () => {
    const src = "     Sign-up\n   ┌────┴────┐\n   ▼         ▼\n Email     Google\n";
    expect(edges(parse(src))).toEqual(["Sign-up", "Email<Sign-up", "Google<Sign-up"]);
    const flowTree = "        ┌─────────┐\n        │ Request │\n        └────┬────┘\n      ┌──────┴──────┐\n      ▼             ▼\n  ┌───────┐     ┌───────┐\n  │ Cache │     │  DB   │\n  └───────┘     └───────┘\n";
    expect(edges(parse(flowTree))).toEqual(["Request", "Cache<Request", "DB<Request"]);
  });

  it("a stem one column past a short label still attaches", () => {
    expect(edges(parse("  AB\n    │\n ┌──┴──┐\n X     Y\n"))).toEqual(["AB", "X<AB", "Y<AB"]);
  });

  it("a caption or stray label is kept on its own, with a note", () => {
    const t = parse("  Business model\n\n      ROOT\n   ┌───┴───┐\n   A       B\n   │       │\n   A1      B1\n");
    expect(edges(t)).toEqual(["Business model", "ROOT", "A<ROOT", "A1<A", "B<ROOT", "B1<B"]);
    expect(t.notes.join()).toContain("1 label isn't connected");
  });

  it("several trees side by side", () => {
    const t = parse("    X           Y\n ┌──┴──┐     ┌──┴──┐\n x1    x2    y1    y2\n");
    expect(t.roots.map((r) => t.nodes[r]!.label)).toEqual(["X", "Y"]);
    expect(edges(t)).toEqual(["X", "x1<X", "x2<X", "Y", "y1<Y", "y2<Y"]);
  });
});

describe("not trees", () => {
  const NOT_TREES: [string, string][] = [
    ["an ASCII table", "+-------+-------+\n| Plan  | Price |\n+-------+-------+\n| Free  | 0     |\n| Pro   | 299   |\n+-------+-------+\n"],
    ["a box-drawing table", "┌──────┬───────┐\n│ Plan │ Price │\n├──────┼───────┤\n│ Free │ 0     │\n└──────┴───────┘\n"],
    ["a Markdown table", "| a | b |\n|---|---|\n| 1 | 2 |\n"],
    ["an arrow flow", "[Login] --> [Validate] --> [Token]\n"],
    ["a box flow with arrows", "┌───────┐     ┌───────┐\n│ Build │────▶│ Test  │\n└───────┘     └───────┘\n"],
    ["a vertical chain of boxes", "┌───────┐\n│ Start │\n└───┬───┘\n    │\n    ▼\n┌───────┐\n│  End  │\n└───────┘\n"],
    ["a bar chart", "Q1 ████████ 40\nQ2 ████████████ 60\nQ3 ██████ 30\n"],
    ["a sequence diagram", "Alice -> Bob: hello\nBob -> Alice: hi\n"],
    ["unicode arrows", "Idea → Draft → Review → Publish\n"],
    ["JavaScript", "function f(a, b) {\n  if (a || b) return a + b;\n  return 0 | 1;\n}\n"],
    ["a shell pipeline", "cat access.log |\n  grep 500 |\n  sort | uniq -c\n"],
    ["prose", "This is just a paragraph of text.\nIt has two lines.\n"],
    ["a bullet list", "- one\n  - two\n- three\n"],
    ["a lone box", "┌──────────┐\n│  Title   │\n└──────────┘\n"],
    ["a horizontal rule and heading", "Summary\n───────\nAll good.\n"],
    ["a box with a side branch (mixed styles)", "      ROOT\n   ┌───┴───┐\n   A       B\n   ├── a1\n   └── a2\n"],
  ];
  for (const [name, source] of NOT_TREES) {
    it(`${name} → no tree`, () => {
      const r = parseAsciiTree(source);
      expect(r.ok).toBe(false);
      expect(detectAsciiTree(source)).toBeNull();
    });
  }

  it("arrows and tables say not_a_tree; ambiguous tree-like drawings say unsupported", () => {
    const code = (s: string) => {
      const r = parseAsciiTree(s);
      return r.ok ? "ok" : r.error.code;
    };
    expect(code(NOT_TREES[0]![1])).toBe("not_a_tree");
    expect(code(NOT_TREES[3]![1])).toBe("not_a_tree");
    expect(code(NOT_TREES[4]![1])).toBe("not_a_tree");
    expect(code(NOT_TREES[5]![1])).toBe("not_a_tree");
    expect(code("    A\n   / \\\n  B   C\n")).toBe("unsupported");
    // Two parents merging into one child.
    expect(code("  A       B\n  │       │\n  └───┬───┘\n      C\n")).toBe("unsupported");
    // Mostly loose labels.
    expect(code("  one   two   three   four\n\n     R\n  ┌──┴──┐\n  x     y\n")).toBe("unsupported");
    expect(code(NOT_TREES[15]![1])).toBe("unsupported");
    expect(code("")).toBe("empty");
    expect(code("   \n  ")).toBe("empty");
  });
});

describe("detectAsciiTree", () => {
  it("names the style, node count and number of trees", () => {
    expect(detectAsciiTree(BUSINESS_MODEL)).toEqual({ style: "box", nodes: 8, trees: 1 });
    expect(detectAsciiTree("a\n├── b\n└── c\nd\n└── e")).toEqual({ style: "indented", nodes: 5, trees: 2 });
  });

  it("rejects a tree over the node limit, and oversized input", () => {
    const big = ["root", ...Array.from({ length: 60 }, (_, i) => `├── n${i}`)].join("\n");
    expect(detectAsciiTree(big)).toBeNull();
    expect(detectAsciiTree(`root\n└── ${"x".repeat(20_001)}`)).toBeNull();
  });

  it("never throws on junk", () => {
    const junk = ["├", "└──", "│\n│\n│", "┌┐\n└┘", "+", "|--|--|", "`--", "\\--\n\\--", "┼┼┼\n┼┼┼", "[", "]]]", "─".repeat(500), "│ ".repeat(300), "\u0000\u0001"];
    for (const j of junk) expect(() => detectAsciiTree(j)).not.toThrow();
    expect(parseAsciiTree(null as unknown as string)).toMatchObject({ ok: false, error: { code: "empty" } });
  });
});
