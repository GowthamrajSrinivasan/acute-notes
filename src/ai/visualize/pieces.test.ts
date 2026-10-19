import { describe, expect, it } from "vitest";
import { mergePieceReplies, PIECE_TARGET_CHARS, SPLIT_SECTION_CHARS, splitIntoPieces } from "./pieces";

const para = (n: number, tag: string) => `${tag} ${"word ".repeat(Math.ceil(n / 5))}`.trim().slice(0, n);

describe("splitIntoPieces", () => {
  it("leaves a section within the limit as one piece, unchanged", () => {
    const text = `${para(1_000, "A")}\n\n${para(1_000, "B")}`;
    expect(splitIntoPieces(text)).toEqual([text]);
  });

  it("cuts a large section at blank lines into pieces near the target, keeping every block once and in order", () => {
    const paras = Array.from({ length: 8 }, (_, i) => para(900, `P${i + 1}`));
    const text = paras.join("\n\n");
    expect(text.length).toBeGreaterThan(SPLIT_SECTION_CHARS);
    const pieces = splitIntoPieces(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(PIECE_TARGET_CHARS + 900);
    expect(pieces.join("\n\n")).toBe(text);
  });

  it("never cuts a table or a code block, even one larger than a piece", () => {
    const table = ["| A | B |", "| - | - |", ...Array.from({ length: 120 }, (_, i) => `| row ${i} | ${"x".repeat(30)} |`)].join("\n");
    const code = ["```ts", "const a = 1;", "", "", `const b = "${"y".repeat(3_500)}";`, "```"].join("\n");
    const text = [para(2_000, "Intro"), table, para(2_000, "Middle"), code, para(2_000, "End")].join("\n\n");
    const pieces = splitIntoPieces(text);
    expect(pieces.some((p) => p.includes(table))).toBe(true);
    expect(pieces.some((p) => p.includes(code))).toBe(true);
    expect(pieces.join("\n\n")).toBe(text);
  });

  it("cuts one long paragraph at line boundaries, and folds a tiny tail into the piece before it", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i} ${"z".repeat(70)}`);
    const text = `${lines.join("\n")}\n\ntail`;
    const pieces = splitIntoPieces(text);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.at(-1)).toContain("tail");
    expect(pieces.at(-1)!.length).toBeGreaterThan("tail".length);
    expect(pieces.join("\n").replace(/\n+/g, "\n")).toBe(text.replace(/\n+/g, "\n"));
  });
});

describe("mergePieceReplies", () => {
  it("keeps ids and stable keys apart per piece and relationships on their own piece's nodes", () => {
    const piece = (label: string) => ({
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "n1", type: "shape", stableKey: "step#1", content: { shape: "rectangle", label: `${label} one` } },
        { id: "n2", type: "shape", stableKey: "step#2", content: { shape: "rectangle", label: `${label} two` } },
      ],
      relationships: [{ from: "n1", to: "n2", type: "flows_to" }],
    });
    const merged = mergePieceReplies([piece("A"), piece("B")]) as { nodes: { id: string; stableKey: string }[]; relationships: { from: string; to: string }[] };
    expect(new Set(merged.nodes.map((n) => n.id)).size).toBe(4);
    expect(new Set(merged.nodes.map((n) => n.stableKey)).size).toBe(4);
    const ids = new Set(merged.nodes.map((n) => n.id));
    expect(merged.relationships).toHaveLength(2);
    for (const r of merged.relationships) {
      expect(ids.has(r.from)).toBe(true);
      expect(ids.has(r.to)).toBe(true);
    }
    expect(merged.relationships[0]!.from).not.toBe(merged.relationships[1]!.from);
  });
});
