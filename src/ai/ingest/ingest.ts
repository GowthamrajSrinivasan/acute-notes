/**
 * Content ingest: the one entry point for turning new text into a reviewable change set on the open canvas, for every caller.
 * The Visualize dialog and the MCP tools both come here, so they share the same outline, plan, analysis, merge and update
 * pipeline, the same decision model (Jev) for filing passages under existing topics, and the same guarantees:
 *
 * - `new`    the text becomes new notes (`visualizeContent`);
 * - `update` the text is an edited version of a source already on the canvas (`updateFromNewContent`): objects are
 *            reconciled by key, nothing is removed without the user's review;
 * - `merge`  the text is filed under an existing source's topics (`mergeIntoSource`): passages already there are left out
 *            (repeats), the rest is added, never removed or restated (`appendOnly`); `economy` keeps new text word for word.
 *
 * Nothing here touches React, Excalidraw or the review UI. What a caller must supply is behind `IngestPorts`: the AI
 * runtime, the content-source store, the canvas's render context, and one source's objects on the canvas. The result is a
 * change set, never a write: `prepareProposal` splits a large one into reviewable sections, and the caller proposes it
 * (the dialog to its review bar, the MCP tools through `proposeChangeSet`).
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import { splitIntoSectionParts } from "@/ai/changes/sectionParts";
import { loadLatest } from "@/ai/content/sources";
import { mergeIntoSource, type MergeInput } from "@/ai/merge/merge";
import type { ExistingObject } from "@/ai/reconcile/classify";
import { existingConnections, existingObjects } from "@/ai/reconcile/existing";
import { updateFromNewContent, type UpdateInput } from "@/ai/reconcile/update";
import type { AIRuntime } from "@/ai/runtime";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import type { RenderContext } from "@/ai/renderer/render";
import { visualizeContent } from "@/ai/visualize/visualize";
import type { VisualizeProgress } from "@/ai/visualize/types";
import type { VisualTemplate } from "@/ai/visual-plan/types";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { DocumentRecord } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";

/** The content source isn't on this device (e.g. the objects came in a workspace import). */
export class SourceUnavailableError extends Error {
  override name = "SourceUnavailableError";
  constructor() {
    super("The original content for these objects isn't on this device, so it can't be compared. Use Visualize to start again.");
  }
}

/** What one source has on the canvas. */
export interface SourceObjects {
  existing: ExistingObject[];
  connections: NonNullable<UpdateInput["connections"]>;
}

/** What a caller supplies. */
export interface IngestPorts {
  runtime: AIRuntime;
  contentSources: ContentSourceRepository;
  /** Placement input from the live canvas (existing boxes, viewport, selection anchor). */
  renderContext(): RenderContext;
  /** One source's objects and connectors on the canvas (`sceneSourceObjects` reads them from the live scene). */
  sourceObjects(sourceId: string): SourceObjects;
}

/** `sourceObjects` for a live scene: the elements in z-order and a way to read a block's or page's document. */
export function sceneSourceObjects(elements: () => readonly SceneElement[], getDocument: (id: string) => DocumentRecord | null | undefined): IngestPorts["sourceObjects"] {
  return (sourceId) => {
    const scene = elements();
    return { existing: existingObjects(scene, getDocument, sourceId), connections: existingConnections(scene, sourceId) };
  };
}

export type IngestRequest =
  | { mode: "new"; text: string; template?: VisualTemplate; forceLocalOnly?: boolean; title?: string }
  | { mode: "update"; sourceId: string; text: string; title?: string; /** Section keys to analyse again with AI from their own text ("Re-visualize"); all others are left as they are. */ regenerate?: readonly string[] }
  | { mode: "merge"; sourceId: string; text: string; economy?: boolean; title?: string };

export interface IngestOptions {
  signal?: AbortSignal;
  onProgress?: (progress: VisualizeProgress) => void;
  /** Markdown parsing for the renderer; the app's default when absent (tests give their own). */
  parseMarkdown?: ParseMarkdown;
}

