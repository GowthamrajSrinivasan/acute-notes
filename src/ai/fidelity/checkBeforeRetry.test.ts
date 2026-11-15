/**
 * The model check before the one retry (Distil quality follow-up, 2026-10-20): its findings become retry reasons
 * (`aiRetryReasons`), and a card is known across replies by its text and cited source (`checkItemKey`), so only changed
 * cards are checked again. The pipeline side is in `visualize/distilRun.test.ts` and `visualize/distilLimits.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { aiRetryReasons, checkItemKey, type CardVerdict } from "./knowledgeCheck";

const view = (id: string, title: string, body = "") => ({ id, title, body, cites: ["u1"], members: [id] }) as never;

describe("aiRetryReasons", () => {
  it("one reason per card the check found partly or not supported, naming the card and the false belief", () => {
    const verdicts = new Map<string, CardVerdict>([
      ["n1", { verdict: "not_supported", reason: "The source does not say it always holds." }],
      ["n2", { verdict: "partly", reason: "" }],
      ["n3", { verdict: "supported", reason: "" }],
      ["n4", "unanswered"],
    ]);
    const reasons = aiRetryReasons({ views: [view("n1", "Entries always expire"), view("n2", "", "Retries help\nmore"), view("n3", "Fine"), view("n4", "No answer")] }, verdicts);
    expect(reasons).toEqual([
      'Card "Entries always expire" is not supported by the passages it cites: The source does not say it always holds.. Make it say what those passages say, with their conditions and caveats, and nothing they don\'t.',
      'Card "Retries help" is only partly supported by the passages it cites. Make it say what those passages say, with their conditions and caveats, and nothing they don\'t.',
    ]);
  });

  it("nothing to tell the model when every card is supported or unanswered", () => {
    expect(aiRetryReasons({ views: [] }, new Map<string, CardVerdict>([["n1", "unanswered"]]))).toEqual([]);
  });
});

describe("checkItemKey", () => {
  it("is the same for the same card text and source, and differs when either changes (a retry's rewording, a Limit: line)", () => {
    const a = { source: "Entries expire after 30 minutes.", card: "Entries expire\nAfter 30 minutes." };
    expect(checkItemKey(a)).toBe(checkItemKey({ ...a }));
    expect(checkItemKey(a)).not.toBe(checkItemKey({ ...a, card: `${a.card}\n\n**Limit:** When idle` }));
    expect(checkItemKey(a)).not.toBe(checkItemKey({ ...a, source: "Entries expire after 20 minutes." }));
  });
});
