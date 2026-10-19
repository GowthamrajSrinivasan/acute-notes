/**
 * Fixtures for every template (F29's coding-agent prompt asks for these),
 * plus a handful of malformed plans. Used by `validate.test.ts`; also handy
 * for exercising F30's renderer against a known-good plan per template once
 * it exists.
 */
import type { VisualPlan } from "./types";

/** One valid, minimal-but-representative plan per template. */
export const VALID_PLAN_FIXTURES: Readonly<Record<VisualPlan["template"], VisualPlan>> = {
  flow: {
    version: 1,
    template: "flow",
    metadata: { title: "Login flow" },
    nodes: [
      { id: "n1", type: "shape", role: "step", content: { shape: "rectangle", label: "User logs in" } },
      { id: "n2", type: "shape", role: "step", content: { shape: "rectangle", label: "API validates" } },
      { id: "n3", type: "shape", role: "step", content: { shape: "rectangle", label: "Token issued" } },
    ],
    relationships: [
      { from: "n1", to: "n2", type: "relates_to" },
      { from: "n2", to: "n3", type: "relates_to" },
    ],
  },
  problem_cause_solution: {
    version: 1,
    template: "problem_cause_solution",
    metadata: { title: "Checkout is failing" },
    nodes: [
      { id: "problem", type: "shape", role: "problem", content: { shape: "rectangle", label: "Checkout fails intermittently" } },
      { id: "cause1", type: "shape", role: "cause", content: { shape: "rectangle", label: "Gateway timeouts" } },
      { id: "cause2", type: "shape", role: "cause", content: { shape: "rectangle", label: "Stale idempotency keys" } },
      { id: "solution1", type: "todo", role: "solution", content: { items: [{ text: "Add retry with backoff", checked: false }] } },
    ],
    relationships: [
      { from: "cause1", to: "problem", type: "caused_by" },
      { from: "cause2", to: "problem", type: "caused_by" },
      { from: "solution1", to: "cause1", type: "supports" },
    ],
  },
  concept_map: {
    version: 1,
    template: "concept_map",
    nodes: [
      { id: "n1", type: "shape", role: "center", content: { shape: "ellipse", label: "Idempotency" } },
      { id: "n2", type: "shape", content: { shape: "ellipse", label: "Retry safety" } },
      { id: "n3", type: "shape", content: { shape: "ellipse", label: "Order id as key" } },
    ],
    relationships: [
      { from: "n2", to: "n1", type: "relates_to" },
      { from: "n3", to: "n1", type: "derived_from" },
    ],
  },
  timeline: {
    version: 1,
    template: "timeline",
    metadata: { title: "Incident timeline" },
    nodes: [
      { id: "n1", type: "shape", role: "event", content: { shape: "rectangle", label: "14:02 gateway times out" } },
      { id: "n2", type: "shape", role: "event", content: { shape: "rectangle", label: "14:05 alert fires" } },
      { id: "n3", type: "shape", role: "event", content: { shape: "rectangle", label: "14:20 mitigated" } },
    ],
    relationships: [
      { from: "n1", to: "n2", type: "relates_to" },
      { from: "n2", to: "n3", type: "relates_to" },
    ],
  },
  decision_tree: {
    version: 1,
    template: "decision_tree",
    nodes: [
      { id: "n1", type: "shape", role: "decision", content: { shape: "diamond", label: "Payment failed?" } },
      { id: "n2", type: "shape", role: "outcome", content: { shape: "rectangle", label: "Retry with backoff" } },
      { id: "n3", type: "shape", role: "outcome", content: { shape: "rectangle", label: "Show error to user" } },
    ],
    relationships: [
      { from: "n1", to: "n2", type: "depends_on", label: "yes" },
      { from: "n1", to: "n3", type: "depends_on", label: "no" },
    ],
  },
  architecture: {
    version: 1,
    template: "architecture",
    nodes: [
      { id: "web", type: "shape", role: "component", content: { shape: "rectangle", label: "Web client" } },
      { id: "api", type: "shape", role: "component", content: { shape: "rectangle", label: "Checkout API" } },
      { id: "db", type: "shape", role: "component", content: { shape: "ellipse", label: "Orders DB" } },
    ],
    relationships: [
      { from: "web", to: "api", type: "depends_on", label: "HTTPS" },
      { from: "api", to: "db", type: "depends_on", label: "writes" },
    ],
  },
  causal_map: {
    version: 1,
    template: "causal_map",
    metadata: { title: "Why deliveries are late" },
    nodes: [
      { id: "rain", type: "shape", content: { shape: "rectangle", label: "Heavy rain" } },
      { id: "traffic", type: "shape", content: { shape: "rectangle", label: "Traffic jam" } },
      { id: "staffing", type: "shape", content: { shape: "rectangle", label: "Low staffing" } },
      { id: "delay", type: "shape", content: { shape: "rectangle", label: "Delivery delay" } },
    ],
    relationships: [
      { from: "rain", to: "traffic", type: "caused_by" },
      { from: "traffic", to: "delay", type: "caused_by" },
      { from: "staffing", to: "delay", type: "caused_by" },
    ],
  },
  comparison: {
    version: 1,
    template: "comparison",
    metadata: { title: "Queue vs direct write" },
    nodes: [{ id: "n1", type: "table", content: { columns: ["Option", "Latency", "Complexity"], rows: [["Queue", "higher", "higher"], ["Direct write", "lower", "lower"]] } }],
    relationships: [],
  },
  action_plan: {
    version: 1,
    template: "action_plan",
    metadata: { title: "Launch checklist" },
    nodes: [
      { id: "n1", type: "heading", content: { text: "Launch checklist" } },
      { id: "n2", type: "todo", content: { items: [{ text: "Write the RFC", checked: true }, { text: "Load test", checked: false }] } },
      { id: "n3", type: "text", content: { markdown: "Owner: payments team." } },
      { id: "n4", type: "page", title: "Runbook", content: { title: "Runbook", markdown: "## Rollback\n\nRevert the last deploy." } },
    ],
    relationships: [{ from: "n2", to: "n3", type: "relates_to" }],
  },
  sectioned: {
    version: 1,
    template: "sectioned",
    metadata: { title: "Acute pricing" },
    nodes: [
      { id: "t", type: "heading", role: "title", content: { text: "Acute pricing" } },
      { id: "g1", type: "group", content: { label: "Plans", arrangement: "compare" } },
      {
        id: "n1",
        type: "table",
        parent: "g1",
        content: {
          columns: ["", "Free", "Pro", "Lifetime"],
          rows: [
            ["Price", "₹0", "₹299/month", "One-time"],
            ["AI", "10 actions/month", "Generous", "Bring your own key"],
          ],
        },
      },
      { id: "g2", type: "group", content: { label: "Business model", arrangement: "tree" } },
      { id: "n2", type: "shape", parent: "g2", content: { shape: "rectangle", label: "Acute" } },
      { id: "n3", type: "shape", parent: "g2", content: { shape: "rectangle", label: "Free" } },
      { id: "n4", type: "shape", parent: "g2", content: { shape: "rectangle", label: "Paid" } },
      { id: "g3", type: "group", content: { label: "Instrument from day one", arrangement: "grid" } },
      { id: "n5", type: "todo", parent: "g3", content: { items: [{ text: "Track tokens per action", checked: false }] } },
      { id: "n6", type: "text", parent: "g3", content: { markdown: "Median, P90 and P95 cost per user." } },
    ],
    relationships: [
      { from: "n2", to: "n3", type: "relates_to" },
      { from: "n2", to: "n4", type: "relates_to" },
      { from: "g3", to: "g1", type: "supports", label: "sets the Pro allowance" },
    ],
  },
};

