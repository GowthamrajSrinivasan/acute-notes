/**
 * Knowledge Notes WP1.5 (knowledge-notes-plan §4.4): the distil prompt, used only when the input's `noteModel` is
 * `distil`. `preserve` prompts are pinned byte for byte in `preservePrompts.test.ts`; here, that an explicit `preserve`
 * is the same as no mode at all, and what distil changes.
 */
import { describe, expect, it } from "vitest";
import { labelSource } from "@/ai/fidelity/sourceBlocks";
import { kindRules, SECTION_KINDS, sectionKind } from "@/ai/visual-plan/sectionKinds";
import { analysisRule, DISTIL_RULE, FIDELITY_RULE, generateVisualPlanTask, type GenerateVisualPlanInput } from "./tasks";

const TEXT = "## Retries\n\nRetries can improve reliability when the cache holds a valid result. Hello all, as discussed.\n\n- Use an idempotency key";
const prompt = (input: GenerateVisualPlanInput) => generateVisualPlanTask.buildPrompt({ input }).prompt;

describe("distil prompt (WP1.5)", () => {
  it("an explicit preserve is exactly no mode: today's prompt", () => {
    for (const kind of SECTION_KINDS) {
      const base: GenerateVisualPlanInput = { template: "sectioned", text: TEXT, section: { label: "Retries", kind } };
      expect(prompt({ ...base, noteModel: "preserve" })).toBe(prompt(base));
    }
    expect(prompt({ template: "flow", text: TEXT, noteModel: "preserve" })).toBe(prompt({ template: "flow", text: TEXT }));
  });

  it("uses DISTIL_RULE instead of FIDELITY_RULE, asks for cites per node and omissions per section, and shows the labelled units", async () => {
    const { labelled } = await labelSource(TEXT);
    const p = prompt({ template: "sectioned", text: TEXT, numbered: labelled, section: { label: "Retries", kind: "notes" }, noteModel: "distil" });
    expect(p).toContain(DISTIL_RULE);
    expect(p).not.toContain(FIDELITY_RULE);
    expect(p).toMatch(/one idea per card, with a "title" that states the point/);
    expect(p).toMatch(/Cite every source unit you represent/);
    expect(p).toMatch(/Keep protected details exact/);
    expect(p).toMatch(/Keep every condition, limit and caveat with the claim it applies to/);
    expect(p).toContain(`"metadata":{"title":"optional","takeaway":"...","omitted":[{"unit":"P3.1","reason":"filler"}]}`);
    for (const reason of ['"filler"', '"duplicate"', '"superseded"', '"meta"']) expect(p).toContain(reason);
    // The reference rule is unchanged, and the content is shown with its unit labels.
    expect(p).toMatch(/\{"id":"n9","type":"source","ref":"T1"\}/);
    expect(p).toContain("Content to visualize:\n\n## Retries\n\n[P1]\nP1.1 Retries can improve reliability when the cache holds a valid result.");
  });

  it("asks for brevity without dropping limits: short bodies, never longer than the source passage, limits on the claim's card (2026-10-20)", () => {
    const p = prompt({ template: "sectioned", text: TEXT, section: { label: "Retries", kind: "notes" }, noteModel: "distil" });
    expect(p).toMatch(/one idea per card, with a "title" that states the point/);
    expect(p).toMatch(/a card's body holds only what its idea needs/);
    expect(p).toMatch(/A card is never longer than the source passages it cites, except protected detail kept exact/);
    expect(p).toMatch(/Don't repeat the title in the body/);
    expect(p).toMatch(/a card that would hold two ideas becomes two short cards, linked/);
    expect(p).toMatch(/Brevity never drops a limit\. Keep every condition, limit and caveat with the claim it applies to, on the same card/);
    expect(p).toMatch(/never cut to make a card shorter/);
    expect(p).toMatch(/Cite a unit only on a card that says what that unit says/);
    // The old "as much as its idea needs" wording (which let bodies grow past the source) is gone.
    expect(p).not.toMatch(/holds as much as its idea needs/);
    // Brevity is distil's alone: preserve's rule is untouched.
    expect(prompt({ template: "sectioned", text: TEXT, section: { label: "Retries", kind: "notes" } })).not.toMatch(/Brevity never drops a limit|never longer than the source passage/);
  });

  it("tells the model that a conversation's unanswered questions and assent to a proposal are not filler (2026-10-20 (2))", () => {
    const p = prompt({ template: "sectioned", text: TEXT, section: { label: "Retries", kind: "notes" }, noteModel: "distil" });
    expect(p).toMatch(/In a conversation, a question nobody answers is an open question and a reply agreeing to a proposal .* is part of a decision: neither is filler/);
    expect(prompt({ template: "sectioned", text: TEXT, section: { label: "Retries", kind: "notes" } })).not.toMatch(/a question nobody answers/);
  });

  it("drops 'in its own words, nothing left out' from the analysis rule only in distil; takeaway and analysis stay", () => {
    expect(analysisRule("X")).toContain("(in its own words, nothing left out)");
    const distil = analysisRule("X", true);
    expect(distil).not.toContain("nothing left out");
    expect(distil).toContain('"metadata.takeaway"');
    expect(distil).toContain('"origin":"analysis"');
    expect(distil).toContain("Analysis is added on top, never instead of them.");
    const p = prompt({ template: "sectioned", text: TEXT, section: { label: "Retries", kind: "decision" }, noteModel: "distil" });
    expect(p).toContain(distil.replace("X", sectionKind("decision").analysis));
  });

  it("never asks for the content's own words or a verbatim copy in any section kind", () => {
    for (const kind of SECTION_KINDS) {
      const p = prompt({ template: "sectioned", text: TEXT, section: { label: "Retries", kind }, noteModel: "distil" });
      expect(p, kind).not.toMatch(/content's own words|in its own words|nothing left out|do not summarize/);
      expect(p, kind).toContain(kindRules(sectionKind(kind), true));
    }
    // Only cards and supporting have a distil variant; their preserve rules are untouched.
    expect(SECTION_KINDS.filter((k) => sectionKind(k).distilRules)).toEqual(["cards", "supporting"]);
    for (const kind of SECTION_KINDS) expect(kindRules(sectionKind(kind), false)).toBe(sectionKind(kind).rules);
  });

  it("a forced template, a piece and a retry in distil mode get the distil rule too", () => {
    for (const input of [
      { template: "flow", text: TEXT },
      { template: "sectioned", text: TEXT, section: { label: "R", kind: "notes" }, part: { index: 1, total: 2 } },
      { template: "sectioned", text: TEXT, section: { label: "R", kind: "notes" }, analysisRetry: { missing: ["takeaway"] } },
    ] satisfies GenerateVisualPlanInput[]) {
      const p = prompt({ ...input, noteModel: "distil" });
      expect(p).toContain(DISTIL_RULE);
      expect(p).not.toContain(FIDELITY_RULE);
    }
  });
});
