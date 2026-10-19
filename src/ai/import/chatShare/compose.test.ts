import { describe, expect, it } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import { assignToTopicsDecision, type AssignInput } from "@/ai/merge/assign";
import { analysisUnits, headingOnlyReply } from "@/ai/reconcile/units";
import type { DecisionAnswer } from "@/ai/decisions/types";
import type { ImportedChat } from "./branchSkip";
import { composeChatMarkdown, demoteHeadings } from "./compose";
import { turnHash } from "./hash";
import type { ChatTranscript, ChatTurn } from "./types";

const turn = (index: number, role: "user" | "assistant", markdown: string): ChatTurn => ({ id: `t${index}`, index, role, markdown, hash: turnHash(role, markdown) });

function chat(title: string, shareId: string, turns: ChatTurn[], kept: ChatTurn[] = turns): ImportedChat {
  const transcript: ChatTranscript = { provider: "chatgpt", url: `https://chatgpt.com/share/${shareId}`, shareId, title, sharedAt: Date.UTC(2026, 9, 8), turns };
  return { transcript, kept, skipped: turns.filter((t) => !kept.includes(t)).map((t) => ({ turn: t, rule: "branch" as const, keptIn: { shareId: "parent", title: "Parent" } })), notes: [] };
}

const ANSWER = ["Here is the plan.", "", "## Pricing tiers", "", "### Free", "", "Basic editor, ten AI actions.", "", "### Pro", "", "Unlimited canvases.", "", "## Roadmap", "", "### Phase 1", "", "Ship the editor."].join("\n");

describe("demoteHeadings", () => {
  it("lowers headings by the given levels, caps at 6, and leaves code fences (and the # lines inside them) alone", () => {
    const text = ["# One", "## Two", "###### Six", "```bash", "# a comment, not a heading", "```", "~~~", "## still code", "~~~", "Text with # inside."].join("\n");
    expect(demoteHeadings(text, 1)).toBe(["## One", "### Two", "###### Six", "```bash", "# a comment, not a heading", "```", "~~~", "## still code", "~~~", "Text with # inside."].join("\n"));
  });
});

