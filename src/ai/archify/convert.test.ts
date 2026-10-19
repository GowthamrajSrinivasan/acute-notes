/**
 * Frames Phase 3: Archify architecture documents and architecture-like Mermaid flowcharts become plans whose frames
 * are interactive diagrams, with no model call.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { planLocally } from "@/ai/content/localPlanner";
import { parseContent } from "@/ai/content/parser";
import { convertMermaid } from "@/ai/mermaid";
import { guessComponentKinds, kindOfComponent } from "@/ai/mermaid/componentKinds";
import { renderVisualPlan } from "@/ai/renderer/render";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { convertArchify, detectArchify } from "./convert";

/** Shaped like the Archify skill's examples (`examples/*.architecture.json`). */
const KNOWFLOW = {
  schema_version: 1,
  diagram_type: "architecture",
  meta: { title: "CMG KnowFlow RAG", subtitle: "Routing and answering", views: [{ id: "v", label: "Path", focus: ["entry"] }] },
  components: [
    { id: "entry", type: "frontend", label: "CLI & Dev UI", sublabel: "query.py · dev_ui.py", tag: "WORKSPACE=auto", pos: [30, 368], size: [140, 64] },
    { id: "router", type: "backend", label: "Manual router", sublabel: "manuals.py", sources: [{ path: "manuals.py", line: 372 }] },
    { id: "indexes", type: "database", label: "Keyword indexes", sublabel: "keyword_index/*.json" },
    { id: "gemini", type: "cloud", label: "Gemini API" },
    { id: "gates", type: "security", label: "Validation gates" },
  ],
  boundaries: [
    { kind: "region", label: "run_query", wraps: ["router", "gates"] },
    { kind: "region", label: "Local stores", wraps: ["indexes", "router"] },
  ],
  connections: [
    { id: "q", from: "entry", to: "router", label: "question", variant: "emphasis" },
    { from: "router", to: "indexes", label: "owner lookup" },
    { from: "router", to: "gemini", label: "generate", variant: "dashed" },
    { from: "gates", to: "nowhere" },
  ],
  cards: [{ dot: "amber", title: "Cost", items: ["About $16 per manual"] }, { dot: "pink", title: "Routing", items: ["Free first"] }],
};

const context = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const render = (plan: VisualPlan) =>
  renderVisualPlan(plan, { operationId: "op", title: "Visualize", metadata: { createdBy: "import" }, context, parseMarkdown: (md) => [{ type: "paragraph", content: md }] });
const shape = (plan: VisualPlan, id: string) => plan.nodes.find((n): n is Extract<VisualNode, { type: "shape" }> => n.id === id && n.type === "shape");