export interface IngestResult {
  /** Null when the canvas already matches the content: nothing to propose. */
  changeSet: ChangeSet | null;
  /** What the user should be told once (where AI fell short, repeats left out, a split kept, economy cards). */
  notices: string[];
  /**
   * Merge only: what the new content and the notes disagree about. None of it is filed as fact: each is shown on the canvas as a "Needs your call"
   * choice and waits for the user to pick an option (the review says so). Empty when nothing conflicts.
   */
  choices: string[];
}

/** The per-import "plain cards, no AI" option as the merge reads it: absent unless chosen, so the default merge is untouched. */
export const withEconomy = <T extends MergeInput>(input: T, economy: boolean): T => (economy ? { ...input, economy: true } : input);

/** A source's latest version and its objects on this canvas, as an update (or a merge) into it needs them. */
export async function sourceInput(ports: IngestPorts, sourceId: string, text: string, title: string): Promise<UpdateInput> {
  const latest = await loadLatest(ports.contentSources, sourceId);
  if (!latest) throw new SourceUnavailableError();
  const { existing, connections } = ports.sourceObjects(sourceId);
  const context = ports.renderContext();
  // New objects are placed beside the ones this source already has.
  const boxes = existing.flatMap((o) => (o.box ? [o.box] : []));
  const anchor = boxes.length
    ? {
        x: Math.min(...boxes.map((b) => b.x)),
        y: Math.min(...boxes.map((b) => b.y)),
        width: Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
        height: Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
      }
    : context.anchor;
  return { source: latest.source, previous: latest.version, text, existing, connections, operationId: newId("op"), title, context: { ...context, ...(anchor ? { anchor } : {}) } };
}

export async function ingestContent(request: IngestRequest, ports: IngestPorts, options: IngestOptions = {}): Promise<IngestResult> {
  const { signal, onProgress, parseMarkdown } = options;
  const passed = { signal, onProgress, ...(parseMarkdown ? { parseMarkdown } : {}) };
  if (request.mode === "update") {
    const result = await updateFromNewContent(await sourceInput(ports, request.sourceId, request.text, request.title ?? "Update from new content"), ports.runtime, request.regenerate?.length ? { ...passed, regenerate: request.regenerate } : passed);
    return { changeSet: result.changeSet, notices: result.notices, choices: [] };
  }
  if (request.mode === "merge") {
    const input = withEconomy(await sourceInput(ports, request.sourceId, request.text, request.title ?? "Merge into existing notes"), !!request.economy);
    const result = await mergeIntoSource(input, ports.runtime, passed);
    return { changeSet: result.changeSet, notices: result.notices, choices: [...(result.report?.choices ?? [])] };
  }
  const result = await visualizeContent(
    {
      text: request.text,
      template: request.template,
      forceLocalOnly: request.forceLocalOnly ?? false,
      operationId: newId("op"),
      title: request.title ?? "Visualize",
      context: ports.renderContext(),
    },
    ports.runtime,
    passed,
  );
  return { changeSet: result.changeSet, notices: result.notices, choices: [] };
}

/**
 * A long document can create more objects than one review holds: it is reviewed section by section (never truncated). Returns what to
 * propose, and the notices with the one that says so.
 */
export function prepareProposal(changeSet: ChangeSet, notices: readonly string[]): { proposal: ChangeSet; notices: string[] } {
  const proposal = splitIntoSectionParts(changeSet);
  if (proposal.parts && !changeSet.parts) {
    return {
      proposal,
      notices: [
        ...notices,
        `This is a large result (${proposal.changes.length.toLocaleString("en-US")} objects), so it is split into ${proposal.parts.length} sections to review. Accepting only some sections still records the whole content version, so the sections you skip show up as additions on the next update.`,
      ],
    };
  }
  return { proposal, notices: [...notices] };
}
