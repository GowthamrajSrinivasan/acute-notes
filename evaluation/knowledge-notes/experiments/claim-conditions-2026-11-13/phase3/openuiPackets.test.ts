/** Phase 3: the saved OpenUI replies (v1 and v2, kn-01/kn-02) as packets for card labelling. P3_OPENUI=1 to (re)write. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { cardOf, splitCards } from "@/ai/openui/notesTask";
import { DATASET_ROOT } from "../../../tooling/load";

export const OPENUI_CASES = ["kn-01-idempotency-keys", "kn-02-edge-cache-invalidation"];
export const OPENUI_VARIANTS = { v1: "openui.txt", v2: "openui-v2.txt" } as const;

export async function openuiCards(caseId: string, variant: keyof typeof OPENUI_VARIANTS) {
  const units = (await splitUnits(readFileSync(join(DATASET_ROOT, "cases", caseId, "source.md"), "utf8").replace(/\r\n?/g, "\n"))).units;
  const known = new Set(units.map((u) => u.id));
  const text = readFileSync(join(DATASET_ROOT, "experiments", "openui-2026-11-13", `${caseId}.${OPENUI_VARIANTS[variant]}`), "utf8");
  const cards = splitCards(text).flatMap((b, i) => cardOf(b, i, known) ?? []);
  return { units, cards };
}

it.skipIf(!process.env.P3_OPENUI)("write OpenUI packets", async () => {
  for (const caseId of OPENUI_CASES) {
    const L = [`# OpenUI note sets: ${caseId}`, "", "Saved replies of generate_openui_notes (gemini-2.5-flash, 2026-11-13). No frames or arrows: each card stands alone. Card id = <variant>:<key>.", ""];
    for (const v of ["v1", "v2"] as const) {
      const { cards } = await openuiCards(caseId, v);
      L.push(`## ${v} (${cards.length} cards). Each line: id, cites (claimed sources), then the visible text (title | body | detail).`);
      for (const c of cards) L.push(`${v}:${c.key} ${c.cites.length ? `cites=${c.cites.join(",")}` : "(no cites)"} :: ${[c.title, c.body, c.detail].filter(Boolean).join(" | ").replace(/\s+/g, " ")}`);
      L.push("");
    }
    writeFileSync(join(DATASET_ROOT, "experiments", "claim-conditions-2026-11-13", "phase3", "openui-packets", `${caseId}.md`), `${L.join("\n")}\n`);
  }
});
