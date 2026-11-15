import { describe, expect, it } from "vitest";
import { parseContent } from "@/ai/content/parser";
import { nextPathIds } from "@/ai/reconcile/topicIds";
import type { Lineage, LineageEntry, SourceUnit, UnitSet } from "./contracts";
import { MOVED_OVERLAP, SAME_TOPIC_OVERLAP, matchVersions, splitUnits, wordOverlap } from "./sourceUnits";

const texts = (set: UnitSet) => set.units.map((u) => u.text);
const unit = (set: UnitSet, text: string): SourceUnit => {
  const found = set.units.filter((u) => u.text === text);
  if (found.length !== 1) throw new Error(`expected one unit "${text}", found ${found.length}`);
  return found[0]!;
};
const entryTo = (lineage: Lineage, id: string): LineageEntry | undefined => lineage.entries.find((e) => e.to === id);
const states = (lineage: Lineage) => lineage.entries.map((e) => e.state);

async function update(before: string, after: string, options: { pathIds?: boolean } = {}) {
  const v1 = await splitUnits(before);
  const pathIds = options.pathIds ? nextPathIds(undefined, await parseContent(before), before, await parseContent(after), after) : undefined;
  const { units: v2, lineage } = await matchVersions({ ...v1, version: 1 }, { text: after, version: 2, pathIds });
  return { v1, v2, lineage };
}

