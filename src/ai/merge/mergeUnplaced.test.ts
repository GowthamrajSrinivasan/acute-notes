/**
 * Placement of unsure parts through the whole merge (mock model; no network): a document title is no topic, a part AI can't place is
 * refined at subsection level, else left unplaced — kept in full as its own section and named in the review — and no text is lost.
 */
import { describe, expect, it } from "vitest";
import type { AIRequest } from "@/ai/types";
import { AIError } from "@/ai/errors";
import type { AIRuntime } from "@/ai/runtime";
import { accepted, context, firstRun, modelReply, parse, response, runtimeWith, type Accepted } from "@/testUtils/reconcileHarness";
import { mergeIntoSource } from "./merge";
import { subsectionParts } from "./refine";
import { analysisUnits } from "@/ai/reconcile/units";
import { analyzeContent } from "@/ai/content/analyze";

const TEN = `Intro prose, no structure.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nBody of part ${i}.`).join("\n\n")}`;
/** Prose the local planner can't draw, so the first run is an AI-tier outlined source (as a chat import's is). */
const PROSE = `Intro prose about the whole system and how it fits together in practice.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nThis part explains how the system handles case ${i}. It starts from the request, checks the permissions, and then decides what to do next based on the policy. Afterwards it records the outcome so that later steps can rely on it, and it reports any problems to the operator.`).join("\n\n")}`;
const merge = (a: Accepted, text: string, runtime: AIRuntime, refineSubsections = false) =>
  mergeIntoSource({ ...a, text, refineSubsections, operationId: "op_m", title: "Merge into existing notes", context }, runtime, { parseMarkdown: parse });

/** A chat-shaped document: a `#` title with its own line, then five answer sections; the first has two subsections. */
const CHAT = [
  "# Chat about launch",
  "The chat opens with a question about launch week.",
  "## Pricing idea\n\nPricing could follow the usage of each team, with a floor.\n\n### Floor\n\nThe floor protects small teams from surprise bills.\n\n### Usage\n\nUsage is metered per workspace and rounded up daily.",
  "## Hiring plan\n\nTwo engineers join in March to cover the rollout.",
  "## Support rota\n\nSupport covers mornings; payments covers evenings and weekends.",
  "## Naming debate\n\nThe team argued about a codename for the release for an hour.",
  "## Closing thoughts\n\nShip small, measure, and revisit the plan after launch week.",
].join("\n\n") + "\n";

const KEYS = {
  title: "Chat about launch",
  pricing: "Chat about launch › Pricing idea",
  hiring: "Chat about launch › Hiring plan",
  support: "Chat about launch › Support rota",
  naming: "Chat about launch › Naming debate",
  closing: "Chat about launch › Closing thoughts",
};

/** The sentences of the document's body text (headings aside): every one must survive the merge somewhere. */
const BODY = CHAT.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

