import { beforeAll, describe, expect, it } from "vitest";
import { loadMarkdownParser, parseMarkdownWith } from "@/ai/content/parser";
import type { ParsedContent } from "@/ai/content/types";
import { analysisUnits } from "@/ai/reconcile/units";
import { composeMerged, notesOverlaps, type MergeReport } from "./compose";
import { mergeNotices } from "./merge";

let parse: (md: string) => ParsedContent;
beforeAll(async () => {
  const fromMarkdown = await loadMarkdownParser();
  parse = (md) => parseMarkdownWith(fromMarkdown, md);
});

const NOTES = `# Project decisions

## Storage

Every workspace is stored in IndexedDB on the user's device. Firestore is planned for cloud backup later.

## AI access

Users bring their own AI: a GitHub Copilot subscription or their own API key. The app never ships a model key of its own.
`;

/** Files every part of `incoming` under `topic` (a key of NOTES' units). */
function compose(incoming: string, topic: string, notes = NOTES) {
  const parsed = parse(notes);
  const incomingParsed = parse(incoming);
  const parts = analysisUnits(incomingParsed, incoming);
  return composeMerged({
    text: notes,
    parsed,
    units: analysisUnits(parsed, notes),
    incoming,
    incomingParsed,
    parts,
    assignment: new Map(parts.map((p) => [p.key, topic] as const)),
  });
}

describe("composeMerged — repeats across topics", () => {
  it("a passage filed under one topic that another topic already says is left out; the new passage beside it is kept", () => {
    // Filed under AI access; the second paragraph is what Storage says, in nearly the same words.
    const incoming = "## Model choice\n\nThe model is chosen per workspace.\n\nEach workspace is stored in IndexedDB on the user's own device. Firestore is planned for cloud backup later.\n";
    const { text, report } = compose(incoming, "Project decisions › AI access");
    expect(text).toContain("The model is chosen per workspace.");
    expect(text.match(/stored in IndexedDB/g)).toHaveLength(1);
    expect(report).toMatchObject({ skippedBlocks: 1, repeatedElsewhere: 1, mergedInto: { "Project decisions › AI access": ["Model choice"] } });
  });

  it("a word-for-word repeat of another topic is left out too", () => {
    const { text, report } = compose("## Extra\n\nEvery workspace is stored in IndexedDB on the user's device. Firestore is planned for cloud backup later.\n", "Project decisions › AI access");
    expect(text).toBe(NOTES);
    expect(report.skippedParts).toEqual(["Extra"]);
  });

  it("a new sentence made of words the notes use in different topics is not a repeat (topics are compared one by one)", () => {
    // Every word appears somewhere in the notes, but no one topic says this.
    const incoming = "## Mix\n\nThe user's API key is stored in IndexedDB for cloud backup of the model.\n";
    const { text, report } = compose(incoming, "Project decisions › AI access");
    expect(text).toContain("The user's API key is stored in IndexedDB for cloud backup of the model.");
    expect(report.skippedBlocks).toBe(0);
  });
});

describe("composeMerged — notes made from a chat keep new text with its own answer", () => {
  const SOURCE = "Source: https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4";
  const CHAT = `# Product notes\n\n${SOURCE}\n\n> Tell me about pricing.\n\n### Pricing\n\nThe Pro plan has a free trial of two weeks.\n\n> Tell me about security.\n\n### Security\n\nKeys are encrypted in the browser.\n\n> Anything else on security?\n`;

  it("a new passage for a topic goes above the next topic's quoted question, not below it", () => {
    const { text } = compose("## Pricing again\n\nTrials can be extended once by support.\n", "Product notes › Pricing", CHAT);
    expect(text).toContain("The Pro plan has a free trial of two weeks.\n\nTrials can be extended once by support.\n\n> Tell me about security.\n\n### Security");
    expect(text.indexOf("Trials can be extended")).toBeLessThan(text.indexOf("> Tell me about security."));
  });

  it("the last topic's trailing question stays last", () => {
    const { text } = compose("## Security again\n\nExports leave the keys out.\n", "Product notes › Security", CHAT);
    expect(text).toContain("Keys are encrypted in the browser.\n\nExports leave the keys out.\n\n> Anything else on security?");
  });

  it("notes that are not from a chat put the passage after the section's text, quotes included, as before", () => {
    const notes = "# Notes\n\n## Pricing\n\nThe Pro plan has a free trial.\n\n> A line the author quoted.\n\n## Security\n\nKeys are encrypted.\n";
    const { text } = compose("## More\n\nTrials can be extended once.\n", "Notes › Pricing", notes);
    expect(text).toContain("> A line the author quoted.\n\nTrials can be extended once.");
  });
});