describe("splitUnits", () => {
  it("splits paragraphs into sentences, items, rows, code and quotes, with opaque ids in document order", async () => {
    const doc = [
      "Intro before any heading has two sentences. It sets the scene.",
      "",
      "# Launch plan",
      "",
      "## Risks",
      "",
      "The gateway may time out under heavy load. Retries use exponential backoff.",
      "",
      "- [x] Payments team owns the rollout",
      "- Ops team owns monitoring",
      "  - Alerts page the on-call engineer",
      "",
      "| Service | Owner |",
      "| --- | --- |",
      "| Gateway | Payments |",
      "| Ledger | Finance |",
      "",
      "```ts",
      "const retries = 3. Then more;",
      "callGateway(retries);",
      "```",
      "",
      "> Quoted advice is kept whole here. A second quoted sentence follows.",
      "> Third quoted line of text.",
      "",
    ].join("\n");
    const set = await splitUnits(doc);
    expect(set.units.map((u) => [u.kind, u.text])).toEqual([
      ["sentence", "Intro before any heading has two sentences."],
      ["sentence", "It sets the scene."],
      ["sentence", "The gateway may time out under heavy load."],
      ["sentence", "Retries use exponential backoff."],
      ["list_item", "Payments team owns the rollout"],
      ["list_item", "Ops team owns monitoring"],
      ["list_item", "Alerts page the on-call engineer"],
      ["table_row", "Service | Owner"],
      ["table_row", "Gateway | Payments"],
      ["table_row", "Ledger | Finance"],
      ["code", "const retries = 3. Then more;\ncallGateway(retries);"],
      ["quote", "Quoted advice is kept whole here."],
      ["quote", "A second quoted sentence follows."],
      ["quote", "Third quoted line of text."],
    ]);
    expect(set.units.map((u) => u.id)).toEqual(set.units.map((_, i) => `u${i + 1}`));
    expect(set.nextId).toBe(set.units.length + 1);
    expect(set.units[0]!.topic).toBe("");
    expect(set.units[2]!.topic).toBe("Launch plan › Risks");
    for (const u of set.units) expect(u.id).not.toMatch(/Launch|Risks/);
    // Neighbours.
    expect(set.units[0]!.prev).toBeUndefined();
    expect(set.units[0]!.next).toBe("u2");
    expect(set.units[13]!.prev).toBe("u13");
    expect(set.units[13]!.next).toBeUndefined();
  });

  it("gives spans that slice back to each unit's text (a table row: to its cells)", async () => {
    const doc = "# A\n\nOne **bold** sentence here. Then `code.path` follows here!\n\n1. First item text\n   continues here\n\n   More of the first item.\n2. Second item\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> Quote line one is here.\n> Quote line two is here.\n\n```\nprint(1)\n```\n";
    const set = await splitUnits(doc);
    expect(set.units.length).toBeGreaterThan(5);
    for (const u of set.units) {
      const slice = doc.slice(u.span.start, u.span.end);
      if (u.kind === "table_row") {
        expect(slice.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" | ")).toBe(u.text);
      } else expect(slice).toBe(u.text);
    }
    expect(unit(set, "First item text\n   continues here\n\n   More of the first item.").kind).toBe("list_item");
  });

  it("makes a table row and a code block one unit each", async () => {
    const set = await splitUnits("| Step | Detail |\n|---|---|\n| Build | Run the build. Then test it. |\n\n```\nline one. Line two.\nline three.\n```\n");
    expect(set.units.map((u) => u.kind)).toEqual(["table_row", "table_row", "code"]);
    expect(set.units[1]!.text).toBe("Build | Run the build. Then test it.");
  });

  it("joins a fragment with fewer than two significant words to its neighbour", async () => {
    const set = await splitUnits("Yes. The gateway times out under heavy load. Indeed.\n");
    expect(texts(set)).toEqual(["Yes. The gateway times out under heavy load. Indeed."]);
  });

  it("joins hard-wrapped lines: one unit per sentence, spans covering every line", async () => {
    const doc = "# Notes\n\nThe gateway may time out under heavy load during\nthe launch window. Retries use exponential backoff\nwith jitter, and the operations team is paged\nafter three failures.\nA new line that starts a sentence stays apart.\n\n> Quoted text keeps\n> its own lines here.\n";
    const set = await splitUnits(doc);
    expect(set.units.map((u) => [u.kind, u.text])).toEqual([
      ["sentence", "The gateway may time out under heavy load during\nthe launch window."],
      ["sentence", "Retries use exponential backoff\nwith jitter, and the operations team is paged\nafter three failures."],
      ["sentence", "A new line that starts a sentence stays apart."],
      ["quote", "Quoted text keeps"],
      ["quote", "its own lines here."],
    ]);
    for (const u of set.units) expect(doc.slice(u.span.start, u.span.end)).toBe(u.text);
  });

  it("is deterministic and honours firstId", async () => {
    const doc = "# A\n\nFirst sentence is here. Second sentence is here.\n";
    expect(await splitUnits(doc)).toEqual(await splitUnits(doc));
    const set = await splitUnits(doc, { firstId: 40 });
    expect(set.units.map((u) => u.id)).toEqual(["u40", "u41"]);
    expect(set.nextId).toBe(42);
  });

  it("maps the topic through pathIds", async () => {
    const set = await splitUnits("# Hazards\n\nThe gateway may time out.\n", { pathIds: { Hazards: "Risks" } });
    expect(set.units[0]!.topic).toBe("Risks");
  });

  it("names its thresholds", () => {
    expect(SAME_TOPIC_OVERLAP).toBe(0.8);
    expect(MOVED_OVERLAP).toBe(0.9);
    expect(wordOverlap("gateway times heavy load", "gateway times heavy traffic load")).toBeCloseTo(0.8);
  });
});

const DOC = [
  "# Launch",
  "",
  "## Risks",
  "",
  "The gateway may time out under heavy load. Retries use exponential backoff with jitter.",
  "",
  "## Owners",
  "",
  "The payments team owns the rollout schedule. The operations team watches the dashboards.",
  "",
].join("\n");

