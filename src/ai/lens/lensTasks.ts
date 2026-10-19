/**
 * Acute Lens's AI tasks (plan §6, Phase 5), on the existing runtime and the user's own connection (D18): nothing
 * here writes anything. Each input is built from what Lens already shows (`lensAI.ts`), bounded and with secrets
 * redacted, so a level's whole canvas never goes to the model.
 *
 * - `lens_explain` (text): a short explanation of one node at its level — what it is, its role here, how it relates.
 * - `lens_navigate` (JSON): only when local name matching fails, maps a question onto the keys Lens already has
 *   (labels and keys only).
 * - `lens_expand` (JSON `VisualPlan`, the architecture template): a proposed next level for a node with no detail
 *   frame. It is the model's informed proposal, not a fact from the code: every link carries a `confidence`.
 * - `lens_review` (text): the level reviewed against one design question (requirements, capacity, "what breaks at 10×",
 *   failure modes, tradeoffs), over the diagram plus structure computed from it. Figures come only from the user's
 *   assumptions; anything else is labelled an assumption.
 */
import { z } from "zod";
import type { DecisionAnswer, DecisionTask } from "@/ai/decisions/types";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import { ARCHITECTURE_RULE } from "@/ai/visualize/tasks";
import { planEnvelopeSchema } from "@/ai/visual-plan/schema";

export const LENS_AI_LIMITS = { relations: 40, children: 40, evidence: 20, path: 8, navigateNodes: 400, question: 300, siblings: 40, expandShapes: 10, reviewNodes: 60, reviewRelations: 120, reviewDecisions: 12, assumptions: 600, assessQuestions: 24 } as const;

const short = (max: number) => z.string().trim().min(1).max(max);

/** One node as Lens shows it: its label and descriptive fields. */
export const lensNodeFacts = z.object({
  label: short(200),
  kind: short(40).optional(),
  sublabel: short(120).optional(),
  details: z.array(short(200)).max(8).optional(),
});
export type LensNodeFacts = z.infer<typeof lensNodeFacts>;

/** A relation of the node on its level, from the node's side. */
export const lensRelationFacts = z.object({
  direction: z.enum(["out", "in"]),
  other: short(200),
  relation: short(40).optional(),
  label: short(120).optional(),
  explanation: short(300).optional(),
});

export const lensExplainInput = z.object({
  node: lensNodeFacts,
  /** "L2 Component". */
  level: short(60),
  /** The frame's title, then the levels above it (root first). */
  frame: short(200),
  path: z.array(short(200)).max(LENS_AI_LIMITS.path),
  relations: z.array(lensRelationFacts).max(LENS_AI_LIMITS.relations),
  /** Labels of the nodes one level down, when it has a detail frame. */
  children: z.array(short(200)).max(LENS_AI_LIMITS.children),
  /** Code paths and document labels its evidence names (never file contents: Acute reads no files). */
  evidence: z.array(short(300)).max(LENS_AI_LIMITS.evidence),
});
export type LensExplainInput = z.infer<typeof lensExplainInput>;

export const lensNavigateInput = z.object({
  question: short(LENS_AI_LIMITS.question),
  nodes: z.array(z.object({ key: short(200), label: short(200), level: z.number().int().min(0).max(5) })).min(1).max(LENS_AI_LIMITS.navigateNodes),
});
export type LensNavigateInput = z.infer<typeof lensNavigateInput>;

/** Keys from the list given, or null; checked against that list again after the reply (`resolveNavigate`). */
export const lensNavigateOutput = z.object({ from: z.string().min(1).nullable(), to: z.string().min(1).nullable() });
export type LensNavigateOutput = z.infer<typeof lensNavigateOutput>;

export const lensExpandInput = z.object({
  node: lensNodeFacts,
  /** The level to generate: its number and name ("3", "Flow"). */
  level: z.object({ index: z.number().int().min(1).max(4), name: short(40) }),
  frame: short(200),
  path: z.array(short(200)).max(LENS_AI_LIMITS.path),
  relations: z.array(lensRelationFacts).max(LENS_AI_LIMITS.relations),
  /** The node's neighbours on its own level, for context. */
  siblings: z.array(short(200)).max(LENS_AI_LIMITS.siblings),
});
export type LensExpandInput = z.infer<typeof lensExpandInput>;

