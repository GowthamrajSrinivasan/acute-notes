/**
 * MCP Apps / interactive MCP surfaces (PRD §13.14): the optional seam only.
 * Nothing implements it and nothing registers one; normal Acute-Notes and its
 * MCP resources, tools and prompts never depend on it.
 *
 * A future provider would let an MCP client render an interactive Acute-Notes
 * surface (a canvas view, the review UI) instead of text. The types below are
 * deliberately built from what already exists, so such a surface can't grow
 * a second document model:
 *
 * - what it shows is a resource payload (`resources/serializers.ts`), read
 *   through the same scoped `ResourceReader`;
 * - what it changes is a `ChangeSet` (F19), proposed for the user's review
 *   exactly like a write tool's — never applied directly;
 * - who may do what comes from the same `ToolPolicy`.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { CanvasResource, PageResource } from "../resources/serializers";
import type { ToolPolicy } from "../tools/common";

/** A surface a client can open: one canvas, one page, or the review of the canvas's pending change set. */
export type McpSurfaceTarget = { kind: "canvas"; canvasId: string } | { kind: "page"; pageId: string } | { kind: "review"; canvasId: string };

/** What a surface is rendered from: the same bounded payloads the resources serve. */
export type McpSurfaceData = { kind: "canvas"; canvas: CanvasResource } | { kind: "page"; page: PageResource } | { kind: "review"; canvasId: string; pending: ChangeSet | null };

/** A surface description handed to the client (an MCP App resource, in whatever form the spec settles on). */
export interface McpSurface {
  /** A `ui://`-style resource URI the client loads. */
  uri: string;
  title: string;
  mimeType: string;
  data: McpSurfaceData;
}

/** What a surface may do on the user's behalf, all through the existing paths. */
export interface McpSurfaceActions {
  /** Proposes changes for review (F19); returns the operation id. Same checks as the write tools. */
  propose(set: ChangeSet): Promise<{ operationId: string }>;
  policy(): ToolPolicy;
}

/**
 * Optional provider of interactive surfaces for one workspace. Absent by
 * default; a server built without one serves resources, tools and prompts only.
 */
export interface MCPAppSurfaceProvider {
  readonly workspaceId: string;
  /** Whether this provider can render `target` (e.g. a client that supports MCP Apps). */
  supports(target: McpSurfaceTarget): boolean;
  /** The surface for `target`, or null when it doesn't exist in this workspace (never revealing other workspaces). */
  open(target: McpSurfaceTarget, actions: McpSurfaceActions): Promise<McpSurface | null>;
}
