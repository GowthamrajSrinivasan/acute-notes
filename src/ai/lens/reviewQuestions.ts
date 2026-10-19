/**
 * The review question bank (plan §6, design review): the questions an interviewer asks when scrutinising an HLD (L0–L2)
 * or an LLD (L3–L5), each with a local check against the diagram so the assessment table shows how the architecture
 * sits before any AI call. A check only says what is *visible* on the level ("seen" / "not seen" by kind or label);
 * whether it is *good* is for the AI verdict, and "unknown" is a valid local answer.
 *
 * Pure: no runtime, no DOM.
 */
import type { LensStructureFacts } from "./lensTasks";

export type ReviewTrack = "hld" | "lld";
export type LocalSignal = "seen" | "not-seen" | "unknown";

export interface ReviewContext {
  kinds: ReadonlySet<string>;
  /** Lower-cased labels and sublabels of the level's nodes, plus its relation labels. */
  text: readonly string[];
  structure: LensStructureFacts;
}

export interface ReviewQuestion {
  id: string;
  track: ReviewTrack;
  category: string;
  text: string;
  /** What the diagram itself shows about it; omitted when nothing on a diagram could tell. */
  check?: (c: ReviewContext) => LocalSignal;
}

const mentions = (c: ReviewContext, re: RegExp) => c.text.some((t) => re.test(t));
const seen = (v: boolean): LocalSignal => (v ? "seen" : "not-seen");