/** The design questions Lens can review a level against (the ones an HLD discussion asks). */
export const LENS_REVIEW_TOPICS = ["requirements", "capacity", "scale", "failure", "tradeoffs"] as const;
export type LensReviewTopic = (typeof LENS_REVIEW_TOPICS)[number];

/** Facts computed from the level's graph, so the model reasons over structure instead of guessing it. */
export const lensStructureFacts = z.object({
  /** Per node: how many links come in and go out on this level. */
  degree: z.array(z.object({ label: short(200), kind: short(40).optional(), in: z.number().int().min(0), out: z.number().int().min(0) })).max(LENS_AI_LIMITS.reviewNodes),
  /** Stores (database / store) that two or more nodes reach: shared write or read contention points. */
  sharedStores: z.array(short(200)).max(20),
  /** External or cloud nodes the system depends on. */
  externalDependencies: z.array(short(200)).max(20),
  /** The longest chain of links (labels, in order) on this level; a path every request through it must walk. */
  longestChain: z.array(short(200)).max(20),
  /** Nodes with no links at all: not connected to the rest, so not reasoned about. */
  isolated: z.array(short(200)).max(20),
});
export type LensStructureFacts = z.infer<typeof lensStructureFacts>;

export const lensReviewInput = z.object({
  topic: z.enum(LENS_REVIEW_TOPICS),
  /** The user's own wording, when they typed one ("what if the cart service dies?"). */
  question: short(LENS_AI_LIMITS.question).optional(),
  /** Numbers and constraints the user gave ("2M DAU, 5% peak, read-heavy"). The only source of figures. */
  assumptions: short(LENS_AI_LIMITS.assumptions).optional(),
  /** The growth factor for `scale` (default 10). */
  factor: z.number().min(2).max(1000).optional(),
  level: short(60),
  frame: short(200),
  path: z.array(short(200)).max(LENS_AI_LIMITS.path),
  nodes: z.array(lensNodeFacts).min(1).max(LENS_AI_LIMITS.reviewNodes),
  relations: z.array(z.object({ from: short(200), to: short(200), relation: short(40).optional(), label: short(120).optional(), explanation: short(300).optional() })).max(LENS_AI_LIMITS.reviewRelations),
  structure: lensStructureFacts,
  /** Decisions and constraints on the open project, when there is one (statements only). */
  decisions: z.array(short(300)).max(LENS_AI_LIMITS.reviewDecisions),
});
export type LensReviewInput = z.infer<typeof lensReviewInput>;

export const LENS_VERDICTS = ["strong", "partial", "gap", "unknown"] as const;
export type LensVerdict = (typeof LENS_VERDICTS)[number];

export const lensAssessInput = lensReviewInput.omit({ topic: true, question: true, factor: true }).extend({
  track: z.enum(["hld", "lld"]),
  /** The questions to answer: the bank's for the track plus the user's own. */
  questions: z.array(z.object({ id: short(80), category: short(60), text: short(LENS_AI_LIMITS.question) })).min(1).max(LENS_AI_LIMITS.assessQuestions),
});
export type LensAssessInput = z.infer<typeof lensAssessInput>;

export const lensAssessOutput = z.object({
  answers: z
    .array(
      z.object({
        id: z.string().min(1),
        verdict: z.enum(LENS_VERDICTS),
        /** Plain answer from the diagram, ≤ ~60 words. */
        answer: z.string().trim().min(1).max(700),
        /** One concrete improvement, when the verdict isn't "strong". */
        improve: z.string().trim().min(1).max(400).optional(),
      }),
    )
    .max(LENS_AI_LIMITS.assessQuestions),
});
export type LensAssessOutput = z.infer<typeof lensAssessOutput>;

const markdownOutput = z.string().refine((s) => s.trim().length > 0, "Empty response");

const SYSTEM =
  "You are the assistant inside Acute Lens, which shows a software architecture level by level (L0 system, L1 architecture, " +
  "L2 components, L3 flows, L4 operations, L5 source). You work only from the facts given. Never invent facts the input " +
  "doesn't support; say plainly when something isn't known from it.";

function withRepair(prompt: string, repairFeedback?: string): string {
  return repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt;
}

