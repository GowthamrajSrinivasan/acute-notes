/**
 * Derives a case's flat constraints view (`constraints.json`): the shape requested on 2026-10-19 so a case can be
 * loaded without the full schema. It is generated, never edited by hand.
 */
import type { CaseBundle } from "./load";
import type { ConstraintsView } from "./schemas";

export function constraintsView(c: CaseBundle): ConstraintsView {
  const units = new Map(c.source.units.map((u) => [u.id, u]));
  const el = new Map(c.canvas.elements.map((e) => [e.id, e]));
  const name = (id: string) => el.get(id)?.content ?? id;
  const critical = c.source.units.filter((u) => u.critical).map((u) => ({ quote: u.quote, why: u.critical!.note ?? u.critical!.reason }));
  const exact = [...new Set([...c.source.units.flatMap((u) => (u.protected ?? []).filter((p) => p.tier === "exact").map((p) => p.value)), ...c.knowledge.units.flatMap((k) => k.exactDetails ?? [])])];
  const view: ConstraintsView = {
    id: c.id,
    kind: c.source.sourceType,
    source: c.texts.get(1) ?? "",
    critical,
    exact,
    groups: {
      together: (c.canvas.together ?? []).map((g) => g.elements.map(name)),
      apart: (c.canvas.keepSeparate ?? []).map((g) => g.elements.map(name)),
    },
    hierarchy: (c.canvas.hierarchy ?? []).map((h) => ({ main: name(h.main), supporting: h.supporting.map(name) })),
    relations: c.canvas.relationships.filter((r) => r.requirement === "mandatory").map((r) => ({ from: name(r.from), to: name(r.to), type: r.type, ...(r.label.text ? { label: r.label.text } : {}) })),
    mustNotSay: c.knowledge.mustNotClaim.map((m) => ({ text: m.claim, why: m.why })),
  };
  if (c.reconcile) {
    const by = (changes: string[]) => c.reconcile!.items.filter((i) => changes.includes(i.change)).map((i) => (i.unitsAfter[0] ? units.get(i.unitsAfter[0])!.quote : units.get(i.unitsBefore[0] ?? "")?.quote ?? name(i.element)));
    view.update = {
      v2: c.texts.get(c.reconcile.toVersion) ?? "",
      expect: {
        unchanged: by(["unchanged"]),
        changed: by(["edited", "dependency_changed", "ambiguous"]),
        added: by(["added"]),
        removed: c.reconcile.items.filter((i) => i.change === "removed").map((i) => units.get(i.unitsBefore[0] ?? "")?.quote ?? name(i.element)),
        userEdited: c.reconcile.userEdits.map((e) => e.after),
      },
    };
  }
  return view;
}
