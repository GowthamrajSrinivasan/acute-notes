/** Phase 2 data: a case's source units and generated note set, from saved output only (PROTOCOL.md "Data"). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { DATASET_ROOT } from "../../../tooling/load";

export const RECORDING = join(DATASET_ROOT, "recordings", "2026-10-19-distil-gemini-flash");
export const PHASE2 = join(DATASET_ROOT, "experiments", "claim-conditions-2026-11-13", "phase2");
export const DEV = ["kn-03-blue-green-deploy", "kn-04-queue-choice"];
export const FINAL = [
  "kn-05-incident-review-meeting",
  "kn-06-hybrid-search-reranking",
  "kn-07-photo-sharing-hld",
  "kn-08-helpdesk-answers-hld-lld",
  "kn-09-billing-codebase-map",
  "kn-10-inventory-architecture-frames",
  "kn-11-ambiguous-analytics-proposal",
  "kn-12-flag-rollout-update",
];

export interface NoteNode {
  id: string;
  type: string;
  parent?: string;
  /** Reader-visible text only (no layout keys such as `arrangement` or `shape`). */
  text: string;
  /** What the generator claims as sources. Never read as preservation. */
  cites: string[];
}

export interface CaseData {
  caseId: string;
  units: SourceUnit[];
  nodes: NoteNode[];
  /** Visible arrows, as unordered pairs. */
  arrows: [string, string][];
  /** The rule checks' inputs. */
  raw: { nodes: Record<string, unknown>[] };
  omitted: unknown[];
}

const HIDDEN = new Set(["arrangement", "shape", "language", "variant", "icon", "done", "checked"]);
const strip = (s: string) => s.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, "").replace(/\s+/g, " ").trim();

export function visibleText(content: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (v == null || (key && HIDDEN.has(key))) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(content);
  return strip(out.join(" . "));
}

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as T;

export function loadRecorded(caseId: string): CaseData {
  const plan = readJson<{ nodes: { id: string; type: string; parent?: string; content?: unknown }[]; relationships?: { from: string; to: string }[] }>(join(RECORDING, caseId, "plan.json"));
  const run = readJson<{ units: { units: SourceUnit[] }; cites: Record<string, string[]>; omitted?: unknown[] }>(join(RECORDING, caseId, "run.json"));
  const nodes = plan.nodes.map((n) => ({ id: n.id, type: n.type, parent: n.parent, text: visibleText(n.content), cites: run.cites[n.id] ?? [] }));
  return {
    caseId,
    units: run.units.units,
    nodes,
    arrows: (plan.relationships ?? []).map((r) => [r.from, r.to]),
    raw: { nodes: plan.nodes as unknown as Record<string, unknown>[] },
    omitted: run.omitted ?? [],
  };
}

export interface LabelRecord {
  id: string;
  claimUnits: string[];
  claimSummary: string;
  conditionUnits: string[];
  kind: string;
  conditionSummary: string;
  mustConvey?: string;
  binding: "claim" | "set";
  bindingReason?: string;
  claimCards: string[];
  carriers: string[];
  perClaimCard: Record<string, "carried" | "frame" | "linked" | "separated" | "absent">;
  confidence?: string;
  notes?: string;
}
export interface CaseLabels {
  caseId: string;
  reviewer: string;
  records: LabelRecord[];
  notes?: string;
}

export const labelsPath = (caseId: string) => join(PHASE2, "labels", `${caseId}.json`);
export const loadLabels = (caseId: string) => readJson<CaseLabels>(labelsPath(caseId));