const facts = (input: { node: LensNodeFacts; frame: string; path: readonly string[]; relations: readonly z.infer<typeof lensRelationFacts>[] }) =>
  JSON.stringify({ node: input.node, frame: input.frame, levelsAbove: input.path, relations: input.relations });

export const lensExplainTask: TaskDefinition<LensExplainInput, string> = {
  task: "lens_explain",
  inputSchema: lensExplainInput,
  outputSchema: markdownOutput,
  outputFormat: "text",
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt: SYSTEM,
    prompt: withRepair(
      `Explain the node "${input.node.label}" as it appears at ${input.level}, in the frame "${input.frame}", to a developer seeing it for the first time: ` +
        `what it is, its role at this level, and how it relates to the nodes it connects to (say which way each link goes and what passes, when the facts say). ` +
        (input.children.length ? `It has a more detailed level below with: ${input.children.join(", ")}. Mention how that detail fits. ` : "") +
        (input.evidence.length ? `Its evidence names: ${input.evidence.join("; ")} (paths only — you can't see the code). ` : "") +
        `Keep it under 180 words, in concise Markdown (short paragraphs or bullets; no top-level title; no code fence around the reply).\n\n` +
        `Facts:\n${facts(input)}`,
      repairFeedback,
    ),
  }),
  policy: {},
};

export const lensNavigateTask: TaskDefinition<LensNavigateInput, LensNavigateOutput> = {
  task: "lens_navigate",
  inputSchema: lensNavigateInput,
  outputSchema: lensNavigateOutput,
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt: SYSTEM,
    prompt: withRepair(
      `A user asked Lens: «${input.question}». Pick the node the question starts from ("from") and, when it is about how two things connect, the node it ends at ("to"), ` +
        `from this list only. Use each node's "key" exactly as given; null when no node fits. ` +
        `Reply with JSON only, exactly this shape: {"from":"<key or null>","to":"<key or null>"}.\n\n` +
        `Nodes:\n${input.nodes.map((n) => JSON.stringify(n)).join("\n")}`,
      repairFeedback,
    ),
  }),
  // Routing, not authoring: the decision model, when the user configured one.
  policy: { preferDecisionModel: true },
};

/** The "no node" choice of the typed question. */
const NO_NODE = "__none__";
/** How sure the decision model must be, else the chat model answers instead. */
const NAVIGATE_MIN_CONFIDENCE = 0.5;
/** A typed choice holds at most this many options (the vendors allow 255). */
const NAVIGATE_MAX_CHOICES = 254;

const chosen = (a: DecisionAnswer | undefined) => (a?.type === "choice" ? a : null);

/**
 * `lens_navigate` as a decision (decision models, `ai/decisions`): two closed questions over the nodes Lens already has —
 * which node the question starts from, and (when it is about how two things connect) which it ends at. Answered by the
 * user's typed decision model when they enabled one; `lens_navigate` above answers otherwise, and whenever this can't
 * (more nodes than a choice holds) or the decision model isn't sure.
 */
export const lensNavigateDecision: DecisionTask<LensNavigateInput, LensNavigateOutput> = {
  fallbackTask: "lens_navigate",
  timeoutMs: 15_000,
  buildRequest: (input) => {
    if (input.nodes.length < 2 || input.nodes.length > NAVIGATE_MAX_CHOICES) return null;
    const nodes = input.nodes.map((n) => ({ value: n.key, description: `${n.label} (level ${n.level})` }));
    return {
      state: { question: input.question },
      questions: {
        from: {
          type: "choice",
          instructions: "Which node does the question start from or mainly ask about? Choose \"none\" when no node fits.",
          choices: [...nodes, { value: NO_NODE, description: "none: no node fits the question" }],
        },
        to: {
          type: "choice",
          instructions: "When the question is about how two things connect, which node does it end at? Choose \"none\" when it asks about one node only.",
          choices: [...nodes, { value: NO_NODE, description: "none: the question asks about one node only" }],
        },
      },
    };
  },
  interpret: (answers, input) => {
    const from = chosen(answers.from);
    if (!from || from.confidence < NAVIGATE_MIN_CONFIDENCE) return null;
    const known = new Set(input.nodes.map((n) => n.key));
    const to = chosen(answers.to);
    const fromKey = known.has(from.choice) ? from.choice : null;
    const toKey = to && to.confidence >= NAVIGATE_MIN_CONFIDENCE && known.has(to.choice) && to.choice !== fromKey ? to.choice : null;
    // "none" is an answer (no node fits); a choice that isn't one of the nodes given is not.
    if (!fromKey && from.choice !== NO_NODE) return null;
    return { from: fromKey, to: fromKey ? toKey : null };
  },
};

