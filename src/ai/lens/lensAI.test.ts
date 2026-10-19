import { describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { renderVisualPlan } from "@/ai/renderer/render";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { SceneElement } from "@/domain/canvas/adapter";
import { lensTree, lensView, singleScene } from "@/domain/lens/lensView";
import { asGeneratedLevel, asLevelPlan, assessInput, expandInput, explainInput, isCodeGrounded, matchQuestion, navigateCandidates, navigateNodes, navigateTarget, nextLevel, resolveAssessment, resolveNavigate, reviewInput, structureFacts } from "./lensAI";
import { REVIEW_QUESTIONS, localSignal, questionsFor, reviewContext, trackForLevel } from "./reviewQuestions";
import {
  lensAssessInput,
  lensExpandInput,
  lensExplainInput,
  lensNavigateInput,
  lensReviewInput,
  registerLensTasks,
  type LensAssessInput,
  type LensAssessOutput,
  type LensExpandInput,
  type LensExplainInput,
  type LensNavigateInput,
  type LensNavigateOutput,
  type LensReviewInput,
} from "./lensTasks";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", ...partial };
}
const node = (id: string, label: string, frameId: string, x: number, acuteNode: Record<string, unknown> = {}) => [
  el({ id, type: "rectangle", frameId, x, y: 20, customData: { acuteNode: { kind: "backend", key: `k.${id}`, ...acuteNode } } }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId }),
];
const frame = (id: string, name: string, x: number, level?: number) =>
  ({ ...el({ id, type: "frame", x, y: 0, width: 600, height: 200, customData: { acuteDiagram: { type: "architecture", interactive: true, ...(level !== undefined ? { level } : {}) } } }), name }) as SceneElement;
const arrow = (id: string, from: string, to: string, x: number, explanation?: string) =>
  el({ id, type: "arrow", x, y: 45, points: [[0, 0], [100, 0]], startBinding: { elementId: from }, endBinding: { elementId: to }, customData: { acuteRelation: "calls", ...(explanation ? { acuteEdge: { explanation } } : {}) } });

/** Shop (L1): Orders → Payments (Payments drills into "Payment parts", L2: Charge → Ledger). */
const SCENE: SceneElement[] = [
  frame("f1", "Shop", 0, 1),
  ...node("orders", "Orders", "f1", 20, { details: ["Takes orders", "token=sk-live-abcdefghijklmnopqrstuv"] }),
  ...node("payments", "Payments", "f1", 300, { expandsTo: { frameKey: "f2" }, sources: [{ path: "src/payments/index.ts" }] }),
  arrow("a1", "orders", "payments", 120, "Charges each order"),
  frame("f2", "Payment parts", 2000, 2),
  ...node("charge", "Charge", "f2", 2020),
  ...node("ledger", "Ledger", "f2", 2300),
  arrow("a2", "charge", "ledger", 2120),
];
const scenes = singleScene("c1", SCENE);
const root = { canvasId: "c1", frameId: "f1" };
const view = lensView(scenes, root)!;
const nodeOf = (label: string, v = view) => v.nodes.find((n) => n.label === label)!;

const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });
function runtime(reply: (req: AIRequest) => string) {
  const respond = vi.fn((req: AIRequest) => response(reply(req)));
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerLensTasks(registry);
  manager.registerProvider(createMockProvider({ id: "mock", respond }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), respond };
}