describe("mergeIntoSource — a part AI can't place", () => {
  /**
   * Topics in prompt order: (lead) = t1, Part 0 = t2, … Part 9 = t11. First question (the six parts, in order): the title's own text goes to
   * Part 0, Hiring to Part 1, Closing to Part 2, the other three are unsure. Second question (the Pricing subsections), when asked: `second`.
   */
  const run = async (second: (prompt: string) => string, refine = true) => {
    const questions: string[] = [];
    const { runtime, spy } = runtimeWith((req: AIRequest) => {
      if (req.task !== "assign_to_topics") return modelReply(req);
      questions.push(req.prompt);
      if (!req.prompt.includes("[p4]")) return response(second(req.prompt));
      return response(
        JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }, { part: "p2", topic: "unsure" }, { part: "p3", topic: "t3" }, { part: "p4", topic: "unsure" }, { part: "p5", topic: "unsure" }, { part: "p6", topic: "t4" }] }),
      );
    });
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await merge(a, CHAT, runtime, refine);
    return { r, questions, text: r.changeSet!.contentSource!.text };
  };

  it("the sections AI is unsure of are not filed under the chat title's topic, and the chat title is no group for them", async () => {
    const { r, text } = await run(() => JSON.stringify({ assignments: [{ part: "p1", topic: "unsure" }, { part: "p2", topic: "unsure" }, { part: "p3", topic: "unsure" }] }));
    // Support and Naming sit under the title, which is a document here: nothing follows it, and nothing is grouped under it.
    expect(r.report.mergedInto["Part 0"]).toEqual([KEYS.title]);
    for (const k of [KEYS.support, KEYS.naming]) expect(r.report.mergedInto["Part 0"]).not.toContain(k);
    expect(r.diagnostics.decisions.find((d) => d.part === KEYS.support)).toMatchObject({ answer: "unsure", filed: "unplaced", settled: "unplaced" });
    expect(text).toContain("## Support rota\n\nSupport covers mornings");
  });

  it("a mid-sized part nothing can place ends UNPLACED: its own section at the end, named in the review, filed under no topic, nothing lost", async () => {
    const { r, text } = await run(() => JSON.stringify({ assignments: [{ part: "p1", topic: "unsure" }, { part: "p2", topic: "unsure" }, { part: "p3", topic: "unsure" }] }));
    // Support and Naming have no subsections; the refinement of Pricing found nothing sure either, so it stays whole.
    expect(r.report.unplaced).toEqual([KEYS.pricing, KEYS.support, KEYS.naming]);
    expect(r.report.newTopics).toEqual([]); // not new topics: their topic is undecided
    expect(r.report.refined).toEqual([]);
    expect(r.report.mergedInto).toEqual({ "Part 0": [KEYS.title], "Part 1": [KEYS.hiring], "Part 2": [KEYS.closing] });
    const unplacedSection = text.slice(text.indexOf("## Pricing idea"));
    for (const heading of ["## Pricing idea", "## Support rota", "## Naming debate"]) expect(unplacedSection).toContain(heading);
    expect(r.notices.find((n) => n.startsWith("Merged:"))).toBe("Merged: added to 3 existing topics, 3 passages left unplaced.");
    const notice = r.notices.find((n) => n.startsWith("AI couldn't place"))!;
    expect(notice).toBe(
      "AI couldn't place 3 passages in your topics (“Pricing idea”, “Support rota”, “Naming debate”). They are kept in full, each as a plain card under their own heading at the end of your notes (not analysed by AI, not filed under any topic): move them where they belong, or leave them as cards of their own.",
    );
    // Content is preserved: every sentence of the new content is somewhere in the merged text.
    for (const line of BODY) expect(text, line).toContain(line);
  });

  it("subsection refinement places the part's subsections one by one; the ones still unsure stay together, unplaced", async () => {
    const { r, questions, text } = await run(() =>
      // Pieces of Pricing, in order: its own text, Floor, Usage. Floor goes to Part 3 (t5); the others are still unsure.
      JSON.stringify({ assignments: [{ part: "p1", topic: "unsure" }, { part: "p2", topic: "t5" }, { part: "p3", topic: "unsure" }] }),
    );
    expect(questions).toHaveLength(2);
    expect(questions[1]).toContain("[p2] (under “Chat about launch › Pricing idea”)\n### Floor");
    expect(r.report.refined).toEqual([KEYS.pricing]);
    expect(r.report.mergedInto["Part 3"]).toEqual([`${KEYS.pricing} › Floor`]);
    expect(text).toMatch(/Body of part 3\.\n\nThe floor protects small teams from surprise bills\./);
    // Pricing's own text and "Usage" were not sure: together, one unplaced section named for the first, the other under its own label.
    expect(r.report.unplaced).toEqual([KEYS.pricing, `${KEYS.pricing} › Usage`, KEYS.support, KEYS.naming]);
    expect(r.report.keptWith).toMatchObject({ [KEYS.pricing]: [`${KEYS.pricing} › Usage`] });
    expect(text).toMatch(/## Pricing idea\n\nPricing could follow the usage of each team, with a floor\.\n\n\*\*Usage\*\*\n\nUsage is metered per workspace/);
    expect(r.diagnostics.decisions.find((d) => d.part === `${KEYS.pricing} › Floor`)).toMatchObject({ answer: "Part 3", filed: "Part 3", settled: "refined" });
    expect(r.notices).toContain("AI couldn't place one section as a whole (“Pricing idea”), so its subsections were placed one by one. Check it in the review.");
    expect(r.diagnostics.calls.byTask["decide:assign_to_topics"]).toBe(2);
    for (const line of BODY) expect(text, line).toContain(line);
  });

  it("when every subsection is sure, nothing of the part is unplaced", async () => {
    const { r, text } = await run(() => JSON.stringify({ assignments: [{ part: "p1", topic: "t6" }, { part: "p2", topic: "t5" }, { part: "p3", topic: "new" }] }));
    expect(r.report.unplaced).toEqual([KEYS.support, KEYS.naming]);
    expect(r.report.mergedInto["Part 4"]).toEqual([KEYS.pricing]);
    expect(r.report.newTopics).toEqual([`${KEYS.pricing} › Usage`]);
    for (const line of BODY) expect(text, line).toContain(line);
  });
});

