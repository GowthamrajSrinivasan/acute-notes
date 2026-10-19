import { describe, expect, it } from "vitest";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { expandUnchanged, representationOf, withCurrentKept } from "./preserve";
import { appendedParagraphs } from "./paragraphs";

const plan: VisualPlan = {
  version: 1,
  template: "flow",
  nodes: [
    { id: "u0_n1", stableKey: "Auth § firebase", sourceSpan: { start: 0, end: 9 }, type: "shape", content: { shape: "rectangle", label: "Firebase Auth" } },
    { id: "u0_n2", stableKey: "Auth § validate", type: "shape", content: { shape: "rectangle", label: "Backend validates token" } },
    { id: "u1_n1", stableKey: "Billing § invoice", type: "shape", content: { shape: "rectangle", label: "Invoice" } },
  ],
  relationships: [
    { from: "u0_n1", to: "u0_n2", type: "relates_to" },
    { from: "u0_n2", to: "u1_n1", type: "relates_to" }, // crosses sections: not part of either one's representation
  ],
};

describe("representationOf", () => {
  it("shows only that section's nodes, under p-ids and unit-local keys, without source spans", () => {
    const rep = representationOf(plan, "Auth")!;
    expect(rep.current.nodes).toEqual([
      { id: "p1", stableKey: "firebase", type: "shape", content: { shape: "rectangle", label: "Firebase Auth" } },
      { id: "p2", stableKey: "validate", type: "shape", content: { shape: "rectangle", label: "Backend validates token" } },
    ]);
    expect(rep.current.relationships).toEqual([{ from: "p1", to: "p2", type: "relates_to" }]);
  });

  it("is null for a section that wasn't there before", () => {
    expect(representationOf(plan, "Rollout")).toBeNull();
  });
});

describe("expandUnchanged", () => {
  const rep = representationOf(plan, "Auth")!;

  it("restores an unchanged node verbatim (by id, else by key) — the model never has to copy it", () => {
    const out = expandUnchanged({ nodes: [{ id: "p1", unchanged: true }, { id: "x", stableKey: "validate", unchanged: true }] }, rep) as { nodes: unknown[] };
    expect(out.nodes).toEqual([
      { id: "p1", stableKey: "firebase", type: "shape", content: { shape: "rectangle", label: "Firebase Auth" } },
      { id: "x", stableKey: "validate", type: "shape", content: { shape: "rectangle", label: "Backend validates token" } },
    ]);
  });

  it("a changed node that kept its p-id keeps that node's key, whatever key the model wrote", () => {
    const out = expandUnchanged({ nodes: [{ id: "p2", stableKey: "step#1", type: "shape", content: { shape: "rectangle", label: "Validate token + org" } }] }, rep) as { nodes: { stableKey: string }[] };
    expect(out.nodes[0]!.stableKey).toBe("validate");
  });

  it("new nodes pass through; an unchanged marker naming nothing is dropped", () => {
    const fresh = { id: "n9", stableKey: "org-check", type: "shape", content: { shape: "rectangle", label: "Check org" } };
    const out = expandUnchanged({ nodes: [fresh, { id: "p7", unchanged: true }] }, rep) as { nodes: unknown[] };
    expect(out.nodes).toEqual([fresh]);
  });

  it("a node re-sent instead of marked unchanged, differing only in case, spacing, punctuation or code ticks, is the previous node", () => {
    const out = expandUnchanged({ nodes: [{ id: "p2", stableKey: "validate", type: "shape", content: { shape: "rectangle", label: "backend  validates `token`." } }] }, rep) as { nodes: unknown[] };
    expect(out.nodes).toEqual([{ id: "p2", stableKey: "validate", type: "shape", content: { shape: "rectangle", label: "Backend validates token" } }]);
  });

  it("a real change of wording is kept as a change", () => {
    const changed = { id: "p2", stableKey: "validate", type: "shape", content: { shape: "rectangle", label: "Backend validates token and org" } };
    expect((expandUnchanged({ nodes: [changed] }, rep) as { nodes: unknown[] }).nodes).toEqual([changed]);
  });

  it("leaves a reply alone when the section is new, or the reply isn't plan-shaped", () => {
    expect(expandUnchanged({ nodes: [{ id: "p1", unchanged: true }] }, null)).toEqual({ nodes: [{ id: "p1", unchanged: true }] });
    expect(expandUnchanged("nonsense", rep)).toBe("nonsense");
  });
});

describe("withCurrentKept", () => {
  const rep = representationOf(plan, "Auth")!;

  it("gives back every node the reply didn't name, and keeps the section's links, around what the appended paragraphs add", () => {
    const reply = { nodes: [{ id: "n1", type: "text", content: { markdown: "Tokens expire after an hour." } }], relationships: [{ from: "p2", to: "n1", type: "explained_by" }] };
    const out = expandUnchanged(withCurrentKept(reply, rep), rep) as VisualPlan;
    expect(out.nodes.map((n) => n.id)).toEqual(["p1", "p2", "n1"]);
    expect(out.nodes[0]).toMatchObject({ stableKey: "firebase", content: { label: "Firebase Auth" } });
    expect(out.relationships).toEqual([
      { from: "p1", to: "p2", type: "relates_to" },
      { from: "p2", to: "n1", type: "explained_by" },
    ]);
  });

  it("a node it changes is its own reply; a current node re-sent under a new id is that node, not a new one", () => {
    const reply = {
      nodes: [
        { id: "p2", type: "shape", content: { shape: "rectangle", label: "Backend validates and refreshes token" } },
        { id: "n9", type: "shape", content: { shape: "rectangle", label: "Firebase auth" } },
      ],
      relationships: [{ from: "n9", to: "p2", type: "relates_to" }],
    };
    const out = expandUnchanged(withCurrentKept(reply, rep), rep) as VisualPlan;
    expect(out.nodes.map((n) => n.id)).toEqual(["p1", "p2"]);
    expect(out.nodes[1]).toMatchObject({ stableKey: "validate", content: { label: "Backend validates and refreshes token" } });
    expect(out.relationships).toEqual([{ from: "p1", to: "p2", type: "relates_to" }]); // its link is the one already there
  });
});

describe("appendedParagraphs", () => {
  const before = "## Auth\n\nUsers sign in with Firebase.\n\nThe backend validates the token.";

  it("is the new paragraphs when every earlier one is still there word for word", () => {
    expect(appendedParagraphs(before, `${before}\n\nTokens expire after an hour.`)).toEqual(["Tokens expire after an hour."]);
  });

  it("is null when a paragraph was edited or removed, or nothing was added", () => {
    expect(appendedParagraphs(before, `${before.replace("Firebase", "Auth0")}\n\nTokens expire after an hour.`)).toBeNull();
    expect(appendedParagraphs(before, "## Auth\n\nUsers sign in with Firebase.\n\nTokens expire after an hour.")).toBeNull();
    expect(appendedParagraphs(before, before)).toBeNull();
  });
});
