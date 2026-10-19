/**
 * The acceptance gate for where unsure parts are placed, on the real layout D merge (three ChatGPT chats, Jev's per-part answers
 * recorded 2026-10-10; `__fixtures__/layoutDPlacement.json`: headings, sizes, confidences and the local answers, no chat text).
 * No model call and no network. See `.ai/docs/decision-spike/chat-import-live-2026-10-09.md`, "Placement review".
 *
 * On layout D every answer section sits under the chat's own title, and the title's own text is a part. The old rules followed that
 * "parent" and put **all 46 unsure sections into the chat-title topic**: a catch-all that grows past `MAX_UNIT_CHARS` and recreates the
 * regenerate-everything bug. Now a document root is no parent or sibling group (`unsure.ts`), and a part no rule can place is
 * **unplaced**: kept whole as a section of its own and named in the review.
 *
 * Gate (one line each): root-title handling · no oversized catch-all · nothing silently dropped · unresolved parts reviewable (the
 * "unplaced" outcome) · small fragments keep a real parent · existing dedup/provenance/conflict tests stay green.
 */
import { describe, expect, it } from "vitest";
import { MAX_UNIT_CHARS, type AnalysisUnit } from "@/ai/reconcile/units";
import type { Assignment } from "./assign";
import fixture from "./__fixtures__/layoutDPlacement.json";
import { mergeNotices } from "./merge";
import type { MergeReport } from "./compose";
import { parentOf, settleUnsure } from "./unsure";

const MIN_CONFIDENCE = 0.5; // ASSIGN_MIN_CONFIDENCE in assign.ts

type FixturePart = { key: string; chars: number; confidence: number; choice: string | null; local: string | null };
const fixtureParts = fixture.parts as FixturePart[];
const topicChars = new Map(fixture.topics.map((t) => [t.key, t.chars]));

const unit = (key: string): AnalysisUnit => ({ key, text: "x", span: { start: 0, end: 0 } });

/** The assignment as `validateAssignment` builds it: the local answer, overwritten by every confident model answer. */
function layoutD() {
  const parts = fixtureParts.map((p) => unit(p.key));
  const local: Assignment = new Map(fixtureParts.map((p) => [p.key, p.local]));
  const assignment: Assignment = new Map(local);
  const unsure = new Set<string>();
  for (const p of fixtureParts) {
    if (p.confidence < MIN_CONFIDENCE) unsure.add(p.key);
    else assignment.set(p.key, p.choice);
  }
  return { parts, local, assignment, unsure, settled: settleUnsure(parts, assignment, unsure, local) };
}

/** Document roots: top-level parts with a real run of answer sections under them (the chat titles). */
const roots = (keys: string[]) => keys.filter((k) => !k.includes(" › ") && keys.filter((o) => parentOf(o) === k).length >= 5);

describe("placement of unsure parts on the real layout D merge", () => {
  const { parts, unsure, settled } = layoutD();
  const keys = parts.map((p) => p.key);

  it("the sample is what was recorded: 116 parts, 46 of them unsure, under two chat titles", () => {
    expect(keys).toHaveLength(116);
    expect(unsure.size).toBe(46);
    expect(roots(keys)).toHaveLength(2);
  });

  // GATE 1 — root-title handling
  it("no unsure section is placed in the topic of the chat title it sits under", () => {
    for (const root of roots(keys)) {
      const rootTopic = settled.assignment.get(root) ?? null;
      const dumped = [...unsure].filter((k) => parentOf(k) === root && rootTopic !== null && settled.assignment.get(k) === rootTopic);
      expect(dumped, `unsure sections that followed "${root}" into its topic`).toHaveLength(0);
    }
  });

  // GATE 2 — no oversized catch-all
  it("no existing topic is grown past the unit limit by uncertain placement", () => {
    const added = new Map<string, number>();
    for (const k of unsure) {
      const topic = settled.assignment.get(k);
      if (topic) added.set(topic, (added.get(topic) ?? 0) + fixtureParts.find((p) => p.key === k)!.chars);
    }
    const over = [...added].filter(([topic, chars]) => (topicChars.get(topic) ?? 0) + chars > MAX_UNIT_CHARS);
    expect(over, `topics pushed past ${MAX_UNIT_CHARS} characters by unsure parts`).toEqual([]);
  });

  // GATE 3 — nothing silently dropped
  it("every unsure part is settled and accounted for: a topic, or a new topic it names or joins", () => {
    for (const k of unsure) {
      expect(settled.how.has(k), `${k} has no placement`).toBe(true);
      expect(settled.assignment.has(k), `${k} is missing from the assignment`).toBe(true);
      const topic = settled.assignment.get(k);
      if (topic === null) expect(settled.how.get(k) === "unplaced" || settled.attach.has(k), `${k} became a new topic without being named`).toBe(true);
    }
    // and the confident answers are untouched
    for (const p of fixtureParts.filter((p) => p.confidence >= MIN_CONFIDENCE)) expect(settled.assignment.get(p.key) ?? null).toBe(p.choice);
  });

  // GATE 4 — unresolved parts reviewable
  it("a part that stays unresolved is left unplaced and the review names how many and which", () => {
    const left = [...unsure].filter((k) => settled.how.get(k) === "unplaced");
    // Offline there are no subsections to refine and no confidence floor (see the evidence doc): no rule places any of the 46.
    expect(left).toHaveLength(46);
    expect([...settled.unplaced].sort()).toEqual([...left].sort());
    for (const k of left) expect(settled.assignment.get(k), `${k} was filed under a topic`).toBeNull();
    const report = { mergedInto: {}, newTopics: [], skippedBlocks: 0, skippedParts: [], repeatedElsewhere: 0, overlaps: [], nothingNew: [], choices: [], extended: [], reopened: [], keptWith: {}, unsure: [], unplaced: left, refined: [], economy: [] } satisfies MergeReport;
    const notices = mergeNotices(report);
    expect(notices.find((n) => n.startsWith("Merged:"))).toBe("Merged: 46 passages left unplaced.");
    expect(notices.some((n) => n.startsWith("AI couldn't place 46 passages in your topics") && n.includes("and 40 more") && n.includes("at the end of your notes"))).toBe(true);
  });

  it("how the 46 were settled, by rule: none by parent, siblings or grouping (the root is not a topic); none by the local match", () => {
    const by = new Map<string, number>();
    for (const k of unsure) by.set(settled.how.get(k)!, (by.get(settled.how.get(k)!) ?? 0) + 1);
    expect(Object.fromEntries(by)).toEqual({ unplaced: 46 });
  });
});

describe("small fragments under a real topical section keep their context (must keep holding)", () => {
  it("'Free' and 'Pro' under a 'Pricing' section follow where Pricing went", () => {
    const keys = ["Pricing", "Pricing › Free", "Pricing › Pro", "Roadmap"];
    const parts = keys.map(unit);
    const assignment: Assignment = new Map([["Pricing", "Plans"], ["Pricing › Free", null], ["Pricing › Pro", null], ["Roadmap", "Timeline"]]);
    const out = settleUnsure(parts, assignment, new Set(["Pricing › Free", "Pricing › Pro"]), new Map());
    expect(out.assignment.get("Pricing › Free")).toBe("Plans");
    expect(out.assignment.get("Pricing › Pro")).toBe("Plans");
    expect(out.how.get("Pricing › Free")).toBe("parent");
  });
});
