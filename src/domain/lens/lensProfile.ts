/**
 * Acute Lens profiles (plan: .ai/docs/acute-lens-plan.md D1, D10). The architecture profile is the only one built;
 * the engine only ever knows "level n of profile p", so a later profile (agent, project, incident, knowledge) is a
 * new entry here, not an engine change.
 */
import { NODE_KINDS, type LensProfileId, type NodeKind } from "@/domain/canvas/diagram";
import { PROJECT_KINDS } from "@/domain/canvas/nodeProject";

export interface LensProfileLevel {
  index: number;
  name: string;
  short: string;
}

export interface LensProfile {
  id: LensProfileId;
  levels: LensProfileLevel[];
  /** The level rendered as a source card instead of a diagram. */
  sourceLevel?: number;
  kinds: readonly NodeKind[];
}

const ARCHITECTURE_PROFILE: LensProfile = {
  id: "architecture",
  levels: [
    { index: 0, name: "System", short: "L0" },
    { index: 1, name: "Architecture", short: "L1" },
    { index: 2, name: "Component", short: "L2" },
    { index: 3, name: "Flow", short: "L3" },
    { index: 4, name: "Operation", short: "L4" },
    { index: 5, name: "Source", short: "L5" },
  ],
  sourceLevel: 5,
  kinds: NODE_KINDS,
};

/**
 * The Project profile (plan D25, §3.6): decisions, constraints, findings, progress and the project itself, on the same
 * primitive. Not a drill hierarchy like the architecture's L0–L5: L0 is the project overview (the banner and its
 * counts, shown at the top of the view) and L1 is the lanes (Plan · Decisions · Working knowledge · Notes).
 */
const PROJECT_PROFILE: LensProfile = {
  id: "project",
  levels: [
    { index: 0, name: "Project", short: "L0" },
    { index: 1, name: "Lanes", short: "L1" },
  ],
  kinds: PROJECT_KINDS,
};

const PROFILES: Record<LensProfileId, LensProfile> = { architecture: ARCHITECTURE_PROFILE, project: PROJECT_PROFILE };

export function lensProfile(id: LensProfileId = "architecture"): LensProfile {
  return PROFILES[id];
}