describe("subsectionParts — a part split at its own subsections", () => {
  const split = async (md: string, pick: (keys: string[]) => string) => {
    const { parsed } = await analyzeContent(md, {});
    const units = analysisUnits(parsed, md);
    const part = units.find((u) => u.key === pick(units.map((x) => x.key)))!;
    return subsectionParts(parsed, md, part);
  };

  it("its own text, then each direct subsection whole, in the part's own span", async () => {
    const pieces = await split(CHAT, () => KEYS.pricing);
    expect(pieces?.map((p) => p.key)).toEqual([KEYS.pricing, `${KEYS.pricing} › Floor`, `${KEYS.pricing} › Usage`]);
    expect(pieces![0]!.text).toBe("## Pricing idea\n\nPricing could follow the usage of each team, with a floor.");
    expect(pieces![1]!.text).toBe("### Floor\n\nThe floor protects small teams from surprise bills.");
    expect(CHAT.slice(pieces![2]!.span.start, pieces![2]!.span.end).trim()).toBe(pieces![2]!.text);
  });

  it("a heading-only own text is dropped, a part without subsections or a title's own text is not split", async () => {
    const md = "# T\n\n## A\n\n### One\n\nFirst body here.\n\n### Two\n\nSecond body here.\n\n## B\n\nPlain.\n";
    expect((await split(md, () => "T › A"))?.map((p) => p.key)).toEqual(["T › A › One", "T › A › Two"]);
    expect(await split(md, () => "T › B")).toBeNull();
  });
});

describe("mergeIntoSource — unplaced parts are plain cards, with no model call", () => {
  const go = async (refine: boolean) => {
    const tasks: string[] = [];
    const prompts: string[] = [];
    const { runtime, spy } = runtimeWith((req: AIRequest) => {
      if (req.task !== "assign_to_topics") return modelReply(req);
      tasks.push(req.task);
      prompts.push(req.prompt);
      return response(
        JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }, { part: "p2", topic: "unsure" }, { part: "p3", topic: "t3" }, { part: "p4", topic: "unsure" }, { part: "p5", topic: "unsure" }, { part: "p6", topic: "t4" }] }),
      );
    });
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await merge(a, CHAT, runtime, refine);
    return { r, spy, tasks, plans: spy.mock.calls.map((c) => c[0]!) };
  };

  it("subsection refinement is off by default: one assignment call, and the part stays whole and unplaced", async () => {
    const { r, tasks } = await go(false);
    expect(tasks).toHaveLength(1);
    expect(r.report.refined).toEqual([]);
    expect(r.report.unplaced).toEqual([KEYS.pricing, KEYS.support, KEYS.naming]);
  });

  it("each unplaced part is one standalone card holding its text verbatim; no outline, plan or analysis call is made for it", async () => {
    const { r, plans } = await go(false);
    const sent = plans.filter((q) => q.task !== "assign_to_topics").map((q) => q.prompt).join("\n");
    // The three topics that grew are planned (as before); nothing of the unplaced sections is ever sent to a model.
    for (const text of ["Pricing could follow", "Support covers mornings", "The team argued about a codename", "protects small teams"]) expect(sent, text).not.toContain(text);
    expect(plans.filter((q) => q.task === "outline_document")).toHaveLength(0);
    expect(r.diagnostics.calls.plans.new).toBe(0);
    expect(r.diagnostics.calls.analysisCalls).toBe(0);
    const added = r.changeSet!.changes.map((c) => JSON.stringify(c)).join("\n");
    for (const heading of ["Pricing idea", "Support rota", "Naming debate"]) expect(added, heading).toContain(heading);
    for (const sentence of ["Pricing could follow the usage of each team, with a floor.", "The floor protects small teams from surprise bills.", "Support covers mornings; payments covers evenings and weekends.", "The team argued about a codename for the release for an hour."])
      expect(added, sentence).toContain(sentence);
    // One card per unplaced part, each in a section frame of its own; the review names them.
    expect(r.changeSet!.changes.filter((c) => c.kind === "create_frame" && ["Pricing idea", "Support rota", "Naming debate"].some((h) => JSON.stringify(c).includes(h)))).toHaveLength(3);
    expect(r.notices.some((n) => n.startsWith("AI couldn't place 3 passages") && n.includes("plain card"))).toBe(true);
  });
});