describe("composeChatMarkdown (layout D)", () => {
  const q1 = turn(0, "user", "Which plan should the free tier use?\n\nAlso, what about teams?");
  const a1 = turn(1, "assistant", ANSWER);
  const md = composeChatMarkdown([chat("Pricing chat", "11111111-1111-4111-8111-111111111111", [q1, a1])]);

  it("quotes the user's turn (every line, blank lines kept as a quote), and never labels turns", () => {
    expect(md).toContain("> Which plan should the free tier use?\n>\n> Also, what about teams?");
    expect(md).not.toMatch(/\*\*(You|Assistant):\*\*/);
  });

  it("keeps the assistant's text and headings, one level down, under the chat's title, with the title, date and source", () => {
    expect(md.startsWith("# Pricing chat (2026-10-08)\n\nSource: https://chatgpt.com/share/11111111-1111-4111-8111-111111111111\n\n")).toBe(true);
    expect(md).toContain("### Pricing tiers");
    expect(md).toContain("#### Free");
    expect(md).toContain("### Roadmap");
    expect(md).toContain("Basic editor, ten AI actions.");
    expect(md).not.toMatch(/^## Pricing tiers$/m);
  });

  it("keeps turn order, every kept turn's words, and leaves skipped (branch-shared) turns out; chats stay in order with their own source", () => {
    const parent = [turn(0, "user", "First question about databases?"), turn(1, "assistant", "First answer about Firestore.")];
    const branchTurns = [...parent, turn(2, "user", "Branch-only follow up?"), turn(3, "assistant", "Branch-only answer about Postgres.")];
    const out = composeChatMarkdown([chat("Parent", "22222222-2222-4222-8222-222222222222", parent), chat("Branch", "33333333-3333-4333-8333-333333333333", branchTurns, branchTurns.slice(2)), chat("Empty", "44444444-4444-4444-8444-444444444444", parent, [])]);
    const iParent = out.indexOf("# Parent (");
    const iBranch = out.indexOf("# Branch (");
    expect(iParent).toBeGreaterThanOrEqual(0);
    expect(iBranch).toBeGreaterThan(iParent);
    expect(out).not.toContain("# Empty");
    expect(out.split("First answer about Firestore.")).toHaveLength(2); // once: the branch's shared turns are not repeated
    expect(out.slice(iBranch)).not.toContain("First question about databases");
    expect(out.slice(iBranch)).toContain("> Branch-only follow up?");
    expect(out.slice(iBranch)).toContain("Source: https://chatgpt.com/share/33333333-3333-4333-8333-333333333333");
    expect(out.indexOf("Branch-only follow up?")).toBeLessThan(out.indexOf("Branch-only answer about Postgres."));
  });
});

describe("the structure the merge sees (real parser and unit rules)", () => {
  it("an answer's major sections are units under the chat title, with their fragments inside them; no turn-label units", async () => {
    const md = composeChatMarkdown([chat("Pricing chat", "55555555-5555-4555-8555-555555555555", [turn(0, "user", "Which plan?"), turn(1, "assistant", ANSWER)])]);
    const { parsed } = await analyzeContent(md);
    const units = analysisUnits(parsed, md).filter((u) => !headingOnlyReply(u, "sectioned"));
    const keys = units.map((u) => u.key);
    expect(keys).toEqual(["Pricing chat (2026-10-08)", "Pricing chat (2026-10-08) › Pricing tiers", "Pricing chat (2026-10-08) › Roadmap"]);
    const tiers = units.find((u) => u.key.endsWith("Pricing tiers"))!.text;
    expect(tiers).toContain("Free");
    expect(tiers).toContain("Pro");
    expect(keys.some((k) => /you|assistant/i.test(k.replace(/Pricing chat.*/, "")))).toBe(false);
  });
});

describe("large sections still take the intended conflict path", () => {
  /** A section with `n` one-sentence statements under its own heading, composed the way an import would be. */
  async function partOf(n: number) {
    const body = Array.from({ length: n }, (_, i) => `Statement ${i + 1} says the launch week is ${i + 1}.`).join(" ");
    const md = composeChatMarkdown([chat("Plan chat", "66666666-6666-4666-8666-666666666666", [turn(0, "user", "When do we launch?"), turn(1, "assistant", `## Launch\n\n${body}`)])]);
    const { parsed } = await analyzeContent(md);
    return analysisUnits(parsed, md).find((u) => u.key.endsWith("Launch"))!;
  }
  const answers = (): Record<string, DecisionAnswer> => ({
    p1_topic: { type: "choice", choice: "t1", confidence: 0.9, probabilities: {} },
    p1_relation: { type: "choice", choice: "contradicts", confidence: 0.9, probabilities: { contradicts: 0.9 } },
    p1_nothing_new: { type: "boolean", probability: 0.1 },
  });
  const inputFor = (text: string): AssignInput => ({
    topics: [{ key: "Launch", label: "Launch", text: "The launch week is 3. Support is by email." }],
    parts: [{ key: "Plan chat › Launch", text }],
  });

  it("a section within the 40-statement limit gets round two (one question per statement)", async () => {
    const part = await partOf(12);
    const input = inputFor(part.text.replace(/^#+ .*\n+/, ""));
    const followUp = assignToTopicsDecision.followUp!(answers(), input);
    expect(followUp).not.toBeNull();
    const questions = Object.keys((followUp as unknown as { questions: Record<string, unknown> }[])[0]!.questions);
    expect(questions.length).toBeGreaterThan(1);
    expect(questions.every((q) => q.endsWith("_contradicts"))).toBe(true);
  });

  it("a section over the limit is not guessed at: the typed path hands the merge to the chat task (interpret gives null)", async () => {
    const part = await partOf(45);
    const input = inputFor(part.text.replace(/^#+ .*\n+/, ""));
    expect(assignToTopicsDecision.followUp!(answers(), input)).toBeNull();
    expect(assignToTopicsDecision.interpret(answers(), input)).toBeNull();
  });
});
