"use client";

/**
 * Phase 1 spike host (`.ai/docs/open-intelligent-ui-audit.md`, Option A): renders one or more `IdeaCard`s from raw
 * OpenUI Lang. Read-only — there is no editor here. `RichBlockHost` + BlockNote remain the editable path; this
 * component is never mounted there yet (`OPENUI_CONFIG.enabled` gates whether anything reaches it at all).
 */
import type { OpenUIError } from "@openuidev/react-lang";
import { Renderer } from "@openuidev/react-lang";
import { acuteCardLibrary } from "@/ai/openui/library";

export interface OpenUiCardRendererProps {
  /** Raw OpenUI Lang for the card(s), or null while nothing has arrived yet. */
  response: string | null;
  /** True while the source is still streaming in; disables form interactions. */
  isStreaming?: boolean;
  onError?: (errors: OpenUIError[]) => void;
}

export function OpenUiCardRenderer({ response, isStreaming, onError }: OpenUiCardRendererProps) {
  return <Renderer response={response} library={acuteCardLibrary} isStreaming={isStreaming} onError={onError} />;
}