describe("mergeIntoSource — plain cards on an outlined (sectioned) source, the chat import's default", () => {
  it("one section holding one card per unplaced part — a part with inner titles too — and not one outline or section call for them", async () => {
    const calls: string[] = [];
    const { runtime, spy } = runtimeWith((req: AIRequest) => {
      calls.push(req.task);
      if (req.task === "outline_document") {
        return response(JSON.stringify({ summary: "S", sections: Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, label: i === 0 ? "Intro" : `Part ${i - 1}`, kind: "notes", parts: [`u${i + 1}`] })) }));
      }
      if (req.task === "assign_to_topics") {
        return response(JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }, { part: "p2", topic: "unsure" }, { part: "p3", topic: "t3" }, { part: "p4", topic: "unsure" }, { part: "p5", topic: "unsure" }, { part: "p6", topic: "t4" }] }));
      }
      const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
      return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: body.slice(0, 250) } }], relationships: [] }));
    });
    const a = accepted(await firstRun(PROSE, runtime));
    expect(a.source).toMatchObject({ tier: "ai", template: "sectioned" });
    spy.mockClear();
    calls.length = 0;
    const r = await merge(a, CHAT, runtime);
    const prompts = spy.mock.calls.map((c) => c[0]!).filter((q) => q.task !== "assign_to_topics").map((q) => q.prompt).join("\n");
    for (const text of ["Pricing could follow", "The floor protects", "Usage is metered", "Support covers mornings", "codename"]) expect(prompts, text).not.toContain(text);
    expect(calls).not.toContain("outline_document");
    expect(r.report.unplaced).toEqual([KEYS.pricing, KEYS.support, KEYS.naming]);
    const text = r.changeSet!.contentSource!.text;
    for (const line of BODY) expect(text, line).toContain(line);
    const frames = r.changeSet!.changes.filter((c) => c.kind === "create_frame").map((c) => JSON.stringify(c));
    for (const heading of ["Pricing idea", "Support rota", "Naming debate"]) expect(frames.filter((f) => f.includes(heading)), heading).toHaveLength(1);
    const added = r.changeSet!.changes.map((c) => JSON.stringify(c)).join("\n");
    for (const sentence of ["Pricing could follow the usage of each team, with a floor.", "The floor protects small teams from surprise bills.", "Usage is metered per workspace and rounded up daily.", "The team argued about a codename for the release for an hour."]) expect(added, sentence).toContain(sentence);
    // The stored plan knows the cards as sections, so a later update keeps them and asks nothing about them.
    const stored = JSON.stringify(r.changeSet!.contentSource!.plan);
    for (const heading of ["Pricing idea", "Support rota", "Naming debate"]) expect(stored, heading).toContain(heading);
  });
});

describe("mergeIntoSource — all or nothing when the model refuses a call", () => {
  /** AI answers "new" for the one section; every plan or analysis call after the first import is then refused (a network error). */
  const refused = async () => {
    let refusing = false;
    const { runtime } = runtimeWith((req: AIRequest) => {
      if (req.task === "assign_to_topics") return response(JSON.stringify({ assignments: [{ part: "p1", topic: "new" }] }));
      if (refusing && (req.task === "generate_visual_plan" || req.task === "generate_section_analysis")) throw new AIError("network", "refused by the cost cap");
      if (req.task === "outline_document") return response(JSON.stringify({ summary: "S", sections: Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, label: `S${i}`, kind: "notes", parts: [`u${i + 1}`] })) }));
      const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
      return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }], relationships: [], metadata: { takeaway: "T" } }));
    });
    const a = accepted(await firstRun(PROSE, runtime));
    refusing = true;
    return merge(a, "## Budget\n\nTwo engineers for three weeks, then one on call.\n", runtime);
  };

  it("a new section the model could not analyse is not proposed as a finished merge: the merge is rejected and nothing changes", async () => {
    await expect(refused()).rejects.toThrow(/1 of the new sections couldn't be analysed \("Budget": network: refused by the cost cap\), so nothing was changed/);
  });
});