describe("Archify import", () => {
  it("detects an Archify document, bare or in one json fence, and nothing else", () => {
    const json = JSON.stringify(KNOWFLOW);
    expect(detectArchify(json)?.diagram_type).toBe("architecture");
    expect(detectArchify("```json\n" + json + "\n```")?.diagram_type).toBe("architecture");
    expect(detectArchify('{"name":"package"}')).toBeNull();
    expect(detectArchify("{ not json")).toBeNull();
    expect(detectArchify("# Notes\n\n" + json)).toBeNull();
  });

  it("maps components, boundaries, connections and cards into sections of interactive diagrams", () => {
    const result = convertArchify(KNOWFLOW);
    if (!result.ok) throw new Error(result.reason);
    const { plan, warnings } = result;
    expect(plan.template).toBe("sectioned");
    expect(shape(plan, "entry")?.content).toMatchObject({ shape: "rectangle", label: "CLI & Dev UI", kind: "frontend", sublabel: "query.py · dev_ui.py", tag: "WORKSPACE=auto" });
    expect(shape(plan, "indexes")?.content).toMatchObject({ shape: "cylinder", kind: "database" });
    expect(shape(plan, "entry")?.stableKey).toBe("archify:entry");

    const groups = plan.nodes.filter((n): n is Extract<VisualNode, { type: "group" }> => n.type === "group");
    expect(groups.map((g) => g.content.label)).toEqual(["run_query", "Local stores", "CMG KnowFlow RAG"]);
    expect(groups.every((g) => g.content.diagram === "architecture")).toBe(true);
    // A component in two boundaries is drawn in the first; components in none share a section named after the diagram.
    expect(shape(plan, "router")?.parent).toBe(groups[0]!.id);
    expect(shape(plan, "indexes")?.parent).toBe(groups[1]!.id);
    expect(shape(plan, "entry")?.parent).toBe(groups[2]!.id);
    // Card dots become kinds; an unknown dot leaves the card without one.
    expect(groups[0]!.content.cards).toEqual([
      { kind: "cloud", title: "Cost", items: ["About $16 per manual"] },
      { title: "Routing", items: ["Free first"] },
    ]);

    expect(plan.relationships).toEqual([
      { from: "entry", to: "router", type: "flows_to", label: "question" },
      { from: "router", to: "indexes", type: "flows_to", label: "owner lookup" },
      { from: "router", to: "gemini", type: "depends_on", label: "generate" },
    ]);
    expect(warnings.join(" | ")).toMatch(/positions and sizes aren't used/);
    expect(warnings.join(" | ")).toMatch(/1 component is in more than one boundary/);
    expect(warnings.join(" | ")).toMatch(/1 connection to an unknown component left out/);
    expect(warnings.join(" | ")).toMatch(/source references on 1 component aren't imported yet/);
    expect(warnings.join(" | ")).toMatch(/guided views aren't imported yet/);
  });

  it("without boundaries, makes one architecture plan that renders as one interactive frame with the cards", async () => {
    const { boundaries: _b, ...flat } = KNOWFLOW;
    const result = convertArchify(flat);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.template).toBe("architecture");
    const set = parseChangeSet(await render(result.plan));
    const frames = set.changes.filter((c) => c.kind === "create_frame");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ overview: { title: "CMG KnowFlow RAG" }, diagram: { cards: [{ kind: "cloud", title: "Cost" }, { title: "Routing" }] } });
    expect(set.changes.filter((c) => c.kind === "create_shape").map((c) => c.kind === "create_shape" && c.semantics?.kind)).toEqual(["frontend", "backend", "database", "cloud", "security"]);
  });

  it("refuses other Archify diagram types and empty documents, with a reason", () => {
    expect(convertArchify({ diagram_type: "sequence", participants: [] })).toMatchObject({ ok: false, reason: expect.stringContaining("only architecture") });
    expect(convertArchify({ diagram_type: "architecture", components: [] })).toMatchObject({ ok: false, reason: expect.stringContaining("no components") });
  });

  it("is the local plan for pasted Archify JSON: no model call", async () => {
    const input = JSON.stringify(KNOWFLOW, null, 2);
    const local = planLocally(await parseContent(input), input);
    expect(local.sufficient).toBe(true);
    expect(local.aiRecommended).toBeUndefined();
    expect(local.reasons[0]).toMatch(/Archify architecture diagram/);
    expect(local.plan?.nodes.some((n) => n.type === "shape" && n.content.kind === "security")).toBe(true);
  });
});

describe("Mermaid component kinds", () => {
  it("reads a cylinder as a store, and labels by their words", () => {
    expect(kindOfComponent("Orders", "cylinder")).toBe("database");
    expect(kindOfComponent("Postgres", "rect")).toBe("database");
    expect(kindOfComponent("Kafka topic", "rect")).toBe("messagebus");
    expect(kindOfComponent("Auth service", "rect")).toBe("security");
    expect(kindOfComponent("Web app", "rect")).toBe("frontend");
    expect(kindOfComponent("Order API", "rect")).toBe("backend");
    expect(kindOfComponent("Validate input", "rect")).toBeUndefined();
  });

  it("only switches on when most nodes read as components", () => {
    const node = (id: string, label: string) => ({ id, label, shape: "rect" as const });
    expect(guessComponentKinds([node("a", "Web app"), node("b", "API"), node("c", "Postgres"), node("d", "Mailer")])?.size).toBe(3);
    expect(guessComponentKinds([node("a", "Start"), node("b", "Validate"), node("c", "API"), node("d", "Retry"), node("e", "Done")])).toBeNull();
    expect(guessComponentKinds([node("a", "API"), node("b", "DB")])).toBeNull();
  });

  it("gives an architecture-like flowchart kinds and the architecture template; leaves a process flowchart alone", () => {
    const arch = convertMermaid("flowchart LR\nui[Web app] --> api[Order API]\napi --> db[(Orders)]\napi --> q[Kafka]\nq --> api");
    if (!arch.ok) throw new Error("conversion failed");
    expect(arch.plan.template).toBe("architecture");
    expect(shape(arch.plan, "db")?.content).toMatchObject({ shape: "cylinder", kind: "database" });
    expect(shape(arch.plan, "q")?.content.kind).toBe("messagebus");
    expect(arch.warnings.join(" ")).toMatch(/guessed component kinds for 4 of 4 nodes/);

    const process = convertMermaid("flowchart LR\nA[Start] --> B[Validate] --> C[Save] --> D[Done]");
    if (!process.ok) throw new Error("conversion failed");
    expect(process.plan.nodes.some((n) => n.type === "shape" && n.content.kind)).toBe(false);
    expect(process.plan.template).not.toBe("architecture");
  });
});
