import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createParser, type ElementNode } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { acuteCardLibrary } from "./library";
import { cardOf, splitCards } from "./notesTask";
import { propOrders, toPositional } from "./positional";

const schema = acuteCardLibrary.toJSONSchema();
const orders = propOrders(schema);
const parse = (lang: string) => createParser(schema).parse(lang);

describe("toPositional", () => {
  it("reorders keyword arguments into the component's prop order, nulls for gaps, nested calls too", () => {
    expect(toPositional('root = IdeaCard(body="B", title="T", detail="D", citations=[CitationChip(unit="u1")])', orders)).toBe(
      'root = IdeaCard("T", "B", null, [CitationChip("u1")], "D")',
    );
  });

  it("leaves positional calls, strings with = and ( inside, and unknown calls alone", () => {
    const lang = 'root = IdeaCard("a = b (c)", "x=y")\nc1 = Mystery(k="v")';
    expect(toPositional(lang, orders)).toBe(lang);
  });

  it("keeps leading positional args, drops unknown keywords", () => {
    expect(toPositional('root = Callout("warning", text="careful", colour="red")', orders)).toBe('root = Callout("warning", "careful")');
  });

  it("leaves a call that hasn't closed yet (mid-stream) untouched", () => {
    expect(toPositional('root = IdeaCard(title="T", body="B', orders)).toBe('root = IdeaCard(title="T", body="B');
  });
});

describe("the live gemini-2.5-flash reply (2026-11-13), keyword arguments throughout", () => {
  const text = readFileSync(fileURLToPath(new URL("./__fixtures__/gemini-2.5-flash-keyword-args.txt", import.meta.url)), "utf8");

  it("parsed raw, every block lost its root", () => {
    const raw = text.split(/^\s*---\s*$/m).map((b) => b.trim()).filter(Boolean);
    expect(raw).toHaveLength(4);
    expect(raw.map((b) => parse(b).root)).toEqual([null, null, null, null]);
  });

  it("after splitCards, all four are clean IdeaCards with their citations and extras", () => {
    const blocks = splitCards(text);
    const units = new Set(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"]);
    for (const b of blocks) expect(parse(b).meta.errors).toEqual([]);
    const cards = blocks.map((b, i) => cardOf(b, i, units));
    expect(cards.map((c) => c?.title)).toEqual([
      "Idempotency Keys Prevent Duplicate Operations",
      "Server Returns Stored Results for Duplicate Requests",
      "Idempotency Keys Have a Limited Lifespan",
      "Idempotency Keys Do Not Validate Request Content",
    ]);
    expect(cards.map((c) => c?.cites)).toEqual([["u1"], ["u2", "u5"], ["u6", "u7"], ["u8", "u9"]]);
    expect(cards[2]!.detail).toMatch(/expire after 24 hours/);
    const extras = parse(blocks[3]!).root!.props.extras as ElementNode[];
    expect(extras.map((x) => [x.typeName, x.props.tone])).toEqual([["Callout", "warning"]]);
  });
});
