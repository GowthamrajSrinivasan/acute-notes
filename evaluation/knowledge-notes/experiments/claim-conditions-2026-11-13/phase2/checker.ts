/**
 * Phase 2 checker: for each claim–condition record, which nodes convey the condition (visible text only), which nodes
 * state the claim, and per claim card where the condition is for a reader: on the card (`carried`), on its frame
 * (`frame`), on a card joined to it by a visible arrow (`linked`), elsewhere (`separated`) or nowhere (`absent`).
 *
 * Citations are used only to FIND claim cards (attribution), never as evidence that a condition is preserved.
 */
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { conveys, signatureOf, stemsOf, DEFAULT_CLAUSE_OPTIONS, type ClauseOptions } from "./clauseCheck";
import type { CaseData, NoteNode } from "./data";

export type Outcome = "carried" | "frame" | "linked" | "separated" | "absent";

export interface CheckRecord {
  id: string;
  claimUnits: string[];
  conditionUnits: string[];
  binding: "claim" | "set";
  /** Given (oracle) claim cards; otherwise found by attribution. */
  claimCards?: string[];
}

export interface RecordCheck {
  id: string;
  binding: "claim" | "set";
  carriers: string[];
  claimCards: string[];
  perClaimCard: Record<string, Outcome>;
  covered: boolean;
}

/** Nodes that can state a claim (frames and headings are context, not cards). */
const CARD_TYPES = new Set(["text", "shape", "table", "code", "todo"]);

export interface CheckOptions {
  clause?: ClauseOptions;
  /** Text attribution: a card whose words cover this share of a claim unit's significant words states the claim, cited or not. */
  attributionOverlap?: number;
}

const CITED_MIN_SHARE = 0.3;

export function attributeClaimCards(data: CaseData, claimUnits: readonly string[], overlap: number): string[] {
  const texts = data.units.filter((u) => claimUnits.includes(u.id));
  return data.nodes
    .filter((n) => CARD_TYPES.has(n.type))
    .filter((n) => {
      // Citing a claim unit is not enough (a step's "expected result" card cites the step): it must also share some of
      // the claim's words. Uncited, it must share most of them. (Dev, 2026-11-13.)
      const have = stemsOf(n.text);
      const share = Math.max(0, ...texts.map((u) => {
        const need = stemsOf(u.text);
        return need.size >= 3 ? [...need].filter((s) => have.has(s)).length / need.size : 0;
      }));
      return n.cites.some((u) => claimUnits.includes(u)) ? share >= CITED_MIN_SHARE : share >= overlap;
    })
    .map((n) => n.id);
}

export function checkRecords(data: CaseData, records: readonly CheckRecord[], options: CheckOptions = {}): RecordCheck[] {
  const clause = options.clause ?? DEFAULT_CLAUSE_OPTIONS;
  const byId = new Map<string, NoteNode>(data.nodes.map((n) => [n.id, n]));
  const unitText = new Map<string, SourceUnit>(data.units.map((u) => [u.id, u]));
  return records.map((r) => {
    const intra = r.conditionUnits.every((u) => r.claimUnits.includes(u));
    const sig = signatureOf(r.conditionUnits.map((u) => unitText.get(u)?.text ?? ""), intra);
    const carriers = data.nodes.filter((n) => n.text && conveys(n.text, sig, clause)).map((n) => n.id);
    const carrierSet = new Set(carriers);
    const claimCards = r.claimCards ?? attributeClaimCards(data, r.claimUnits, options.attributionOverlap ?? 0.6);
    const perClaimCard: Record<string, Outcome> = {};
    for (const id of claimCards) {
      const node = byId.get(id);
      const parent = node?.parent;
      perClaimCard[id] = carrierSet.has(id)
        ? "carried"
        : parent && carrierSet.has(parent)
          ? "frame"
          : data.arrows.some(([a, b]) => (a === id && carrierSet.has(b)) || (b === id && carrierSet.has(a)))
            ? "linked"
            : carriers.length
              ? "separated"
              : "absent";
    }
    return { id: r.id, binding: r.binding, carriers, claimCards, perClaimCard, covered: carriers.length > 0 };
  });
}

export const isFailure = (o: Outcome | undefined) => o === "separated" || o === "absent";
