/**
 * "Update from new content" on a distil canvas when one passage of an existing section is edited (Study Mode's report,
 * 2026-11-15): the "# Caching notes" doc of `e2e/local/notesStudy.local.spec.ts`, answered by the scripted distiller.
 *
 * Was a pre-existing gap (not a regression of the Stage 1 / stale-target work): `updateOutlined` (update.ts) regenerated an
 * EDITED existing section through `settle` → `changedInput` + `generateSection`, a preserve-style prompt with no unit
 * labels and no `noteModel: "distil"`, so the distiller answered with the analysis card alone; positional stable keys
 * (`<section> § text#N`, `keys.ts` `ordinalKeyer`) then paired that analysis card with the "500" card and removed the
 * other two. Fix (a): in distil mode `settle` generates an edited section the way a new one is (`visualizeOutlined` with
 * `sourceUnits`, no outline call), so its cards cite the next version's units and keep their positions. Stable keys are
 * still positional (fix (b), keying cited cards by unit, is proposed only).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { UnitSet } from "@/ai/fidelity/contracts";
import { distiller } from "@/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import type { AIRequest } from "@/ai/types";
import { ungroup } from "@/ai/visual-plan/groups";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { visualizeContent } from "@/ai/visualize/visualize";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { accepted, context, parse, runtimeWith, type Accepted } from "@/testUtils/reconcileHarness";
import { updateFromNewContent } from "./update";

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;
const respond = distiller({ uncitedIn: /expire after/, persistent: true });
const LIMITS = "Caching notes › Limits";

/** A distil first run, accepted as the writer would (citations, note model, the content as a block). */
async function distilCanvas(): Promise<Accepted> {
  const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_1", title: "Visualize", context }, runtimeWith(respond).runtime, { parseMarkdown: parse });
  const a = accepted(changeSet!);
  const cards = changeSet!.knowledge?.cards ?? {};
  const plan = ungroup(changeSet!.contentSource!.plan as VisualPlan);
  const existing = a.existing.map((o) => {
    const k = cards[o.stableNodeKey];
    const n = plan.nodes.find((x) => x.stableKey === o.stableNodeKey);
    const md = n?.type === "text" ? (n.content as { markdown?: string }).markdown : undefined;
    return { ...o, noteModel: "distil" as const, ...(k?.sourceUnits.length ? { sourceUnits: k.sourceUnits } : {}), ...(md ? { rich: { content: parse(md), title: n!.title } } : {}) };
  });
  return { ...a, existing, previous: { ...a.previous, units: changeSet!.contentSource!.units as UnitSet } };
}

async function update(a: Accepted, text: string) {
  const prompts: AIRequest[] = [];
  const { runtime } = runtimeWith((req) => (prompts.push(req), respond(req)));
  const r = await updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, runtime, { parseMarkdown: parse });
  return { r, prompts };
}

const objectOf = (a: Accepted, key: string) => a.existing.find((o) => o.stableNodeKey === key)!.objectId;
const touched = (set: ChangeSet | null | undefined) => (set?.changes ?? []).flatMap((c) => ("target" in c ? [c.target] : []));

describe("distil: editing one passage of an existing section", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  beforeEach(() => void (FIDELITY_CONFIG.noteModel = "distil"));
  afterEach(() => void (FIDELITY_CONFIG.noteModel = initial));

  it("the edited section is regenerated with a labelled distil prompt (fix (a)): only the edited passage's card is updated", async () => {
    const a = await distilCanvas();
    const { r, prompts } = await update(a, DOC.replace("30 minutes", "45 minutes"));
    expect(r.reanalyzedUnits).toEqual([LIMITS]);
    const asked = prompts.filter((p) => p.task === "generate_visual_plan");
    expect(asked.length).toBeGreaterThan(0);
    // Unit labels ("P1.1 …") in every generation of the section, so the distiller can cite.
    for (const p of asked) expect(p.prompt.slice(p.prompt.lastIndexOf("Content to visualize:"))).toMatch(/^[PL]\d+\.\d+ /m);
    const byKey = new Map(r.reconciliation.items.map((i) => [i.state === "add" ? i.node.stableKey : i.object.stableNodeKey, i] as const));
    expect(byKey.get(`${LIMITS} § text#0`)!.state).toBe("unchanged"); // the "500" card
    expect(byKey.get(`${LIMITS} § text#1`)!.state).toBe("update_clean"); // the "expire" card
    expect(byKey.get(`${LIMITS} § text#2`)!.state).toBe("unchanged"); // the analysis card
  });

  it("expected: the “500” card (its passage unchanged) is left alone; the edited passage's card is regenerated, citing it", async () => {
    const a = await distilCanvas();
    const { r } = await update(a, DOC.replace("30 minutes", "45 minutes"));
    const set = r.changeSet!;
    expect(touched(set)).not.toContain(objectOf(a, `${LIMITS} § text#0`));
    expect(set.conflicts ?? []).toEqual([]);
    expect(set.changes.filter((c) => c.kind === "remove")).toEqual([]);
    const units = set.contentSource!.units!.units;
    const expire = units.find((u) => /45 minutes/.test(u.text))!.id;
    // The planted failure leaves the "expire" card uncited, so the one to check is the "500" one after its own edit:
    const { r: r2 } = await update(a, DOC.replace("500 entries", "600 entries"));
    const cards = Object.values(r2.changeSet!.knowledge?.cards ?? {});
    expect(expire).toBeDefined();
    expect(cards.some((c) => c.sourceUnits.some((u) => r2.changeSet!.contentSource!.units!.units.find((x) => x.id === u && /600 entries/.test(x.text))))).toBe(true);
  });
});
