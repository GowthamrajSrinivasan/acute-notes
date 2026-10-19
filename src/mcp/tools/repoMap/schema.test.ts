import { describe, expect, it } from "vitest";
import { parseSectionInput } from "./schema";

const section = (shape: unknown) => ({
  commit: "abc123",
  section: { key: "mod:db", label: "Storage" },
  nodes: [{ key: "sym:db", type: "shape", shape, label: "Orders DB" }],
});

describe("repo map shapes", () => {
  it("accepts a cylinder for a database or data store", () => {
    expect(parseSectionInput(section("cylinder")).nodes[0]).toMatchObject({ type: "shape", shape: "cylinder", label: "Orders DB" });
  });

  it("still rejects a shape the canvas can't draw, naming it", () => {
    expect(() => parseSectionInput(section("star"))).toThrow(/sym:db/);
  });
});

describe("Lens Phase 2: section levels and node kinds", () => {
  const input = (section: Record<string, unknown>, node: Record<string, unknown>) => ({
    commit: "abc123",
    section: { key: "mod:pay", label: "Payments", ...section },
    nodes: [{ key: "sym:pay#charge", type: "text", markdown: "Charges a card", ...node }],
  });

  it("accepts a level from 0 to 4 and an architecture kind on any card", () => {
    const parsed = parseSectionInput(input({ level: 4 }, { kind: "function" }));
    expect(parsed.section.level).toBe(4);
    expect(parsed.nodes[0]).toMatchObject({ kind: "function" });
  });

  it("rejects a level outside 0–4 and a kind that isn't an architecture kind, whole call", () => {
    expect(() => parseSectionInput(input({ level: 5 }, {}))).toThrow(/section/);
    expect(() => parseSectionInput(input({}, { kind: "decision" }))).toThrow(/sym:pay#charge/);
  });

  it("convert: the section is an interactive group with its level; a text card carries its kind; level and kind are in the content version", async () => {
    const { convertSection } = await import("./convert");
    const c = convertSection(parseSectionInput(input({ level: 2 }, { kind: "backend" })), (k) => `id_${k}`);
    expect(c.plan.nodes[0]).toMatchObject({ type: "group", content: { diagram: "architecture", level: 2 } });
    expect(c.plan.nodes.find((n) => n.stableKey === "sym:pay#charge")).toMatchObject({ type: "text", kind: "backend" });
    expect(c.text).toContain('"level":2');
    expect(c.text).toContain('"kind":"backend"');
  });
});