describe("Lens AI inputs (plan §6): what Lens shows, bounded, secrets redacted", () => {
  it("explainInput: the node, its links with direction and why, the levels above, its detail's nodes, evidence paths", () => {
    const input = explainInput(view, nodeOf("Orders"));
    expect(lensExplainInput.parse(input)).toEqual(input);
    expect(input).toMatchObject({ level: "L1 Architecture", frame: "Shop", path: [], children: [] });
    expect(input.node.details).toEqual(["Takes orders", "token=sk-live-[redacted]"]);
    expect(input.relations).toEqual([{ direction: "out", other: "Payments", relation: "calls", explanation: "Charges each order" }]);
    const payments = explainInput(view, nodeOf("Payments"), ["Charge", "Ledger"]);
    expect(payments.relations).toEqual([{ direction: "in", other: "Orders", relation: "calls", explanation: "Charges each order" }]);
    expect(payments.children).toEqual(["Charge", "Ledger"]);
    expect(payments.evidence).toEqual(["src/payments/index.ts"]);
    // One level down: the crumbs above it.
    const detail = lensView(scenes, root, ["k.payments"])!;
    expect(explainInput(detail, nodeOf("Charge", detail)).path).toEqual(["Shop"]);
  });

  it("nextLevel and expandInput: the next diagram level (never L5), with the node's neighbours", () => {
    expect(nextLevel(view)).toEqual({ index: 2, name: "Component" });
    const detail = lensView(scenes, root, ["k.payments"])!;
    expect(nextLevel(detail)).toEqual({ index: 3, name: "Flow" });
    expect(nextLevel({ ...detail, level: 4 })).toBeUndefined();
    const input = expandInput(view, nodeOf("Orders"), { index: 2, name: "Component" });
    expect(lensExpandInput.parse(input)).toEqual(input);
    expect(input.siblings).toEqual(["Payments"]);
  });

  it("isCodeGrounded: a node citing code (or drawn by an IDE agent) asks the agent instead", () => {
    expect(isCodeGrounded(nodeOf("Payments"))).toBe(true);
    expect(isCodeGrounded(nodeOf("Orders"))).toBe(false);
  });
});

describe("Design review: structure computed from the level, interview-style questions, assessment", () => {
  it("structureFacts: degree, shared stores, external dependencies, longest chain, isolated nodes", () => {
    const s = lensView(
      singleScene("c1", [
        frame("f1", "Shop", 0, 1),
        ...node("web", "Web", "f1", 20, { kind: "frontend" }),
        ...node("api", "API", "f1", 150),
        ...node("jobs", "Jobs", "f1", 280),
        ...node("db", "Orders DB", "f1", 410, { kind: "database" }),
        ...node("stripe", "Stripe", "f1", 540, { kind: "external" }),
        ...node("lonely", "Lonely", "f1", 670),
        arrow("a1", "web", "api", 70),
        arrow("a2", "api", "db", 200),
        arrow("a3", "jobs", "db", 330),
        arrow("a4", "api", "stripe", 260),
      ]),
      root,
    )!;
    const f = structureFacts(s);
    expect(f.sharedStores).toEqual(["Orders DB"]);
    expect(f.externalDependencies).toEqual(["Stripe"]);
    expect(f.isolated).toEqual(["Lonely"]);
    expect(f.longestChain).toEqual(["Web", "API", "Orders DB"]);
    expect(f.degree.find((d) => d.label === "API")).toMatchObject({ in: 1, out: 2 });
  });

  it("structureFacts survives a cycle", () => {
    const s = lensView(singleScene("c1", [frame("f1", "Loop", 0, 1), ...node("a", "A", "f1", 20), ...node("b", "B", "f1", 150), arrow("x", "a", "b", 70), arrow("y", "b", "a", 100)]), root)!;
    expect(structureFacts(s).longestChain).toEqual(["A", "B"]);
  });

  it("reviewInput: the whole level, redacted, figures only from the user, bounded and schema-valid", () => {
    const input = reviewInput(view, "scale", { assumptions: "2M DAU, key sk-live-abcdefghijklmnopqrstuv", factor: 10 });
    expect(lensReviewInput.parse(input)).toEqual(input);
    expect(input.nodes.map((n) => n.label)).toEqual(["Orders", "Payments"]);
    expect(input.relations).toEqual([{ from: "Orders", to: "Payments", relation: "calls", explanation: "Charges each order" }]);
    expect(input.assumptions).toContain("2M DAU");
    expect(input.assumptions).not.toContain("abcdefghijklmnopqrstuv");
    expect(JSON.stringify(input)).not.toContain("abcdefghijklmnopqrstuv"); // the planted token in Orders' details too
  });

  it("the question bank: HLD for L0–L2, LLD below; ids unique; local signals read kinds and labels", () => {
    expect(trackForLevel(1)).toBe("hld");
    expect(trackForLevel(3)).toBe("lld");
    const ids = REVIEW_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(questionsFor("hld").length).toBeGreaterThanOrEqual(10);
    expect(questionsFor("lld").length).toBeGreaterThanOrEqual(8);
    const s = lensView(singleScene("c1", [frame("f1", "Shop", 0, 1), ...node("q", "Order Queue", "f1", 20, { kind: "messagebus" }), ...node("c", "Redis Cache", "f1", 150), ...node("d", "DB", "f1", 280, { kind: "database" }), arrow("a", "q", "d", 70)]), root)!;
    const ctx = reviewContext(s.nodes, [], structureFacts(s));
    const signal = (id: string) => localSignal(REVIEW_QUESTIONS.find((q) => q.id === id)!, ctx);
    expect(signal("hld.async")).toBe("seen");
    expect(signal("hld.cache")).toBe("seen");
    expect(signal("hld.security")).toBe("not-seen");
    expect(signal("hld.spof")).toBe("unknown"); // nothing on a diagram's shape can tell
  });

  it("lens_review over the runtime: the topic's guide and the figures reach the model; nothing invented as a fact", async () => {
    const { runtime: rt, respond } = runtime(() => "**First bottleneck:** Payments.");
    const r = await rt.run<LensReviewInput, string>("lens_review", reviewInput(view, "scale", { assumptions: "5k rps peak", factor: 10 }));
    expect(r.data).toContain("Payments");
    const req = respond.mock.calls[0]![0] as AIRequest;
    expect(req.task).toBe("lens_review");
    expect(req.prompt).toContain("10×");
    expect(req.prompt).toContain("5k rps peak");
    expect(req.systemPrompt).toContain("assumption");
  });

  it("lens_assess over the runtime: one answer per asked id, unknown ids dropped, custom questions included", async () => {
    const asked = [...questionsFor("hld").slice(0, 2), { id: "custom.1", track: "hld" as const, category: "Mine", text: "Can Orders survive Payments being down?" }];
    const reply = {
      answers: [
        { id: asked[0]!.id, verdict: "partial", answer: "Orders calls Payments synchronously.", improve: "Queue the charge." },
        { id: "custom.1", verdict: "gap", answer: "No fallback shown.", improve: "Add a retry queue." },
        { id: "not.asked", verdict: "strong", answer: "Invented." },
      ],
    };
    const { runtime: rt, respond } = runtime(() => JSON.stringify(reply));
    const input = assessInput(view, "hld", asked, { assumptions: "1M users" });
    expect(lensAssessInput.parse(input)).toEqual(input);
    const r = await rt.run<LensAssessInput, LensAssessOutput>("lens_assess", input);
    const got = resolveAssessment(r.data, asked);
    expect([...got.keys()]).toEqual([asked[0]!.id, "custom.1"]);
    expect(got.get("custom.1")?.verdict).toBe("gap");
    const req = respond.mock.calls[0]![0] as AIRequest;
    expect(req.prompt).toContain("Can Orders survive Payments being down?");
    expect(req.prompt).toContain("1M users");
    expect(req.prompt).not.toContain("abcdefghijklmnopqrstuv");
  });

  it("lens_assess refuses a verdict outside the set (repair, then invalid output)", async () => {
    const { runtime: rt } = runtime(() => JSON.stringify({ answers: [{ id: "hld.spof", verdict: "great", answer: "x" }] }));
    await expect(rt.run("lens_assess", assessInput(view, "hld", questionsFor("hld").slice(0, 1)))).rejects.toThrow();
  });
});