export const REVIEW_QUESTIONS: readonly ReviewQuestion[] = [
  // --- HLD: what an interviewer probes on the boxes-and-arrows view ---
  { id: "hld.requirements", track: "hld", category: "Requirements", text: "What functional and non-functional requirements does this design serve, and which are not stated?" },
  { id: "hld.capacity", track: "hld", category: "Capacity", text: "Given the figures I gave (or reasonable ones, labelled), what are the peak requests/s, storage growth and bandwidth?" },
  { id: "hld.scale", track: "hld", category: "Scalability", text: "What breaks first at 10× load, and what is the cheapest fix?" },
  { id: "hld.entry", track: "hld", category: "Scalability", text: "Is there a load balancer or gateway in front of the services, and does it fit?", check: (c) => seen(mentions(c, /load.?balanc|gateway|proxy|nginx|ingress|cdn/)) },
  { id: "hld.cache", track: "hld", category: "Performance", text: "Where would caching help, and what is the invalidation story?", check: (c) => seen(mentions(c, /cache|redis|memcache|cdn/)) },
  { id: "hld.async", track: "hld", category: "Performance", text: "Which work should be asynchronous (queues or events) instead of in the request path?", check: (c) => seen(c.kinds.has("messagebus") || c.kinds.has("event") || mentions(c, /queue|kafka|sqs|pub.?sub|rabbit|stream/)) },
  { id: "hld.store", track: "hld", category: "Data", text: "Is each datastore the right type for its access pattern, and how is it partitioned or replicated?", check: (c) => (c.kinds.has("database") || c.kinds.has("store") ? seen(mentions(c, /replica|shard|partition|cluster/)) : "not-seen") },
  { id: "hld.shared", track: "hld", category: "Data", text: "Do several services share one store, and what does that couple?", check: (c) => seen(c.structure.sharedStores.length > 0) },
  { id: "hld.spof", track: "hld", category: "Reliability", text: "What are the single points of failure, and what is the blast radius of each?" },
  { id: "hld.external", track: "hld", category: "Reliability", text: "How does the system behave when an external dependency is slow or down (timeouts, fallback, circuit breaker)?", check: (c) => (c.structure.externalDependencies.length ? seen(mentions(c, /fallback|circuit|retry|timeout/)) : "unknown") },
  { id: "hld.consistency", track: "hld", category: "Consistency", text: "Where is strong consistency required and where is eventual consistency acceptable?" },
  { id: "hld.security", track: "hld", category: "Security", text: "How are authentication, authorisation and data protection handled at the boundaries?", check: (c) => seen(c.kinds.has("security") || mentions(c, /auth|identity|iam|oauth|sso|token/)) },
  { id: "hld.observe", track: "hld", category: "Operations", text: "How would you know it is unhealthy (metrics, logs, traces, alerts)?", check: (c) => seen(mentions(c, /monitor|metric|log|trac|alert|observab|telemetry/)) },
  { id: "hld.tradeoffs", track: "hld", category: "Tradeoffs", text: "What are the main tradeoffs this design makes, and what would make you change them?" },
  // --- LLD: what an interviewer probes on flows, operations and code ---
  { id: "lld.responsibility", track: "lld", category: "Design", text: "Does each step or operation have one clear responsibility, and are any doing too much?" },
  { id: "lld.contract", track: "lld", category: "Interfaces", text: "What are the inputs, outputs and error cases of each operation (the contract between steps)?" },
  { id: "lld.model", track: "lld", category: "Data", text: "What are the core entities and their relationships, and where is each one owned?", check: (c) => seen(c.kinds.has("store") || c.kinds.has("database")) },
  { id: "lld.validation", track: "lld", category: "Correctness", text: "Where is input validated, and what happens to invalid input?", check: (c) => seen(mentions(c, /validat|sanitiz|schema/)) },
  { id: "lld.errors", track: "lld", category: "Correctness", text: "What happens on failure at each step: retry, rollback, compensation or surface to the caller?", check: (c) => seen(mentions(c, /retry|rollback|compensat|dead.?letter|error|fallback/)) },
  { id: "lld.idempotency", track: "lld", category: "Correctness", text: "Is each write idempotent, so a retry or a duplicate message is safe?", check: (c) => seen(mentions(c, /idempot|dedup/)) },
  { id: "lld.transactions", track: "lld", category: "Consistency", text: "Where are the transaction boundaries, and which steps must succeed or fail together?", check: (c) => seen(mentions(c, /transaction|saga|outbox|two.?phase|atomic/)) },
  { id: "lld.concurrency", track: "lld", category: "Concurrency", text: "What happens when two requests touch the same data at once (locking, versioning, ordering)?", check: (c) => seen(mentions(c, /lock|version|mutex|optimistic|ordering|lease/)) },
  { id: "lld.timeouts", track: "lld", category: "Resilience", text: "Does every call to another component or dependency have a timeout, and what bounds retries?", check: (c) => seen(mentions(c, /timeout|backoff|retry|circuit/)) },
  { id: "lld.patterns", track: "lld", category: "Design", text: "Which design patterns are in play (or missing) and do they earn their complexity?" },
  { id: "lld.testing", track: "lld", category: "Quality", text: "Where are the seams for testing, and what would you test first?" },
];

/** The level group a profile level falls under: L0–L2 are HLD, L3 and below are LLD. */
export const trackForLevel = (level: number): ReviewTrack => (level <= 2 ? "hld" : "lld");

export const questionsFor = (track: ReviewTrack): ReviewQuestion[] => REVIEW_QUESTIONS.filter((q) => q.track === track);

/** What the diagram shows for a question, from a level's kinds, labels and computed structure. */
export function localSignal(q: ReviewQuestion, ctx: ReviewContext): LocalSignal {
  return q.check ? q.check(ctx) : "unknown";
}

export function reviewContext(nodes: readonly { label: string; semantics: { kind?: string; sublabel?: string; details?: readonly string[] } }[], edgeLabels: readonly string[], structure: LensStructureFacts): ReviewContext {
  return {
    kinds: new Set(nodes.flatMap((n) => (n.semantics.kind ? [n.semantics.kind] : []))),
    text: [...nodes.flatMap((n) => [n.label, n.semantics.sublabel ?? "", ...(n.semantics.details ?? [])]), ...edgeLabels].map((t) => t.toLowerCase()).filter(Boolean),
    structure,
  };
}