const LEVEL_GUIDE: Record<number, string> = {
  1: 'the main components of this system (kinds "frontend", "backend", "database", "cloud", "security", "messagebus", "external")',
  2: 'the parts of this component — modules, services, stores (kinds "backend", "frontend", "database", "messagebus", "external", "store")',
  3: 'the steps of its main flow in order, linked "flows_to" (kinds "endpoint", "step", "event", "store")',
  4: 'the operations (functions) doing the work, linked by what calls what (kind "function", with "store" or "event" where data or events are involved)',
};

export const lensExpandTask: TaskDefinition<LensExpandInput, unknown> = {
  task: "lens_expand",
  inputSchema: lensExpandInput,
  outputSchema: planEnvelopeSchema,
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt:
      "You turn a description of one architecture component into a VisualPlan: a structured description for an app to render as native objects. " +
      "You never generate an image, HTML, or any UI yourself — only this JSON structure.",
    prompt: withRepair(
      `Propose the next level down (L${input.level.index} ${input.level.name}) for "${input.node.label}": ${LEVEL_GUIDE[input.level.index] ?? LEVEL_GUIDE[2]}. ` +
        `You don't see the code: this is your informed proposal from the facts below, which the user will review and edit, so keep it small and plausible — ` +
        `at most ${LENS_AI_LIMITS.expandShapes} shapes, each a short label. Never repeat "${input.node.label}" itself as a node, and don't redraw its neighbours.\n` +
        `Reply with JSON only, exactly this shape:\n` +
        `{"version":1,"template":"architecture","nodes":[{"id":"n1","type":"shape","content":{"shape":"rectangle","label":"...","kind":"..."}}, ...],` +
        `"relationships":[{"from":"n1","to":"n2","type":"flows_to","label":"what passes","confidence":0.7}],"metadata":{"title":"${input.node.label}"}}\n` +
        `Give every relationship a "confidence" from 0 to 1: how sure you are it exists, given only these facts.\n\n` +
        ARCHITECTURE_RULE +
        `Facts:\n${facts(input)}\nIts neighbours at its own level: ${input.siblings.join(", ") || "(none)"}.`,
      repairFeedback,
    ),
  }),
  policy: {},
};

const REVIEW_GUIDE: Record<LensReviewTopic, (i: LensReviewInput) => string> = {
  requirements: () =>
    "Derive the requirements this architecture implies. Sections: **Functional** (what the components together must do, from the nodes and links), " +
    "**Non-functional** (availability, latency, consistency, durability, security: only those the structure hints at, each with the evidence), " +
    "**Out of scope / not shown**, and **Questions to confirm** (what a requirements discussion would ask next).",
  capacity: () =>
    "Do a back-of-envelope capacity estimate. Use ONLY the figures in the assumptions; if one is missing, state a clearly labelled assumed value and what it stands for. " +
    "Sections: **Inputs** (given vs assumed), **Traffic** (average and peak requests/s per entry point, with the arithmetic), **Per component** " +
    "(load, storage growth, bandwidth where the structure shows data moving), and **What to measure** to replace the assumptions.",
  scale: (i) =>
    `Answer: what breaks at ${i.factor ?? 10}× the current load? Walk the request path along the links and the longest chain, and for each component say what saturates first ` +
    "(connections, CPU, queue depth, storage, a shared store, an external rate limit), in the order it would fail, with the reason from the structure. " +
    "Then **First bottleneck**, **Mitigations** (cheapest first: cache, scale out, partition, queue, backpressure), and **What to measure** to know early. " +
    "Without a baseline in the assumptions, reason in relative terms (×factor), never absolute numbers.",
  failure: () =>
    "Do a failure-mode review. For each component or dependency that matters (shared stores, external dependencies, the longest chain), give: how it fails, " +
    "what the user sees, whether the failure spreads along the links, and a mitigation (timeout, retry with backoff, circuit breaker, fallback, redundancy). " +
    "End with **Single points of failure** and **What to monitor**.",
  tradeoffs: () =>
    "Name the main design tradeoffs this structure makes (for example sync calls vs events, a shared store vs separate stores, a monolith boundary vs services). " +
    "For each: **Chosen** (what the diagram shows), **Gains**, **Costs**, **Would change if** (the condition that flips it). Do not recommend a rewrite.",
};