describe("Ask (§6.2): local names first, keys only to the model", () => {
  const tree = lensTree(scenes, root)!;
  const candidates = navigateCandidates(tree);

  it("lists every node with where it is, sending only key, label and level", () => {
    expect(candidates.map((c) => [c.label, c.level, c.path])).toEqual([
      ["Orders", 1, []],
      ["Payments", 1, []],
      ["Charge", 2, ["k.payments"]],
      ["Ledger", 2, ["k.payments"]],
    ]);
    expect(navigateNodes(candidates)[0]).toEqual({ key: "k.orders", label: "Orders", level: 1 });
    expect(lensNavigateInput.parse({ question: "q", nodes: navigateNodes(candidates) }).nodes).toHaveLength(4);
  });

  it("matchQuestion: names in the question's order, plurals and case ignored; nothing for an unnamed question", () => {
    expect(matchQuestion("How do orders reach the ledger?", candidates)).toEqual({ from: "k.orders", to: "k.ledger" });
    expect(matchQuestion("what does PAYMENTS do", candidates)).toEqual({ from: "k.payments", to: null });
    expect(matchQuestion("where is money taken", candidates)).toEqual({ from: null, to: null });
  });

  it("navigateTarget: the lowest level both share, on the node leading to the first", () => {
    const at = (k: string) => candidates.find((c) => c.key === k)!;
    expect(navigateTarget(at("k.orders"), at("k.ledger"))).toEqual({ path: [], nodeKey: "k.orders" });
    expect(navigateTarget(at("k.charge"), at("k.ledger"))).toEqual({ path: ["k.payments"], nodeKey: "k.charge" });
    expect(navigateTarget(at("k.charge"), at("k.orders"))).toEqual({ path: [], nodeKey: "k.payments" });
    expect(navigateTarget(at("k.charge"), undefined)).toEqual({ path: ["k.payments"], nodeKey: "k.charge" });
  });

  it("lens_navigate over the runtime: the model's keys are kept only when they were given", async () => {
    const { runtime: rt, respond } = runtime(() => JSON.stringify({ from: "k.charge", to: "k.invented" }));
    const r = await rt.run<LensNavigateInput, LensNavigateOutput>("lens_navigate", { question: "where is money taken", nodes: navigateNodes(candidates) });
    expect(resolveNavigate(r.data, candidates)).toEqual({ from: "k.charge", to: null });
    const prompt = (respond.mock.calls[0]![0] as AIRequest).prompt;
    expect(prompt).toContain("where is money taken");
    expect(prompt).toContain('"key":"k.ledger"');
    expect(prompt).not.toContain("src/payments"); // labels and keys only
    expect(resolveNavigate({ from: "nope", to: "k.orders" }, candidates)).toEqual({ from: "k.orders", to: null });
  });
});

