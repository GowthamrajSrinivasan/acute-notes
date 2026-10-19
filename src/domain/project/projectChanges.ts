/**
 * Change sets for the Project profile, as data (plan §3.6, D33, D43; setup plan Part B): where a new project node goes
 * in its frame, the changes that create one, and the workspace templates `create_project` proposes. Pure: shared by
 * the Phase 7B tools and the properties panel's "Add to project…", so a node lands in the same lane either way.
 */
import type { Box, ProposedChange } from "@/ai/changes/changeSet";
import { uniqueKey } from "@/domain/canvas/projectOps";
import type { NodePatch } from "@/domain/canvas/nodePatch";
import { PROJECT_KIND_LABELS, type ProjectKind, type ProjectStyle } from "@/domain/canvas/nodeProject";
import { nodeKeyFor } from "@/domain/lens/identity";
import { laneOf, PROJECT_LANE_DEFS } from "@/domain/lens/projectLanes";

export const PROJECT_NODE_SIZE = { width: 220, height: 64 } as const;
const GAP = 16;
const PAD = 24;
const TITLE_ROOM = 40;
const BANNER_ROOM = 100;

/** What placement needs of the frame's existing shapes. */
export interface PlacedShape {
  x: number;
  y: number;
  kind?: string;
}

/** Where a new node of `kind` goes in `frame`: its lane's column, under what is already there; a project node tops the frame. */
export function laneSlot(frame: Box, members: readonly PlacedShape[], kind: ProjectKind): { x: number; y: number } {
  if (kind === "project") return { x: frame.x + PAD, y: frame.y + TITLE_ROOM };
  const hasProject = members.some((m) => m.kind === "project");
  const lane = Math.max(0, PROJECT_LANE_DEFS.findIndex((l) => l.id === (laneOf(kind) ?? "notes")));
  const x = frame.x + PAD + lane * (PROJECT_NODE_SIZE.width + GAP);
  const top = frame.y + TITLE_ROOM + (hasProject ? BANNER_ROOM : 0);
  const column = members.filter((m) => m.kind !== "project" && Math.abs(m.x - x) < PROJECT_NODE_SIZE.width / 2);
  const bottom = Math.max(top - GAP - PROJECT_NODE_SIZE.height, ...column.map((m) => m.y)) + PROJECT_NODE_SIZE.height + GAP;
  return { x, y: bottom };
}

export interface NewProjectNode {
  kind: ProjectKind;
  label: string;
  /** Project fields (validated by the change set and the writer against `kind`). */
  fields: NodePatch;
  /** Indices of earlier nodes in the same call whose new keys join this node's `refs` (an item under a milestone added with it). */
  refsToNew?: readonly number[];
}

/**
 * The changes that add `nodes` to an existing project frame (`frameId`), in their lanes, each with a fresh Lens key
 * unique among `taken` (D53), and the keys given. `keyBase` prefixes the keys (the project's key, or the frame's).
 */
export function addProjectNodes(input: { frameId: string; frame: Box; members: readonly PlacedShape[]; nodes: readonly NewProjectNode[]; taken: ReadonlySet<string>; keyBase: string }): {
  changes: ProposedChange[];
  keys: string[];
} {
  const taken = new Set(input.taken);
  const members = [...input.members];
  const changes: ProposedChange[] = [];
  const keys: string[] = [];
  input.nodes.forEach((n, i) => {
    const lensKey = uniqueKey(nodeKeyFor(input.keyBase, n.label || PROJECT_KIND_LABELS[n.kind]), taken);
    taken.add(lensKey);
    keys.push(lensKey);
    const at = laneSlot(input.frame, members, n.kind);
    members.push({ ...at, kind: n.kind });
    const newRefs = (n.refsToNew ?? []).filter((j) => j < i).map((j) => keys[j]!);
    const fields: NodePatch = newRefs.length ? { ...n.fields, refs: [...((n.fields.refs as string[] | null | undefined) ?? []), ...newRefs] } : n.fields;
    changes.push({
      kind: "create_shape",
      key: `n${i}`,
      shape: "rectangle",
      label: n.label,
      box: { ...at, ...PROJECT_NODE_SIZE },
      // The kind travels in the project patch: `semantics.kind` accepts architecture kinds only (Phase 6).
      project: { kind: n.kind, ...fields },
      lensKey,
    });
  });
  if (changes.length) changes.push({ kind: "update_frame", target: input.frameId, add: changes.map((c) => ("key" in c ? c.key : "")).filter(Boolean) });
  return { changes, keys };
}