describe("composeMerged — a chat's questions travel with their answers", () => {
  const SOURCE = "Source: https://chatgpt.com/share/6ac75691-b3c8-83e8-a831-880f86f446c8";
  const NOTES_CHAT = `# Product notes\n\nSource: https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4\n\n> Tell me about pricing.\n\n### Pricing\n\nThe Pro plan has a free trial of two weeks.\n`;
  // The branch: a question, an answer about pricing, the question that leads to a second answer about a new subject, that answer.
  const BRANCH = `# Branch\n\n${SOURCE}\n\n> Can trials be extended?\n\n### Trials\n\nSupport can extend a trial once.\n\n> What about invoices?\n\n### Invoices\n\nInvoices are emailed on the first of the month.\n`;

  it("the question of an answer filed under a topic goes with it, and the next question goes with its own answer, a new section", () => {
    const parsed = parse(NOTES_CHAT);
    const incomingParsed = parse(BRANCH);
    const parts = analysisUnits(incomingParsed, BRANCH);
    const trials = parts.find((p) => p.key.endsWith("Trials"))!;
    const invoices = parts.find((p) => p.key.endsWith("Invoices"))!;
    const { text } = composeMerged({
      text: NOTES_CHAT,
      parsed,
      units: analysisUnits(parsed, NOTES_CHAT),
      incoming: BRANCH,
      incomingParsed,
      parts,
      assignment: new Map([[trials.key, "Product notes › Pricing"]]),
    });
    // Trials joined Pricing with its own question above it; the invoices question is not left under Pricing.
    expect(text).toContain("The Pro plan has a free trial of two weeks.\n\n> Can trials be extended?\n\nSupport can extend a trial once.");
    expect(text.indexOf("> What about invoices?")).toBeGreaterThan(text.indexOf("Support can extend a trial once."));
    const section = text.slice(text.indexOf("Invoices\n"));
    expect(section).toContain("> What about invoices?\n\nInvoices are emailed on the first of the month.");
    expect(text.split("> What about invoices?")).toHaveLength(2);
    expect(invoices.key).toBeTruthy();
  });

  it("notes that are not from a chat keep each part's blocks as they were", () => {
    const notes = "# Notes\n\n## Pricing\n\nThe Pro plan has a free trial.\n";
    const incoming = "## Trials\n\nSupport can extend a trial once.\n\n> A quoted line the author wrote.\n\n## Invoices\n\nInvoices are emailed monthly.\n";
    const parsed = parse(notes);
    const incomingParsed = parse(incoming);
    const parts = analysisUnits(incomingParsed, incoming);
    const trials = parts.find((p) => p.key.endsWith("Trials"))!;
    const { text } = composeMerged({ text: notes, parsed, units: analysisUnits(parsed, notes), incoming, incomingParsed, parts, assignment: new Map([[trials.key, "Notes › Pricing"]]) });
    expect(text).toContain("Support can extend a trial once.\n\n> A quoted line the author wrote.");
  });
});

describe("composeMerged — a changed number is not a repeat", () => {
  const PRICING = "# Plans\n\n## Pricing\n\nThe Pro plan costs 12 dollars per month and includes 200 AI actions every month for each paying team.\n";
  const into = (incoming: string) => compose(incoming, "Plans › Pricing", PRICING);

  it("the same sentence with another price is kept, so the model can call it a contradiction instead of the merge calling it a repeat", () => {
    const { text, report } = into("## Price update\n\nThe Pro plan costs 15 dollars per month and includes 200 AI actions every month for each paying team.\n");
    expect(text).toContain("costs 15 dollars per month");
    expect(text).toContain("costs 12 dollars per month");
    expect(report.skippedBlocks).toBe(0);
    expect(report.skippedParts).toEqual([]);
  });

  it("the same sentence with the same numbers is still a repeat, whatever the wording around them", () => {
    const { text, report } = into("## Price again\n\nThe Pro plan costs 12 dollars per month, and includes 200 AI actions every month for each paying team.\n");
    expect(text).toBe(PRICING);
    expect(report.skippedParts).toEqual(["Price again"]);
  });
});