describe("matchVersions: the §7.1 identity matrix", () => {
  it("keeps every id when nothing changed, run after run", async () => {
    const { v1, v2, lineage } = await update(DOC, DOC);
    expect(v2).toEqual(v1);
    expect(states(lineage)).toEqual(v1.units.map(() => "unchanged"));
    expect(lineage).toMatchObject({ fromVersion: 1, toVersion: 2 });
    const { units: v3 } = await matchVersions({ ...v2, version: 2 }, { text: DOC, version: 3 });
    expect(v3).toEqual(v1);
  });

  it("re-wrapping a paragraph at another width keeps every id unchanged", async () => {
    const prose =
      "The gateway may time out under heavy load during the launch window. Retries use exponential backoff with jitter, and the operations team is paged after three failures. Dashboards show the error rate per region.";
    const wrap = (width: number) => {
      const lines: string[] = [];
      let line = "";
      for (const w of prose.split(" ")) {
        if (line && line.length + 1 + w.length > width) {
          lines.push(line);
          line = w;
        } else line = line ? `${line} ${w}` : w;
      }
      return [...lines, line].join("\n");
    };
    const narrow = `# Notes\n\n${wrap(40)}\n`;
    const wide = `# Notes\n\n${wrap(72)}\n`;
    expect(narrow).not.toBe(wide);
    const { v1, v2, lineage } = await update(narrow, wide);
    expect(v1.units).toHaveLength(3);
    expect(v2.units.map((u) => u.id)).toEqual(v1.units.map((u) => u.id));
    expect(v2.units.map((u) => u.hash)).toEqual(v1.units.map((u) => u.hash));
    expect(states(lineage)).toEqual(["unchanged", "unchanged", "unchanged"]);
    const { v2: flat } = await update(narrow, `# Notes\n\n${prose}\n`);
    expect(flat.units.map((u) => u.id)).toEqual(v1.units.map((u) => u.id));
  });

  it("insert a sentence at the top: no other id changes", async () => {
    const after = DOC.replace("# Launch\n", "A brand new opening sentence appears right here.\n\n# Launch\n");
    const { v1, v2, lineage } = await update(DOC, after);
    for (const u of v1.units) expect(unit(v2, u.text).id).toBe(u.id);
    const added = unit(v2, "A brand new opening sentence appears right here.");
    expect(added.id).toBe(`u${v1.nextId}`);
    expect(entryTo(lineage, added.id)).toEqual({ state: "added", to: added.id });
    expect(states(lineage).filter((s) => s !== "unchanged")).toEqual(["added"]);
  });

  it("reword a sentence: same id, changed", async () => {
    const after = DOC.replace("under heavy load", "under heavy traffic load");
    const { v1, v2, lineage } = await update(DOC, after);
    const before = unit(v1, "The gateway may time out under heavy load.");
    const now = unit(v2, "The gateway may time out under heavy traffic load.");
    expect(now.id).toBe(before.id);
    expect(entryTo(lineage, now.id)).toEqual({ state: "changed", from: before.id, to: now.id });
    expect(states(lineage).filter((s) => s !== "unchanged")).toEqual(["changed"]);
  });

  it("a reword without an agreeing neighbour or enough overlap gets a new id", async () => {
    const doc = "# A\n\nThe gateway may time out under heavy load.\n";
    const { v1, v2, lineage } = await update(doc, "# A\n\nThe gateway sometimes stalls under very heavy load spikes.\n");
    expect(v2.units[0]!.id).not.toBe(v1.units[0]!.id);
    expect(states(lineage)).toEqual(["added", "removed"]);
  });

  it("rename a heading: same ids, not moved (with the version's pathIds)", async () => {
    const after = DOC.replace("## Risks", "## Hazards");
    const { v1, v2, lineage } = await update(DOC, after, { pathIds: true });
    expect(v2.units.map((u) => u.id)).toEqual(v1.units.map((u) => u.id));
    expect(v2.units.map((u) => u.topic)).toEqual(v1.units.map((u) => u.topic));
    expect(lineage.entries.every((e) => e.state === "unchanged" && !e.moved)).toBe(true);
  });

  it("rename a heading without pathIds: same ids, reported as moved", async () => {
    const { v1, v2, lineage } = await update(DOC, DOC.replace("## Risks", "## Hazards"));
    expect(v2.units.map((u) => u.id)).toEqual(v1.units.map((u) => u.id));
    expect(lineage.entries.filter((e) => e.moved).map((e) => e.to)).toEqual(v1.units.slice(0, 2).map((u) => u.id));
  });

  it("split a section in two: ids follow their text", async () => {
    const before = "# Setup\n\nInstall the command line tools first. Then clone the repository locally. Configure the access token next. Finally run the smoke tests.\n";
    const after = "# Install\n\nInstall the command line tools first. Then clone the repository locally.\n\n# Configure\n\nConfigure the access token next. Finally run the smoke tests.\n";
    const { v1, v2, lineage } = await update(before, after, { pathIds: true });
    for (const u of v1.units) expect(unit(v2, u.text).id).toBe(u.id);
    expect(states(lineage)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
  });

  it("move a paragraph to another section: same ids, unchanged, moved", async () => {
    const para = "The gateway may time out under heavy load. Retries use exponential backoff with jitter.";
    const after = DOC.replace(`${para}\n\n`, "").replace("watches the dashboards.", `watches the dashboards.\n\n${para}`);
    const { v1, v2, lineage } = await update(DOC, after);
    for (const u of v1.units) expect(unit(v2, u.text).id).toBe(u.id);
    const moved = unit(v2, "The gateway may time out under heavy load.");
    expect(moved.topic).toBe("Launch › Owners");
    expect(entryTo(lineage, moved.id)).toEqual({ state: "unchanged", from: moved.id, to: moved.id, moved: true });
  });

  it("move and edit: same id, changed, moved", async () => {
    const sentence = "The payment gateway retries failed charges three times before alerting the operations team on call.";
    const before = `# Risks\n\nThe ledger is the source of truth.\n\n${sentence}\n\n# Owners\n\nFinance owns the ledger reconciliation.\n`;
    const after = `# Risks\n\nThe ledger is the source of truth.\n\n# Owners\n\nFinance owns the ledger reconciliation.\n\nAn unrelated new note sits here now.\n\n${sentence.replace("three", "four")}\n`;
    const { v1, v2, lineage } = await update(before, after);
    const was = unit(v1, sentence);
    const now = unit(v2, sentence.replace("three", "four"));
    expect(now.id).toBe(was.id);
    expect(entryTo(lineage, now.id)).toEqual({ state: "changed", from: was.id, to: now.id, moved: true });
  });

  it("two equally good moved-and-edited candidates: ambiguous, never chosen", async () => {
    const s = (n: string) => `The payment gateway retries failed charges ${n} times before alerting the operations team on call.`;
    const before = `# A\n\n${s("three")}\n\n# B\n\n${s("four")}\n`;
    const after = `# C\n\n${s("five")}\n`;
    const { v1, v2, lineage } = await update(before, after);
    expect(lineage.entries).toEqual([{ state: "ambiguous", to: v2.units[0]!.id, candidates: v1.units.map((u) => u.id) }]);
    expect(v2.units[0]!.id).toBe(`u${v1.nextId}`);
  });

  const DUPS = "# Steps\n\nAlpha step starts the run. Check the logs carefully. Beta step follows next. Check the logs carefully. Gamma step ends the run. Check the logs carefully.\n";

  it("repeated identical sentences: stable ids, also after an insert", async () => {
    const after = DUPS.replace("Alpha step", "Setup comes before everything else. Alpha step");
    const { v1, v2, lineage } = await update(DUPS, after);
    const old = v1.units.filter((u) => u.text === "Check the logs carefully.").map((u) => u.id);
    const now = v2.units.filter((u) => u.text === "Check the logs carefully.").map((u) => u.id);
    expect(now).toEqual(old);
    expect(states(lineage).filter((s) => s !== "unchanged")).toEqual(["added"]);
  });

  it("delete one of three duplicates: the other two keep theirs", async () => {
    const after = DUPS.replace("Beta step follows next. Check the logs carefully. ", "Beta step follows next. ");
    const { v1, v2, lineage } = await update(DUPS, after);
    const old = v1.units.filter((u) => u.text === "Check the logs carefully.").map((u) => u.id);
    const now = v2.units.filter((u) => u.text === "Check the logs carefully.").map((u) => u.id);
    expect(now).toEqual([old[0], old[2]]);
    expect(lineage.entries.filter((e) => e.state === "removed").map((e) => e.from)).toEqual([old[1]]);
    expect(states(lineage).filter((s) => s !== "unchanged")).toEqual(["removed"]);
  });

  it("delete one of three duplicates with its neighbour: ambiguous where both readings fit, never swapped", async () => {
    // "Alpha D Gamma D" can come from deleting "D Beta" or "Beta D": the first D is either old one.
    const after = DUPS.replace("Beta step follows next. Check the logs carefully. ", "");
    const { v1, v2, lineage } = await update(DUPS, after);
    const old = v1.units.filter((u) => u.text === "Check the logs carefully.").map((u) => u.id);
    const [first, last] = v2.units.filter((u) => u.text === "Check the logs carefully.");
    expect(entryTo(lineage, first!.id)).toEqual({ state: "ambiguous", to: first!.id, candidates: [old[0], old[1]] });
    expect(old).not.toContain(first!.id);
    expect(last!.id).toBe(old[2]);
    expect(lineage.entries.filter((e) => e.state === "removed").map((e) => e.from)).toEqual([unit(v1, "Beta step follows next.").id]);
  });

  it("delete one of three consecutive duplicates: pairs from the anchored ends, never swapped", async () => {
    const before = "Start here with context. Check the logs. Check the logs. Check the logs. Finish with the summary.\n";
    const after = "Start here with context. Check the logs. Check the logs. Finish with the summary.\n";
    const { v1, v2, lineage } = await update(before, after);
    const old = v1.units.filter((u) => u.text === "Check the logs.").map((u) => u.id);
    const now = v2.units.filter((u) => u.text === "Check the logs.");
    for (const u of now) {
      const e = entryTo(lineage, u.id)!;
      if (e.state === "unchanged") expect(old).toContain(u.id);
      else expect(e.state).toBe("ambiguous");
    }
    // Order is kept: never swapped.
    const kept = now.map((u) => old.indexOf(u.id)).filter((i) => i >= 0);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(now.map((u) => u.id)).toEqual([old[0], old[2]]);
  });

  it("a repeat whose neighbours no longer agree is ambiguous, with every candidate, and the candidates aren't removed", async () => {
    const before = "Alpha step starts the run. Check the logs carefully. Beta step follows next. Check the logs carefully.\n";
    const after = "Something entirely different opens. Check the logs carefully. Another unrelated closing line.\n";
    const { v1, v2, lineage } = await update(before, after);
    const dup = unit(v2, "Check the logs carefully.");
    const candidates = v1.units.filter((u) => u.text === "Check the logs carefully.").map((u) => u.id);
    expect(entryTo(lineage, dup.id)).toEqual({ state: "ambiguous", to: dup.id, candidates });
    expect(candidates).not.toContain(dup.id);
    const removed = lineage.entries.filter((e) => e.state === "removed").map((e) => e.from);
    expect(removed).toEqual([unit(v1, "Alpha step starts the run.").id, unit(v1, "Beta step follows next.").id]);
  });

  it("heavy rewrite: new ids, every old unit removed", async () => {
    const after = "# Launch\n\n## Risks\n\nNothing here resembles the earlier wording at all.\n\n## Owners\n\nCompletely different staffing arrangements now apply.\n";
    const { v1, v2, lineage } = await update(DOC, after);
    const oldIds = new Set(v1.units.map((u) => u.id));
    for (const u of v2.units) expect(oldIds.has(u.id)).toBe(false);
    expect(lineage.entries.filter((e) => e.state === "removed").map((e) => e.from)).toEqual([...oldIds]);
    expect(lineage.entries.filter((e) => e.state === "added")).toHaveLength(2);
  });

  it("never reuses an id across versions", async () => {
    const v1 = await splitUnits(DOC);
    const seen = new Set(v1.units.map((u) => u.id));
    const t2 = DOC.replace("Retries use exponential backoff with jitter.", "A completely new second risk appears today.");
    const { units: v2 } = await matchVersions({ ...v1, version: 1 }, { text: t2, version: 2 });
    const t3 = t2.replace("A completely new second risk appears today.", "Yet another replacement risk statement now.") + "\nAnd one more closing paragraph sentence.\n";
    const { units: v3 } = await matchVersions({ ...v2, version: 2 }, { text: t3, version: 3 });
    const fresh = (prev: UnitSet, next: UnitSet) => next.units.filter((u) => !prev.units.some((p) => p.id === u.id));
    for (const [prev, next] of [[v1, v2], [v2, v3]] as const) {
      for (const u of fresh(prev, next)) {
        expect(seen.has(u.id)).toBe(false);
        seen.add(u.id);
        expect(Number(u.id.slice(1))).toBeGreaterThanOrEqual(prev.nextId);
      }
      expect(next.nextId).toBeGreaterThanOrEqual(prev.nextId);
    }
    expect(fresh(v1, v2)).toHaveLength(1);
    expect(fresh(v2, v3)).toHaveLength(2);
  });
});