// ---------------------------------------------------------------------------
// Workspace templates (setup plan Part B)
// ---------------------------------------------------------------------------

export const TEMPLATE_L1: Record<ProjectStyle, { frame: string; line?: string }> = {
  modular: { frame: "Modules", line: "This project's architecture is organised by module: L1 = modules, L2 = their components." },
  feature: { frame: "Features", line: "This project's architecture is organised by feature: L1 = features, L2 = each feature's slices." },
  service: { frame: "Services", line: "This project's architecture is organised by service: L1 = services, L2 = each service's internals; L3 = cross-service flows." },
  custom: { frame: "Architecture" },
};

/** The starter plan's onboarding tasks (setup plan Q3): done once, at initialisation, never a per-session checklist. */
export const STARTER_MILESTONE = "Get started with Acute";
export const STARTER_TASKS = ["Understand the project", "Record current state", "Set the next step"] as const;

const STATE_W = PAD * 2 + 4 * PROJECT_NODE_SIZE.width + 3 * GAP;
const STATE_H = 420;
const ARCH_W = 900;
const ARCH_H = 420;

/**
 * What `create_project` proposes (setup plan Part B, S6): a `project` node in a Project state frame, and one empty,
 * interactive L1 architecture frame named for the style — structure only, no invented architecture, decisions or
 * progress. With `starterPlan`, one milestone and the three onboarding tasks, all `not_started`.
 */
export function projectTemplate(input: { name: string; style: ProjectStyle; focus?: string; starterPlan?: boolean; at: { x: number; y: number }; taken: ReadonlySet<string> }): {
  changes: ProposedChange[];
  projectKey: string;
} {
  const taken = new Set(input.taken);
  const projectKey = uniqueKey(nodeKeyFor("project", input.name), taken);
  taken.add(projectKey);
  const stateBox: Box = { x: input.at.x, y: input.at.y, width: STATE_W, height: STATE_H };
  const changes: ProposedChange[] = [];
  const members: PlacedShape[] = [];
  const node = (key: string, kind: ProjectKind, label: string, fields: NodePatch, lensKey: string) => {
    const at = laneSlot(stateBox, members, kind);
    members.push({ ...at, kind });
    changes.push({ kind: "create_shape", key, shape: "rectangle", label, box: { ...at, ...PROJECT_NODE_SIZE }, project: { kind, ...fields }, lensKey });
  };
  node("project", "project", input.name, { style: input.style, project: projectKey, ...(input.focus ? { focus: input.focus } : {}) }, projectKey);
  const children = ["project"];
  if (input.starterPlan) {
    const milestoneKey = uniqueKey(nodeKeyFor(projectKey, STARTER_MILESTONE), taken);
    taken.add(milestoneKey);
    node("milestone", "milestone", STARTER_MILESTONE, { project: projectKey, order: 1 }, milestoneKey);
    children.push("milestone");
    STARTER_TASKS.forEach((task, i) => {
      const k = uniqueKey(nodeKeyFor(projectKey, task), taken);
      taken.add(k);
      node(`task${i}`, "progress_item", task, { project: projectKey, status: "not_started", order: i + 1, refs: [milestoneKey] }, k);
      children.push(`task${i}`);
    });
  }
  const bottom = Math.max(...changes.map((c) => ("box" in c ? c.box.y + c.box.height : 0))) + PAD;
  changes.push({ kind: "create_frame", key: "state", title: `${input.name} · Project state`, box: { ...stateBox, height: Math.max(STATE_H, bottom - stateBox.y) }, children, profile: "project" });
  changes.push({
    kind: "create_frame",
    key: "architecture",
    title: TEMPLATE_L1[input.style].frame,
    box: { x: input.at.x, y: input.at.y + Math.max(STATE_H, bottom - stateBox.y) + 80, width: ARCH_W, height: ARCH_H },
    children: [],
    diagram: {},
  });
  return { changes, projectKey };
}
