/**
 * The project-knowledge half of `customData.acuteNode` (plan: .ai/docs/acute-lens-plan.md §3.6, D26, D33–D35, D39,
 * D53). A decision, constraint, finding, open question, risk, milestone, progress item, annotation or project is an
 * ordinary canvas shape whose `acuteNode.kind` is one of `PROJECT_KINDS`; the fields below sit beside the descriptive
 * half (`NodeSemantics`) and the Lens half (`NodeLens`) in the same object, each with its own getter and writer.
 *
 * Validation is per field and per kind (Phase 0.1's rule): a field that doesn't belong to the node's kind, or is
 * oversized or malformed, is dropped on its own and never takes the node with it. `project` and `refs` are valid on
 * any node. `refs` hold Lens keys (D13) and may point at a node on another canvas (D53); they are semantic, never
 * canvas arrows.
 *
 * Pure and renderer-agnostic, like the adapter: written against the `customData` bag, with no import from
 * `diagram.ts` at runtime (that file imports this one).
 */

export const PROJECT_KINDS = ["project", "decision", "constraint", "finding", "open_question", "risk", "milestone", "progress_item", "annotation"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  project: "Project",
  decision: "Decision",
  constraint: "Constraint",
  finding: "Finding",
  open_question: "Open question",
  risk: "Risk",
  milestone: "Milestone",
  progress_item: "Progress item",
  annotation: "Annotation",
};

export const PROJECT_STYLES = ["modular", "feature", "service", "custom"] as const;
export type ProjectStyle = (typeof PROJECT_STYLES)[number];
export const DECISION_STATUSES = ["proposed", "accepted", "superseded"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const PROGRESS_STATUSES = ["not_started", "in_progress", "done", "blocked"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export const QUESTION_STATUSES = ["open", "answered"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export const FINDING_STAGES = ["ephemeral", "validated"] as const;
export type FindingStage = (typeof FINDING_STAGES)[number];
export const FINDING_NOTES = ["discovery", "hypothesis", "assumption", "concern"] as const;
export type FindingNote = (typeof FINDING_NOTES)[number];
export const RISK_SEVERITIES = ["low", "medium", "high"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];
export const ANNOTATION_INTENTS = ["constraint", "preference", "question", "note"] as const;
export type AnnotationIntent = (typeof ANNOTATION_INTENTS)[number];

export type ProjectStatus = DecisionStatus | ProgressStatus | QuestionStatus;

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  superseded: "Superseded",
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
  open: "Open",
  answered: "Answered",
};

export const PROJECT_LIMITS = { key: 200, refs: 20, reason: 500, optionLabel: 120, tradeoffs: 300, options: 6, focus: 200, answer: 500, order: 100000 } as const;

export interface DecisionOption {
  label: string;
  tradeoffs?: string;
}

/** The project-knowledge fields of a node (D33); which apply depends on its `acuteNode.kind`. */
export interface NodeProject {
  /** The `project` node's key this node belongs to (D39). Any node. */
  project?: string;
  /** Lens keys of the nodes this one concerns, on any canvas (D53). Any node. */
  refs?: string[];
  /** project */
  style?: ProjectStyle;
  focus?: string;
  /** decision / constraint (`DecisionStatus`), progress_item (`ProgressStatus`), open_question (`QuestionStatus`) */
  status?: ProjectStatus;
  /** decision / constraint */
  reason?: string;
  options?: DecisionOption[];
  /** An option label (D34); absent while the decision is an open negotiation. */
  chosen?: string;
  /** decision only: raise as a warning (D36). A constraint always warns. */
  enforce?: boolean;
  /**
   * decision / constraint: keys of the decisions this one retires for good (D45; the retired ones are `superseded`).
   * Semantic links, like `refs` (D53): they may cross canvases, and an arrow is drawn too only on a shared canvas.
   */
  supersedes?: string[];
  /**
   * decision / constraint: keys of the decisions or constraints this one is a documented exception to (D45). The
   * original still holds everywhere except on the nodes in this decision's `refs`.
   */
  deviatesFrom?: string[];
  /** finding */
  stage?: FindingStage;
  note?: FindingNote;
  /** open_question */
  answer?: string;
  /** risk */
  severity?: RiskSeverity;
  /** milestone, progress_item: position (within its milestone, for an item) */
  order?: number;
  /** progress_item: marked "up next" */
  next?: boolean;
  /** annotation */
  intent?: AnnotationIntent;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return list.find((v) => v === value);
}

function line(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t.slice(0, max) : undefined;
}

/** A single-line identifier: trimmed, at most `max` characters, no control characters. */
function ident(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t && t.length <= max && !CONTROL_CHARS.test(t) ? t : undefined;
}

function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

export function isProjectKind(value: unknown): value is ProjectKind {
  return PROJECT_KINDS.includes(value as ProjectKind);
}

function refList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  for (const v of value) {
    const k = ident(v, PROJECT_LIMITS.key);
    if (k) seen.add(k);
    if (seen.size >= PROJECT_LIMITS.refs) break;
  }
  return seen.size ? [...seen] : undefined;
}

function optionList(value: unknown): DecisionOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DecisionOption[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const label = line(o.label, PROJECT_LIMITS.optionLabel);
    if (!label || out.some((x) => x.label === label)) continue;
    const tradeoffs = line(o.tradeoffs, PROJECT_LIMITS.tradeoffs);
    out.push(tradeoffs ? { label, tradeoffs } : { label });
    if (out.length >= PROJECT_LIMITS.options) break;
  }
  return out.length ? out : undefined;
}

