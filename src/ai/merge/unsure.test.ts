import { describe, expect, it } from "vitest";
import type { Assignment } from "./assign";
import { documentRoots, parentOf, settleUnsure } from "./unsure";

const part = (key: string, text = "x") => ({ key, text, span: { start: 0, end: text.length } });
const settle = (keys: string[], assigned: Record<string, string | null>, unsure: string[], local: Record<string, string | null> = {}) =>
  settleUnsure(keys.map((k) => part(k)), new Map(Object.entries(assigned)) as Assignment, new Set(unsure), new Map(Object.entries(local)) as Assignment);

describe("parentOf", () => {
  it("is the heading path a key sits under, null at the top", () => {
    expect(parentOf("Pricing › Phase 1 › Free")).toBe("Pricing › Phase 1");
    expect(parentOf("Pricing")).toBeNull();
  });
});

describe("settleUnsure — a failed classification is not a new topic", () => {
  it("1. goes where its parent part went: an existing topic, or into the parent's new topic", () => {
    const toTopic = settle(["Phase 1", "Phase 1 › Free"], { "Phase 1": "Notes › Pricing", "Phase 1 › Free": null }, ["Phase 1 › Free"]);
    expect(toTopic.assignment.get("Phase 1 › Free")).toBe("Notes › Pricing");
    const toNew = settle(["Phase 1", "Phase 1 › Free"], { "Phase 1": null, "Phase 1 › Free": null }, ["Phase 1 › Free"]);
    expect(toNew.assignment.get("Phase 1 › Free")).toBeNull();
    expect(toNew.attach.get("Phase 1 › Free")).toBe("Phase 1");
    expect(toNew.how.get("Phase 1 › Free")).toBe("parent");
  });

  it("2. else where most of its confidently placed siblings went", () => {
    const keys = ["Plans › Free", "Plans › Pro", "Plans › Power", "Plans › Team"];
    const r = settle(keys, { "Plans › Free": "Notes › Pricing", "Plans › Pro": "Notes › Pricing", "Plans › Power": "Notes › Limits", "Plans › Team": null }, ["Plans › Team"]);
    expect(r.assignment.get("Plans › Team")).toBe("Notes › Pricing");
    expect(r.how.get("Plans › Team")).toBe("siblings");
  });

  it("3. else the local match, when it found an existing topic", () => {
    const r = settle(["Apps"], { Apps: null }, ["Apps"], { Apps: "Notes › Apps" });
    expect(r.assignment.get("Apps")).toBe("Notes › Apps");
    expect(r.how.get("Apps")).toBe("local");
  });

  it("4. else into the new topic a sibling became, so a run of fragments under one heading is one topic, not one each", () => {
    const keys = ["Skins › Cyberpunk", "Skins › Pastel", "Skins › Kids"];
    const r = settle(keys, { "Skins › Cyberpunk": null, "Skins › Pastel": null, "Skins › Kids": null }, ["Skins › Pastel", "Skins › Kids"]);
    expect(r.attach.get("Skins › Pastel")).toBe("Skins › Cyberpunk");
    expect(r.attach.get("Skins › Kids")).toBe("Skins › Cyberpunk");
    // All unsure: none is a topic to join. Each is unplaced, a card of its own.
    const all = settle(keys, { "Skins › Cyberpunk": null, "Skins › Pastel": null, "Skins › Kids": null }, keys);
    expect([...all.how.values()]).toEqual(["unplaced", "unplaced", "unplaced"]);
    expect(all.attach.size).toBe(0);
  });

  it("6. else it is unplaced; top-level parts have no siblings to join, and an unplaced neighbour is no place to go", () => {
    const r = settle(["Free", "Apps"], { Free: null, Apps: null }, ["Free", "Apps"]);
    expect([...r.how.values()]).toEqual(["unplaced", "unplaced"]);
    expect(r.unplaced).toEqual(new Set(["Free", "Apps"]));
    expect(r.attach.size).toBe(0);
  });

  it("5. a small top-level fragment follows the top-level part just above it, into its topic or its new topic", () => {
    const toTopic = settle(["Pricing", "Free"], { Pricing: "Notes › Plans", Free: null }, ["Free"]);
    expect(toTopic.assignment.get("Free")).toBe("Notes › Plans");
    expect(toTopic.how.get("Free")).toBe("adjacent");
    const toNew = settle(["Pricing", "Free", "Pro"], { Pricing: null, Free: null, Pro: null }, ["Free", "Pro"]);
    expect(toNew.attach.get("Free")).toBe("Pricing");
    expect(toNew.attach.get("Pro")).toBe("Pricing"); // the part above it settled there
    expect(toNew.unplaced.size).toBe(0);
  });

  it("5. but never a mid-sized part, a part that is not next to a top-level one, or one that follows an unplaced part", () => {
    const long = "y".repeat(400);
    const keys = [part("Pricing"), part("Free", long), part("Pro", "x"), part("Apps", "x")];
    const r = settleUnsure(keys, new Map([["Pricing", "Notes › Plans"], ["Free", null], ["Pro", null], ["Apps", null]]) as Assignment, new Set(["Free", "Pro", "Apps"]), new Map() as Assignment);
    expect(r.how.get("Free")).toBe("unplaced");
    expect(r.how.get("Pro")).toBe("unplaced"); // the part above it is unplaced, not a place
    expect(r.how.get("Apps")).toBe("unplaced");
  });

  it("leaves every part the model was sure of exactly as it was", () => {
    const r = settle(["A › x", "A › y"], { "A › x": "Notes › T", "A › y": null }, []);
    expect(r.assignment).toEqual(new Map([["A › x", "Notes › T"], ["A › y", null]]));
    expect(r.how.size).toBe(0);
  });
});