describe("lens_explain and lens_expand over the runtime (mock provider, canned replies)", () => {
  it("lens_explain sends the facts and returns the reply text", async () => {
    const { runtime: rt, respond } = runtime(() => "Orders takes each order and asks **Payments** to charge it.");
    const r = await rt.run<LensExplainInput, string>("lens_explain", explainInput(view, nodeOf("Orders")));
    expect(r.data).toContain("Payments");
    const req = respond.mock.calls[0]![0] as AIRequest;
    expect(req.task).toBe("lens_explain");
    expect(req.prompt).toContain("Charges each order");
    expect(req.prompt).not.toContain("abcdefghijklmnopqrstuv");
  });

  it("lens_expand: a plan becomes one interactive frame at the next level, links keeping the model's confidence", async () => {
    const reply = {
      version: 1,
      template: "architecture",
      nodes: [
        { id: "g", type: "group", content: { label: "Invented section", arrangement: "grid" } },
        { id: "n1", type: "shape", parent: "g", content: { shape: "rectangle", label: "Cart" } },
        { id: "n2", type: "shape", content: { shape: "rectangle", label: "Checkout", kind: "frontend" } },
      ],
      relationships: [{ from: "n1", to: "n2", type: "flows_to", label: "items", confidence: 0.6 }],
      metadata: { title: "Orders" },
    };
    const { runtime: rt, respond } = runtime(() => JSON.stringify(reply));
    const level = nextLevel(view)!;
    const r = await rt.run<LensExpandInput, unknown>("lens_expand", expandInput(view, nodeOf("Orders"), level));
    expect((respond.mock.calls[0]![0] as AIRequest).prompt).toContain('"confidence"');
    const plan = asLevelPlan(validateVisualPlan(r.data).plan, level.index);
    expect(plan.nodes.map((n) => n.type)).toEqual(["shape", "shape"]);
    expect(plan.nodes[0]!.type === "shape" && plan.nodes[0]!.content.kind).toBe("backend"); // the level's default
    expect(plan.relationships[0]!.confidence).toBe(0.6);
    const rendered = await renderVisualPlan(plan, { operationId: "op1", title: "t", metadata: { createdBy: "ai", task: "lens_expand" }, context: { existing: [], viewport: { x: 0, y: 0, width: 1400, height: 900 } }, parseMarkdown: (md) => [{ type: "paragraph", content: md }] as never });
    const generated = asGeneratedLevel(rendered, { label: "Orders" }, level.index)!;
    const frames = generated.set.changes.filter((c) => c.kind === "create_frame");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ key: generated.frameKey, title: "Orders · L2", level: 2 });
    expect(generated.set.changes.find((c) => c.kind === "connect")).toMatchObject({ relation: "flows_to", confidence: 0.6 });
  });
});