function order(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= PROJECT_LIMITS.order ? Math.round(value) : undefined;
}

/**
 * The project-knowledge fields that apply to a node of `kind`, validated per field. `project` and `refs` apply to
 * any node (including one with no kind); everything else only to the kind that owns it. Returns undefined when
 * nothing survives.
 */
export function normalizeProject(kind: unknown, r: Record<string, unknown>): NodeProject | undefined {
  const k = isProjectKind(kind) ? kind : undefined;
  const out: NodeProject = { project: ident(r.project, PROJECT_LIMITS.key), refs: refList(r.refs) };
  if (k === "project") {
    out.style = oneOf(PROJECT_STYLES, r.style);
    out.focus = line(r.focus, PROJECT_LIMITS.focus);
  }
  if (k === "decision" || k === "constraint") {
    out.status = oneOf(DECISION_STATUSES, r.status);
    out.reason = line(r.reason, PROJECT_LIMITS.reason);
    out.options = optionList(r.options);
    // D34: `chosen` is one of the options' labels, never free text.
    const chosen = line(r.chosen, PROJECT_LIMITS.optionLabel);
    out.chosen = chosen && out.options?.some((o) => o.label === chosen) ? chosen : undefined;
    if (k === "decision" && r.enforce === true) out.enforce = true;
    out.supersedes = refList(r.supersedes);
    out.deviatesFrom = refList(r.deviatesFrom);
  }
  if (k === "finding") {
    out.stage = oneOf(FINDING_STAGES, r.stage);
    out.note = oneOf(FINDING_NOTES, r.note);
  }
  if (k === "open_question") {
    out.status = oneOf(QUESTION_STATUSES, r.status);
    out.answer = line(r.answer, PROJECT_LIMITS.answer);
  }
  if (k === "risk") out.severity = oneOf(RISK_SEVERITIES, r.severity);
  if (k === "milestone") out.order = order(r.order);
  if (k === "progress_item") {
    out.status = oneOf(PROGRESS_STATUSES, r.status);
    out.order = order(r.order);
    if (r.next === true) out.next = true;
  }
  if (k === "annotation") out.intent = oneOf(ANNOTATION_INTENTS, r.intent);
  return compact(out);
}

/** The `acuteNode` bag on a `customData`, if it is an object. */
function acuteNodeOf(customData: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const value = customData?.acuteNode;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Normalised project-knowledge fields stored on a node, or undefined when it has none. */
export function getNodeProject(el: { customData?: Record<string, unknown> }): NodeProject | undefined {
  const r = acuteNodeOf(el.customData);
  return r ? normalizeProject(r.kind, r) : undefined;
}

/** The node's project-knowledge kind, when it has one. */
export function projectKindOf(el: { customData?: Record<string, unknown> }): ProjectKind | undefined {
  const kind = acuteNodeOf(el.customData)?.kind;
  return isProjectKind(kind) ? kind : undefined;
}
