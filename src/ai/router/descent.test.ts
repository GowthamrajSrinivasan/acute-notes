/**
 * Stage 5b–5c prototypes (intelligent-update-engine-plan §13.13): the item index and the router descent — offline,
 * hashed embedder, no model. Their measurement against the dev split is in `locateEvaluation.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { Descent, entitiesOf } from "./descent";
import { hashedProvider, type EmbeddingProvider } from "./embeddingProvider";
import { ItemIndex, itemKey, type CardItems } from "./itemIndex";

/** The hashed embedder, counting calls and texts (and failing on demand). */
function counting(fail = false): EmbeddingProvider & { calls: number; texts: number } {
  const p = {
    ...hashedProvider,
    calls: 0,
    texts: 0,
    embed: async (texts: readonly string[]) => {
      p.calls++;
      p.texts += texts.length;
      if (fail) throw new Error("offline");
      return hashedProvider.embed(texts);
    },
  };
  return p;
}

const SLA: CardItems = {
  card: "sla",
  section: "s1",
  kind: "table",
  text: "Tier First response Resolution Enterprise 1 hour 1 day Pro 4 hours 3 days",
  header: ["Tier", "First response", "Resolution"],
  items: [
    { block: 0, part: 0, text: "Enterprise 1 hour 1 day", cells: ["Enterprise", "1 hour", "1 day"] },
    { block: 0, part: 1, text: "Pro 4 hours 3 days", cells: ["Pro", "4 hours", "3 days"] },
  ],
};
const MACROS: CardItems = { card: "macros", section: "s1", kind: "list", text: "Refund macro for duplicate charges. Password reset macro.", items: [{ block: "b1", text: "Refund macro for duplicate charges." }, { block: "b2", text: "Password reset macro." }] };
const POLICY: CardItems = { card: "policy", section: "s2", kind: "text", text: "Agents escalate outages to the duty engineer. Weekend coverage is two agents.", items: [{ block: 0, part: 0, text: "Agents escalate outages to the duty engineer." }, { block: 0, part: 1, text: "Weekend coverage is two agents." }] };
const ESCALATION_TODO: CardItems = { card: "esc-todo", section: "s2", kind: "todo", text: "Write the escalation runbook.", items: [{ block: "t1", text: "Write the escalation runbook." }] };

async function descentOver(cards: CardItems[], provider: EmbeddingProvider = hashedProvider) {
  const index = new ItemIndex(provider);
  cards.forEach((c) => index.setCard(c));
  const d = new Descent(index, [
    { id: "s1", name: "Support levels" },
    { id: "s2", name: "Escalation" },
  ]);
  await d.prepare();
  return { index, d };
}

