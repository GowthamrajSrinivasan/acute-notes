/**
 * Knowledge Notes WP1.5 (knowledge-notes-plan §4.4): a distil reply's `cites` and `metadata.omitted`, read leniently.
 * A missing or malformed list degrades the section to Needs review; it never fails generation, and it never changes
 * what `validateVisualPlan` keeps.
 */
import { describe, expect, it } from "vitest";
import { labelSource } from "@/ai/fidelity/sourceBlocks";
import { readDistilReply, validateVisualPlan } from "./validate";

const TEXT = [
  "Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts.",
  "",
  "Hello all, as discussed earlier today.",
  "",
  "| Case | Now |",
  "|---|---|",
  "| Timeout | retried |",
].join("\n");

const reply = (nodes: unknown[], metadata?: unknown) => ({ version: 1, template: "sectioned", nodes, relationships: [], ...(metadata !== undefined ? { metadata } : {}) });
const card = (id: string, cites?: unknown, extra: Record<string, unknown> = {}) => ({ id, type: "text", content: { markdown: `card ${id}` }, ...(cites !== undefined ? { cites } : {}), ...extra });

describe("readDistilReply (WP1.5)", () => {
  it("maps each node's cited labels to unit ids, and each omission to its unit; a block placed by reference cites its units", async () => {
    const source = await labelSource(TEXT);
    expect(source.labels).toEqual({ "P1.1": "u1", "P1.2": "u2", "P2.1": "u3", "T1.r0": "u4", "T1.r1": "u5" });
    const out = readDistilReply(
      reply([card("n1", ["P1.1", "p1.2", "[P1.1]"]), { id: "n2", type: "source", ref: "T1" }, card("a1", undefined, { origin: "analysis" })], { omitted: [{ unit: "P2.1", reason: "filler" }] }),
      source,
    );
    expect(out).toEqual({ cites: { n1: ["u1", "u2"], n2: ["u4", "u5"] }, omitted: [{ unit: "u3", reason: "filler" }], problems: [], needsReview: false });
  });

  it("a block's own number stands for all its units, in cites and in omissions; duplicates name the unit they repeat", async () => {
    const source = await labelSource(TEXT);
    const out = readDistilReply(reply([card("n1", ["P1"]), card("n2", ["T1.R1"])], { omitted: [{ unit: "P2", reason: "meta" }, { unit: "T1.r0", reason: "duplicate", of: "T1.r1" }] }), source);
    expect(out.cites).toEqual({ n1: ["u1", "u2"], n2: ["u5"] });
    expect(out.omitted).toEqual([{ unit: "u3", reason: "meta" }, { unit: "u4", reason: "duplicate", of: "u5" }]);
    expect(out.needsReview).toBe(false);
  });

  it("no omitted list is fine when every unit is cited, and Needs review when some unit is left unaccounted", async () => {
    const source = await labelSource(TEXT);
    expect(readDistilReply(reply([card("n1", ["P1", "P2", "T1"])]), source).needsReview).toBe(false);
    const missing = readDistilReply(reply([card("n1", ["P1"])]), source);
    expect(missing.needsReview).toBe(true);
    expect(missing.problems).toEqual([`no "metadata.omitted" list, and some units are neither cited nor omitted`]);
  });

  it("malformed or missing parts degrade the section to Needs review, keeping everything usable", async () => {
    const source = await labelSource(TEXT);
    const out = readDistilReply(
      reply([card("n1", "P1.1"), card("n2", ["P1.2", 7, "Q9.9"]), card("n3"), { id: "h", type: "heading", content: { text: "Retries" } }], {
        omitted: [{ unit: "P2.1", reason: "boring" }, { unit: "Z1", reason: "filler" }, { unit: "T1.r0", reason: "duplicate", of: "X3" }, "P2.1"],
      }),
      source,
    );
    expect(out.needsReview).toBe(true);
    expect(out.cites).toEqual({ n2: ["u2"] });
    expect(out.omitted).toEqual([{ unit: "u4", reason: "duplicate" }]);
    expect(out.problems).toEqual([
      `node "n1": "cites" isn't a list of unit labels`,
      `node "n2": "cites" isn't a list of unit labels`,
      `node "n2": cites "Q9.9", which isn't a unit of this section`,
      `node "n3" cites no source unit`,
      `omission 0: not a {"unit", "reason"} with one of the listed reasons`,
      `omission 1: "Z1" isn't a unit of this section`,
      `omission 2: a duplicate of "X3", which isn't one unit of this section`,
      `omission 3: not a {"unit", "reason"} with one of the listed reasons`,
    ]);
    expect(readDistilReply(reply([card("n1", ["P1"])], { omitted: "none" }), source).problems).toEqual([`"metadata.omitted" isn't a list`]);
  });

  it("never throws: a reply with no nodes is all Needs review", async () => {
    const source = await labelSource(TEXT);
    for (const raw of [null, "text", { nodes: "x" }, []]) {
      expect(readDistilReply(raw, source)).toEqual({ cites: {}, omitted: [], problems: ["the reply has no nodes to read citations from"], needsReview: true });
    }
  });

  it("validateVisualPlan keeps neither field, so a plan is the same with or without them", async () => {
    const plain = reply([card("n1")], { title: "T" });
    const distil = reply([card("n1", ["P1.1"])], { title: "T", omitted: [{ unit: "P2.1", reason: "filler" }] });
    expect(validateVisualPlan(distil)).toEqual(validateVisualPlan(plain));
  });
});
