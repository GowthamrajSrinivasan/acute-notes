/**
 * Guessing architecture component kinds for a Mermaid flowchart (interactive architecture frames, Phase 3).
 *
 * A flowchart whose nodes read as components (a cylinder, "Postgres", "Kafka", "Auth service", "Web app") gets a
 * kind per recognised node, so it lands in an interactive diagram frame like an Archify or AI architecture plan.
 * The guess switches on only when the diagram clearly is one — at least `MIN_MATCHED` nodes and `MIN_SHARE` of them
 * recognised — so an ordinary process flowchart ("Validate input → Retry") keeps its plain look. Pure.
 */
import type { NodeKind } from "@/domain/canvas/diagram";
import type { MermaidShape } from "./types";

export const MIN_MATCHED = 3;
export const MIN_SHARE = 0.6;

/** Checked in order: the first kind whose words appear (as whole words) in the label wins. */
const KIND_WORDS: readonly [NodeKind, RegExp][] = [
  ["database", /\b(db|database|databases|postgres|postgresql|mysql|mariadb|mongo|mongodb|sqlite|dynamodb|redis|memcached|cache|datastore|data store|warehouse|bigquery|snowflake|elasticsearch|vector store)\b/i],
  ["messagebus", /\b(queue|queues|kafka|rabbitmq|sqs|sns|pub\/?sub|topic|event bus|message bus|bus|kinesis|nats|event hub|eventbridge)\b/i],
  ["security", /\b(auth|authn|authz|oauth|oidc|iam|sso|firewall|waf|vault|secrets?|identity|keycloak|cognito|okta)\b/i],
  ["external", /\b(stripe|paypal|github|twilio|sendgrid|third[- ]party|external|partner|users?|customers?)\b/i],
  ["cloud", /\b(cdn|aws|gcp|azure|lambda|cloudfront|kubernetes|k8s|cloud|s3|blob storage|load balancer)\b/i],
  ["backend", /\b(api|apis|service|services|server|worker|workers|backend|gateway|microservice|handler|router|scheduler|cron)\b/i],
  ["frontend", /\b(ui|web|website|frontend|front[- ]end|client|browser|mobile|ios|android|spa|dashboard|cli|portal)\b/i],
];

export interface KindCandidate {
  id: string;
  label: string;
  shape: MermaidShape;
}

/** The kind a single node reads as, if any: a cylinder is a store; otherwise its label's words decide. */
export function kindOfComponent(label: string, shape: MermaidShape): NodeKind | undefined {
  if (shape === "cylinder") return "database";
  return KIND_WORDS.find(([, words]) => words.test(label))?.[0];
}

/** Kinds by node id when the flowchart reads as an architecture diagram, else null (no node gets a kind). */
export function guessComponentKinds(nodes: readonly KindCandidate[]): Map<string, NodeKind> | null {
  const kinds = new Map<string, NodeKind>();
  for (const n of nodes) {
    const kind = kindOfComponent(n.label, n.shape);
    if (kind) kinds.set(n.id, kind);
  }
  return kinds.size >= MIN_MATCHED && kinds.size >= nodes.length * MIN_SHARE ? kinds : null;
}