export const lensReviewTask: TaskDefinition<LensReviewInput, string> = {
  task: "lens_review",
  inputSchema: lensReviewInput,
  outputSchema: markdownOutput,
  outputFormat: "text",
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt:
      SYSTEM +
      " You are reviewing a design the way a senior engineer would in an architecture discussion. Keep three things visibly apart: what the diagram shows, " +
      "what the user assumed, and what you are assuming. Never present a number that is not in the assumptions as a fact about this system; label every figure you add as an assumption.",
    prompt: withRepair(
      `Level ${input.level}, frame "${input.frame}". ${REVIEW_GUIDE[input.topic](input)} ` +
        (input.question ? `The user asked: «${input.question}». Answer that first, in the same structure. ` : "") +
        `Keep it under 350 words, in concise Markdown (headings as bold lines or "###", bullets; no top-level title; no code fence around the reply). ` +
        `Refer to components by their labels. If the diagram is too thin to answer a part, say what is missing instead of filling it in.\n\n` +
        `Assumptions given by the user: ${input.assumptions ?? "(none)"}\n` +
        `Decisions and constraints on record: ${input.decisions.length ? input.decisions.join("; ") : "(none)"}\n\n` +
        `Diagram:\n${JSON.stringify({ levelsAbove: input.path, nodes: input.nodes, relations: input.relations })}\n` +
        `Structure computed from the diagram:\n${JSON.stringify(input.structure)}`,
      repairFeedback,
    ),
  }),
  policy: {},
};

export const lensAssessTask: TaskDefinition<LensAssessInput, LensAssessOutput> = {
  task: "lens_assess",
  inputSchema: lensAssessInput,
  outputSchema: lensAssessOutput,
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt:
      SYSTEM +
      " You assess a design the way an interviewer scrutinises an " +
      (input.track === "hld" ? "HLD (components, data, scale, reliability)" : "LLD (steps, operations, contracts, correctness)") +
      ". Judge only what the diagram and the facts show; a part the diagram doesn't show is \"unknown\" or a \"gap\", never assumed present.",
    prompt: withRepair(
      `Level ${input.level}, frame "${input.frame}". Answer each question below about this diagram. For each give a "verdict": ` +
        `"strong" (the diagram clearly handles it), "partial" (handled in part or implied), "gap" (the diagram shows it is missing or weak), ` +
        `"unknown" (the diagram can't tell). Give a short "answer" (under 60 words, naming components by label) and, unless "strong", one concrete "improve".\n` +
        `Use only these figures from the user: ${input.assumptions ?? "(none given; label any figure you add as an assumption)"}.\n` +
        `Decisions and constraints on record: ${input.decisions.length ? input.decisions.join("; ") : "(none)"}\n` +
        `Reply with JSON only, exactly: {"answers":[{"id":"<question id>","verdict":"partial","answer":"...","improve":"..."}]}, one entry per question, ids exactly as given.\n\n` +
        `Questions:\n${input.questions.map((q) => JSON.stringify(q)).join("\n")}\n\n` +
        `Diagram:\n${JSON.stringify({ levelsAbove: input.path, nodes: input.nodes, relations: input.relations })}\n` +
        `Structure computed from the diagram:\n${JSON.stringify(input.structure)}`,
      repairFeedback,
    ),
  }),
  // A long structured answer over a whole level: allow longer than the host's default.
  timeoutMs: 120_000,
  policy: {},
};

/** Registers the Lens tasks once (idempotent, so hot reload and tests can call it freely). */
export function registerLensTasks(registry: TaskRegistry): void {
  for (const t of [lensExplainTask, lensNavigateTask, lensExpandTask, lensReviewTask, lensAssessTask] as TaskDefinition<never, unknown>[]) if (!registry.has(t.task)) registry.register(t);
}

registerLensTasks(getTaskRegistry());
