/**
 * `regroupSections` stores a merge's flat plan grouped by its sections again. A node is a member of the frame of the section its key names; an overflow
 * page names no section, so it keeps the frame it was in: otherwise a frame whose only member was a page is stored empty, the next read drops it as an
 * empty frame, and an identical second import proposes removing a frame that is still on the canvas (audit 2026-10-11). Pure; no model.
 */
import { describe, expect, it } from "vitest";
import { ungroup } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { OutlineSection } from "./outline";
import { regroupSections } from "./outlined";

const section = (key: string): OutlineSection => ({ key, units: [key], label: key, kind: "notes", prominence: "primary", arrangement: "grid" });
const frame = (id: string, key: string) => ({ id, type: "group", stableKey: `${key} § group#0`, content: { label: key, arrangement: "grid" } }) as unknown as VisualNode;
const title = (id: string, key: string) => ({ id, type: "heading", role: "section", stableKey: `${key} § group#0`, content: { text: key } }) as unknown as VisualNode;
const node = (id: string, stableKey: string, over: Partial<VisualNode> = {}) => ({ id, type: "text", stableKey, content: { markdown: id }, ...over }) as VisualNode;
const page = (id: string, stableKey: string, over: Partial<VisualNode> = {}) => ({ id, type: "page", stableKey, content: { title: "More from this section", markdown: id }, ...over }) as unknown as VisualNode;
const plan = (nodes: VisualNode[]): VisualPlan => ({ version: 1, template: "sectioned", nodes, relationships: [] });
const parentOf = (p: VisualPlan, id: string) => p.nodes.find((n) => n.id === id)?.parent;

describe("regroupSections keeps a node that names no section in the frame it had", () => {
  // The previous stored plan: two framed sections; the first import folded all of "B"'s content into a page, so that page is B's only member.
  const previous = plan([frame("g1", "A"), node("a1", "A § text#0", { parent: "g1" }), frame("g2", "B"), page("pg", "page#0", { parent: "g2" })]);
  // The merge's flat plan: titles are headings, and the page has lost its parent (`ungroup`).
  const flat = (extra: VisualNode[] = []) => plan([title("t1", "A"), node("a1", "A § text#0"), title("t2", "B"), page("pg", "page#0"), ...extra]);

  it("an overflow page stays a member of its frame, so the frame is not stored empty", () => {
    const next = regroupSections(flat(), [section("A"), section("B")], previous);
    const groupB = next.nodes.find((n) => n.type === "group" && n.stableKey === "B § group#0")!;
    expect(parentOf(next, "pg")).toBe(groupB.id);
    // Read back (as the next update reads it) the frame survives: it has a member.
    const read = validateVisualPlan(next, { stored: true }).plan;
    expect(read.nodes.filter((n) => n.type === "group").map((n) => n.stableKey).sort()).toEqual(["A § group#0", "B § group#0"]);
  });

  it("without the previous plan's frames the page would be loose and the frame dropped (what used to happen)", () => {
    const next = regroupSections(flat(), [section("A"), section("B")]);
    expect(parentOf(next, "pg")).toBeUndefined();
    const read = validateVisualPlan(next, { stored: true }).plan;
    expect(read.nodes.filter((n) => n.type === "group").map((n) => n.stableKey)).toEqual(["A § group#0"]);
  });

  it("works for the section-scoped page keys too, and a node's own section still wins over where it was", () => {
    const prev = plan([frame("g1", "A"), frame("g2", "B"), page("pg", "more~B~1", { parent: "g2" }), node("b1", "B § text#0", { parent: "g2" })]);
    const next = regroupSections(plan([title("t1", "A"), title("t2", "B"), page("pg", "more~B~1"), node("b1", "A § text#0")]), [section("A"), section("B")], prev);
    const g = (key: string) => next.nodes.find((n) => n.type === "group" && n.stableKey === `${key} § group#0`)!.id;
    expect(parentOf(next, "pg")).toBe(g("B"));
    expect(parentOf(next, "b1")).toBe(g("A"));
  });

  it("a new page, or a node the previous plan never had in a frame, stays loose, as before", () => {
    const next = regroupSections(flat([page("new", "more~B~2"), node("loose", "no-section-key")]), [section("A"), section("B")], previous);
    expect(parentOf(next, "new")).toBeUndefined();
    expect(parentOf(next, "loose")).toBeUndefined();
  });

  it("a page whose frame is no longer a section of the plan stays loose, and one already in a frame is left alone", () => {
    const next = regroupSections(flat(), [section("A")], previous);
    expect(parentOf(next, "pg")).toBeUndefined();
    const already = regroupSections(plan([title("t1", "A"), node("a1", "A § text#0", { parent: "somewhere" })]), [section("A")], previous);
    expect(parentOf(already, "a1")).toBe("somewhere");
  });

  it("flattening what it stored gives back the same nodes (`ungroup` still round-trips)", () => {
    const next = regroupSections(flat(), [section("A"), section("B")], previous);
    const back = ungroup(validateVisualPlan(next, { stored: true }).plan);
    expect(back.nodes.map((n) => n.id).sort()).toEqual(["a1", "pg", "t1", "t2"]);
  });
});
