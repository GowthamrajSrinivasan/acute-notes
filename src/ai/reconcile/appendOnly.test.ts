import { describe, expect, it } from "vitest";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { appendOnly } from "./appendOnly";

const text = (id: string, key: string, t: string): VisualNode => ({ id, type: "text", stableKey: key, content: { markdown: t } }) as VisualNode;
const shape = (id: string, key: string, label: string): VisualNode => ({ id, type: "shape", stableKey: key, content: { shape: "rectangle", label } }) as VisualNode;
const plan = (nodes: VisualNode[], relationships: VisualPlan["relationships"] = []): VisualPlan => ({ version: 1, template: "sectioned", nodes, relationships }) as VisualPlan;

const S = "Doc › Storage";
const previous = plan(
  [
    text("p1", `${S} § text#0`, "Every workspace is stored in IndexedDB on the user's device."),
    shape("p2", `${S} § shape#0`, "IndexedDB"),
    shape("p3", `${S} § shape#1`, "Firestore backup later"),
  ],
  [{ from: "p2", to: "p3", type: "relates_to" }],
);

describe("appendOnly", () => {
  it("keeps every node the new plan dropped, with its links: a merge removes nothing", () => {
    const next = plan([text("p1", `${S} § text#0`, "Every workspace is stored in IndexedDB on the user's device.")]);
    const out = appendOnly(next, previous);
    expect(out.nodes.map((n) => n.stableKey).sort()).toEqual([`${S} § shape#0`, `${S} § shape#1`, `${S} § text#0`].sort());
    expect(out.relationships).toEqual([{ from: "p2", to: "p3", type: "relates_to" }]);
  });

  it("leaves out a new node that only restates what its section already says (near-verbatim: paraphrase is the model's job)", () => {
    const next = plan([...previous.nodes, text("n1", `${S} § text#1`, "Every workspace is stored in IndexedDB on each user's device.")], [{ from: "p2", to: "n1", type: "explained_by" }]);
    const out = appendOnly(next, previous);
    expect(out.nodes.map((n) => n.id)).not.toContain("n1");
    expect(out.relationships.some((r) => r.to === "n1")).toBe(false);
  });

  it("keeps a new node that carries the new content", () => {
    const next = plan([...previous.nodes, text("n1", `${S} § text#1`, "Attachments are compressed before they're written, and workspaces export as one file.")]);
    expect(appendOnly(next, previous).nodes.map((n) => n.id)).toContain("n1");
  });

  it("keeps an update of an existing node (that is how a section takes in the new passage)", () => {
    const grown = "Every workspace is stored in IndexedDB on the user's device. Attachments are compressed first.";
    const out = appendOnly(plan([text("p1", `${S} § text#0`, grown), previous.nodes[1]!, previous.nodes[2]!]), previous);
    expect(out.nodes.find((n) => n.id === "p1")).toMatchObject({ content: { markdown: grown } });
  });

  it("never judges a node of a new section against other sections", () => {
    const next = plan([...previous.nodes, text("n1", "Doc › Pricing § text#0", "Every workspace is stored in IndexedDB on the user's device.")]);
    expect(appendOnly(next, previous).nodes.map((n) => n.id)).toContain("n1");
  });
});