describe("notesOverlaps — the notes' own topics repeating each other", () => {
  const units = (notes: string) => analysisUnits(parse(notes), notes);

  it("finds a passage two topics both say, once per pair", () => {
    const notes = `${NOTES}\n## Privacy\n\nEvery workspace is stored in IndexedDB on the user's own device.\n`;
    expect(notesOverlaps(notes, parse(notes), units(notes))).toEqual([{ topics: ["Project decisions › Storage", "Project decisions › Privacy"], passages: 1 }]);
  });

  it("finds nothing in notes whose topics say different things", () => {
    expect(notesOverlaps(NOTES, parse(NOTES), units(NOTES))).toEqual([]);
  });

  it("is reported by every merge into those notes, and changes nothing in them", () => {
    const notes = `${NOTES}\n## Privacy\n\nEvery workspace is stored in IndexedDB on the user's own device.\n`;
    const { text, report } = compose("## AI access\n\nModels can be switched per canvas.\n", "Project decisions › AI access", notes);
    expect(text).toContain("Every workspace is stored in IndexedDB on the user's own device.");
    expect(report.overlaps).toHaveLength(1);
  });
});

describe("mergeNotices — what the review says", () => {
  const base: MergeReport = { mergedInto: { "Doc › AI access": ["Model choice"] }, newTopics: [], skippedBlocks: 1, skippedParts: [], repeatedElsewhere: 1, overlaps: [], nothingNew: [], choices: [], extended: [], reopened: [], keptWith: {}, unsure: [], unplaced: [], refined: [], economy: [] };

  it("says when a passage left out was already under another topic", () => {
    expect(mergeNotices(base)).toEqual(["Merged: added to 1 existing topic, 1 passage already in your notes left out (1 of them under another topic)."]);
  });

  it("points out topics that already say the same thing, without changing them", () => {
    const notices = mergeNotices({ ...base, overlaps: [{ topics: ["Doc › Storage", "Doc › Privacy"], passages: 1 }] });
    expect(notices).toContain("“Storage” and “Privacy” already say the same thing (1 passage); you may want to keep it in one of them.");
  });
});

describe("verbatim — a model's quote, as the text has it", () => {
  it("matches across spacing and a missing or extra final full stop, and returns the text's own words", async () => {
    const { verbatim } = await import("./assign");
    const text = "We use   Firestore for\ndocuments. Then more.";
    expect(verbatim(text, "We use Firestore for documents")).toBe("We use   Firestore for\ndocuments.");
    expect(verbatim(text, "We use Firestore for documents.")).toBe("We use   Firestore for\ndocuments.");
    expect(verbatim(text, "We use Postgres")).toBeNull();
  });
});