describe("5b — the item index", () => {
  it("keys items by the patch contract's identity: card, block, then sentence or table row", () => {
    expect(itemKey("c1", "b7", "list_item")).toBe("c1#b7");
    expect(itemKey("c1", 0, "sentence", 2)).toBe("c1#0.2");
    expect(itemKey("c1", 0, "table_row", 1)).toBe("c1#0.r1");
    const index = new ItemIndex(hashedProvider);
    index.setCard(SLA);
    index.setCard(MACROS);
    expect(index.itemsOf("sla").map((i) => i.key)).toEqual(["sla#0.r0", "sla#0.r1"]);
    expect(index.itemsOf("macros").map((i) => i.key)).toEqual(["macros#b1", "macros#b2"]);
  });

  it("setCard only hashes; refresh embeds; an unchanged or restored item (undo / redo) is never embedded again", async () => {
    const p = counting();
    const index = new ItemIndex(p);
    index.setCard(MACROS);
    expect(p.calls).toBe(0);
    expect(await index.refresh()).toMatchObject({ embedded: 3, pending: 0 }); // two items + the card
    const edited: CardItems = { ...MACROS, text: "Refund macro for duplicate charges. Password reset macro. Chargeback macro.", items: [...MACROS.items, { block: "b3", text: "Chargeback macro." }] };
    index.setCard(edited);
    expect(await index.refresh()).toMatchObject({ embedded: 2 }); // the new item + the changed card
    index.setCard(MACROS); // undo
    expect(await index.refresh()).toMatchObject({ embedded: 0 });
    index.setCard(edited); // redo
    expect(await index.refresh()).toMatchObject({ embedded: 0 });
    index.removeCard("macros");
    expect(index.itemsOf("macros")).toEqual([]);
    expect(index.size).toBe(0);
  });

  it("vectors are kept per embedder: another embedder embeds again", async () => {
    const index = new ItemIndex(hashedProvider);
    index.setCard(MACROS);
    await index.refresh();
    const other = new ItemIndex({ ...hashedProvider, id: "other-v1", embed: async (t) => (await hashedProvider.embed(t)).map((v) => ({ ...v, embedder: "other-v1" })) });
    other.setCard(MACROS);
    expect((await other.refresh()).embedded).toBe(3);
    expect(index.vectorOf(index.itemsOf("macros")[0]!.hash)?.embedder).toBe(hashedProvider.id);
  });

  it("a failed refresh leaves items pending and the content intact; the next refresh retries", async () => {
    const index = new ItemIndex(counting(true));
    index.setCard(MACROS);
    expect(await index.refresh()).toMatchObject({ embedded: 0, pending: 3 });
    expect(index.itemsOf("macros")).toHaveLength(2);
    expect(index.vectorOf(index.itemsOf("macros")[0]!.hash)).toBeUndefined();
  });

  it("finds an exact duplicate by normalised content", () => {
    const index = new ItemIndex(hashedProvider);
    index.setCard(MACROS);
    expect(index.withSameContent("  refund MACRO for duplicate charges.").map((i) => i.key)).toEqual(["macros#b1"]);
  });
});

describe("5c — router descent", () => {
  it("an exact duplicate is answered without embedding the note", async () => {
    const p = counting();
    const { d } = await descentOver([MACROS, SLA], p);
    const before = p.calls;
    const r = await d.place("Password reset macro.");
    expect(r).toMatchObject({ action: "duplicate", card: "macros", item: 1, relation: "DUPLICATE" });
    expect(p.calls).toBe(before);
  });

  it("a changed value in a table is a cell edit on the right row and column", async () => {
    const { d } = await descentOver([SLA, MACROS, POLICY]);
    const r = await d.place("Pro first response is now 2 hours.", { itemMatch: 0.1, cardFloor: 0 });
    expect(r).toMatchObject({ action: "cell", card: "sla", item: 1, column: "First response", relation: "SUPERSEDES" });
  });

  it("destination and action together: new information for a prose card passes to a card that can take it", async () => {
    const { d } = await descentOver([POLICY, ESCALATION_TODO, MACROS]);
    const r = await d.place("Escalate billing outages to the finance duty engineer too.", { itemMatch: 0.99, cardFloor: 0, sectionWeight: 0, entityBonus: 0 });
    expect(r.ranked[0]).toBe("policy");
    expect(r.card).not.toBe("policy");
    expect(r.steps.join(" ")).toMatch(/policy \(text\) can't take new information/);
  });

  it("nothing close enough: a new card in the best section, or a new section", async () => {
    const { d } = await descentOver([SLA, MACROS]);
    expect((await d.place("Refund macro wording needs review.", { cardFloor: 2, sectionFloor: -1 })).action).toBe("new_block");
    expect((await d.place("The office plants need watering.", { cardFloor: 2, sectionFloor: 2 })).action).toBe("new_section");
  });

  it("asks when two cards in different sections are within the margin", async () => {
    const { d } = await descentOver([MACROS, ESCALATION_TODO]);
    const r = await d.place("Add a runbook for refunds.", { margin: 10, cardFloor: -1 });
    expect(r.action).toBe("clarify");
  });

  it("keeps routing and update confidences apart", async () => {
    const { d } = await descentOver([SLA, MACROS]);
    const r = await d.place("Pro first response is now 2 hours.", { itemMatch: 0.1, cardFloor: 0 });
    expect(r.routing).not.toBe(r.update);
  });

  it("named things: codes, numbers, all-capital words and mid-sentence capitals", () => {
    expect([...entitiesOf("Route GCP anomaly notices to the Slack room by 3 March.")].sort()).toEqual(["3", "gcp", "march", "slack"]);
  });
});
