/**
 * The repo source reference stored in provenance (`SourceRef { provider: "repo", externalId }`): one format and one
 * parser, so what Repo Map writes (F43) and what Acute Lens shows as evidence (plan: .ai/docs/acute-lens-plan.md §3.3)
 * can't drift apart.
 *
 * `externalId` is `path#L<a>-<b>@<commit>`, or `path@<commit>` without a line range.
 */
import type { SourceRef } from "./types";

export const REPO_PROVIDER = "repo";
const MAX_EXTERNAL_ID = 500;

export interface RepoLocation {
  path: string;
  /** 1-based, inclusive. */
  lines?: [number, number];
  commit: string;
}

export function formatRepoRef(path: string, lines: [number, number] | undefined, commit: string): SourceRef {
  return { provider: REPO_PROVIDER, externalId: `${path}${lines ? `#L${lines[0]}-${lines[1]}` : ""}@${commit}`.slice(0, MAX_EXTERNAL_ID) };
}

/** The location in a repo source reference, or undefined when the ref isn't a well-formed repo ref. */
export function parseRepoRef(ref: Pick<SourceRef, "provider" | "externalId">): RepoLocation | undefined {
  if (ref.provider !== REPO_PROVIDER || !ref.externalId) return undefined;
  const match = /^(.+?)(?:#L(\d+)-(\d+))?@([^@#\s]+)$/.exec(ref.externalId);
  if (!match) return undefined;
  const [, path, a, b, commit] = match;
  if (a === undefined || b === undefined) return { path: path!, commit: commit! };
  const [start, end] = [Number(a), Number(b)];
  return start >= 1 && start <= end ? { path: path!, lines: [start, end], commit: commit! } : { path: path!, commit: commit! };
}

/**
 * A line range as typed in the properties panel's Source field: "143", "143-158" (or an en dash). Undefined for an
 * empty field, null for anything else.
 */
export function parseLineRange(text: string): [number, number] | undefined | null {
  const t = text.trim();
  if (!t) return undefined;
  const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(t);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  return start >= 1 && start <= end ? [start, end] : null;
}