describe("settleUnsure — a document title is not a topic (layout D: every answer section sits under the chat's # title)", () => {
  const title = "Chat: AI app builder";
  const sections = Array.from({ length: 6 }, (_, i) => `${title} › Section ${i + 1}`);
  const keys = [title, ...sections];

  it("finds the roots: a top-level heading with a real run of sections, whether or not the heading is itself a part", () => {
    expect(documentRoots(keys)).toEqual(new Set([title]));
    expect(documentRoots(sections)).toEqual(new Set([title]));
    expect(documentRoots(["Pricing", "Pricing › Free", "Pricing › Pro"])).toEqual(new Set());
    expect(documentRoots([title, ...sections.slice(0, 4)])).toEqual(new Set());
  });

  it("an unsure section does not follow the title's topic, nor the topic most of its siblings went to", () => {
    const assigned = Object.fromEntries([[title, "Notes › Overview"], ...sections.map((s, i) => [s, i < 5 ? "Notes › Overview" : null])]);
    const r = settle(keys, assigned, [sections[5]!]);
    expect(r.assignment.get(sections[5]!)).toBeNull();
    expect(r.how.get(sections[5]!)).toBe("unplaced");
    expect(r.attach.size).toBe(0);
    expect(r.unplaced).toEqual(new Set([sections[5]]));
  });

  it("nor does it join a sibling that became a new topic: unsure sections under a title are not grouped", () => {
    const r = settle(keys, Object.fromEntries(keys.map((k) => [k, null])), sections.slice(2));
    expect([...r.how.values()]).toEqual(Array(4).fill("unplaced"));
    expect(r.attach.size).toBe(0);
  });

  it("still uses the local match, which is about the section's own words", () => {
    const r = settle(keys, Object.fromEntries(keys.map((k) => [k, null])), [sections[0]!], { [sections[0]!]: "Notes › Plans" });
    expect(r.assignment.get(sections[0]!)).toBe("Notes › Plans");
    expect(r.how.get(sections[0]!)).toBe("local");
  });

  it("the title is not a neighbour for a top-level fragment either", () => {
    const r = settleUnsure([...keys.map((k) => part(k)), part("Apps")], new Map([...keys.map((k) => [k, "Notes › Overview"] as const), ["Apps", null]]) as Assignment, new Set(["Apps"]), new Map() as Assignment);
    expect(r.how.get("Apps")).toBe("unplaced");
  });

  it("a title with few sections is an ordinary parent (a short document keeps the old rule)", () => {
    const r = settle([title, ...sections.slice(0, 2)], { [title]: "Notes › Overview", [sections[0]!]: null, [sections[1]!]: null }, [sections[0]!, sections[1]!]);
    expect(r.assignment.get(sections[0]!)).toBe("Notes › Overview");
    expect(r.how.get(sections[0]!)).toBe("parent");
  });
});