describe("composeMerged — a contradiction about a statement that already has a choice", () => {
  const OPEN = `> [!choice] Storage engine\n> - Every workspace is stored in IndexedDB on the user's device. _(in your notes)_\n> - Workspaces are stored in SQLite. _(from “Chat A”, 2026-10-08)_`;
  const NOTES_OPEN = `# Project decisions\n\n## Storage\n\nEvery workspace is stored in IndexedDB on the user's device. Firestore is planned for cloud backup later.\n\n${OPEN}\n\n## AI access\n\nUsers bring their own AI.\n`;
  const conflict = (topicSays: string, partSays: string) => new Map([["Chat B", [{ about: "Storage: engine", topicSays, partSays }]]]);
  const run = (notes: string, incoming: string, conflicts: ReturnType<typeof conflict>) => {
    const parsed = parse(notes);
    const incomingParsed = parse(incoming);
    const parts = analysisUnits(incomingParsed, incoming).map((p) => ({ ...p, key: "Chat B" }));
    return composeMerged({ text: notes, parsed, units: analysisUnits(parsed, notes), incoming, incomingParsed, parts, assignment: new Map([["Chat B", "Project decisions › Storage"]]), conflicts, from: { label: "Chat B", date: "2026-10-09" } });
  };

  it("an open choice about the same statement gets another option — never a second box", async () => {
    const { findChoices } = await import("@/ai/history/choices");
    const { text, report } = run(NOTES_OPEN, "Workspaces live in OPFS files.\n", conflict("Every workspace is stored in IndexedDB on the user's device.", "Workspaces live in OPFS files."));
    const choices = findChoices(text);
    expect(choices).toHaveLength(1);
    expect(choices[0]!.options.map((o) => o.statement)).toEqual(["Every workspace is stored in IndexedDB on the user's device.", "Workspaces are stored in SQLite.", "Workspaces live in OPFS files."]);
    expect(report).toMatchObject({ extended: ["Storage engine"], choices: [] });
    expect(mergeNotices(report)).toContain("This content adds another option to “Storage engine”, already waiting for your call.");
  });

  it("a choice the user made, contradicted again: reopened with the user's choice marked — the notes' text unchanged until they choose", async () => {
    const { findChoices, resolveChoice, withoutChoices } = await import("@/ai/history/choices");
    const chosen = resolveChoice(NOTES_OPEN, "storage-engine", 1); // the user chose SQLite; the notes now say it
    expect(withoutChoices(chosen)).toContain("Workspaces are stored in SQLite.");
    const { text, report } = run(chosen, "Workspaces live in OPFS files.\n", conflict("Workspaces are stored in SQLite.", "Workspaces live in OPFS files."));
    const [c] = findChoices(text);
    expect(c).toMatchObject({ title: "Storage engine", resolved: false });
    expect(c!.options).toEqual([
      { statement: "Workspaces are stored in SQLite.", from: "in your notes · your choice", inNotes: true, state: "open" },
      { statement: "Workspaces live in OPFS files.", from: "from “Chat B”, 2026-10-09", inNotes: false, state: "open" },
    ]);
    expect(withoutChoices(text)).toBe(withoutChoices(chosen)); // nothing in the notes' own text changes until the user chooses
    expect(report).toMatchObject({ reopened: ["Storage engine"], choices: [] });
    expect(mergeNotices(report)).toContain("This content disagrees with your earlier choice in “Storage engine”, so it is open again: your choice is marked, and nothing was changed until you choose.");
  });

  it("a contradiction about another statement still opens its own box", async () => {
    const { findChoices } = await import("@/ai/history/choices");
    const { text, report } = run(NOTES_OPEN, "Cloud backup is dropped.\n", conflict("Firestore is planned for cloud backup later.", "Cloud backup is dropped."));
    expect(findChoices(text)).toHaveLength(2);
    expect(report).toMatchObject({ choices: ["Storage: engine"], extended: [], reopened: [] });
  });
});

describe("titleLikeAsItalic — a label filed above a section's subsections must not become a heading", () => {
  it("writes a bold-only line (with an optional short note) in italics, and leaves every other block as it is", async () => {
    const { titleLikeAsItalic } = await import("./compose");
    expect(titleLikeAsItalic("**Competitive feature matrix**")).toBe("*Competitive feature matrix*");
    expect(titleLikeAsItalic("**Phase 1** — launch")).toBe("*Phase 1* — launch");
    expect(titleLikeAsItalic("**Status:** no rows changed.")).toBe("**Status:** no rows changed.");
    expect(titleLikeAsItalic("A paragraph with **bold** inside.")).toBe("A paragraph with **bold** inside.");
    expect(titleLikeAsItalic("- **Item** in a list")).toBe("- **Item** in a list");
  });

  it("a part with an inner title filed into a section's own text (above its subsections) leaves the notes' topic keys as they were", () => {
    const notes = "# Chat\n\nOpening text.\n\n### Alpha\n\nAlpha body.\n\n### Beta\n\nBeta body.\n";
    const incoming = "# Chat 2\n\n## Extra\n\nNew opening detail.\n\n### Matrix\n\nThe matrix rows.\n";
    const parsed = parse(notes);
    const units = analysisUnits(parsed, notes);
    const incomingParsed = parse(incoming);
    const parts = analysisUnits(incomingParsed, incoming);
    const { text } = composeMerged({ text: notes, parsed, units, incoming, incomingParsed, parts, assignment: new Map(parts.map((p) => [p.key, "Chat"])) });
    expect(text, JSON.stringify(text)).toContain("*Matrix*");
    expect(analysisUnits(parse(text), text).map((u) => u.key)).toEqual(units.map((u) => u.key));
  });
});