/** Plans a real validator must reject outright (fundamentally unusable, not just imperfect). */
export const REJECTED_PLAN_FIXTURES: Readonly<Record<string, unknown>> = {
  notAnObject: "just a string",
  missingNodes: { version: 1, template: "flow" },
  unknownTemplate: { version: 1, template: "mind_map", nodes: [{ id: "n1", type: "text", content: { markdown: "x" } }] },
  wrongVersion: { version: 2, template: "flow", nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "x" } }] },
  // Invalid and with no text to keep: nothing survives (a node that is invalid but has text keeps it as a text block).
  everyNodeInvalid: { version: 1, template: "flow", nodes: [{ id: "n1", type: "shape", content: { shape: "hexagon" } }] },
};

/** Plans a real validator must accept, but only after repairing something (each exercises one rule). */
export const RECOVERABLE_PLAN_FIXTURES = {
  duplicateNodeId: {
    version: 1,
    template: "action_plan",
    nodes: [
      { id: "n1", type: "text", content: { markdown: "First" } },
      { id: "n1", type: "text", content: { markdown: "Second, same id" } },
    ],
    relationships: [],
  },
  disallowedNodeTypeForTemplate: {
    version: 1,
    template: "comparison",
    nodes: [
      { id: "n1", type: "table", content: { columns: ["A"], rows: [["1"]] } },
      { id: "n2", type: "code", content: { source: "not used by comparison" } },
    ],
    relationships: [],
  },
  danglingRelationship: {
    version: 1,
    template: "flow",
    nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "Only node" } }],
    relationships: [{ from: "n1", to: "ghost", type: "relates_to" }],
  },
  selfLoop: {
    version: 1,
    template: "flow",
    nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "Only node" } }],
    relationships: [{ from: "n1", to: "n1", type: "relates_to" }],
  },
  disallowedRelationTypeForTemplate: {
    version: 1,
    template: "flow",
    nodes: [
      { id: "n1", type: "shape", content: { shape: "rectangle", label: "A" } },
      { id: "n2", type: "shape", content: { shape: "rectangle", label: "B" } },
    ],
    relationships: [{ from: "n1", to: "n2", type: "implements" }],
  },
  invalidRelationshipShape: {
    version: 1,
    template: "flow",
    nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "A" } }],
    relationships: [{ from: "n1", type: "relates_to" }], // missing `to`
  },
  oversizedContent: {
    version: 1,
    template: "action_plan",
    nodes: [
      { id: "n1", type: "text", content: { markdown: "word ".repeat(4_200) } }, // 21,000 characters: over TEXT_LIMITS.markdown
      { id: "n2", type: "text", content: { markdown: "kept" } },
    ],
    relationships: [],
  },
  tooManyNodes: {
    version: 1,
    template: "action_plan",
    nodes: Array.from({ length: 65 }, (_, i) => ({ id: `n${i}`, type: "text", content: { markdown: `Note ${i}` } })),
    relationships: [],
  },
  unknownFieldsStripped: {
    version: 1,
    template: "action_plan",
    nodes: [{ id: "n1", type: "text", content: { markdown: "Hi", extraField: "should not survive" }, secretApiKey: "sk-live-123" }],
    relationships: [],
  },
} as const;
