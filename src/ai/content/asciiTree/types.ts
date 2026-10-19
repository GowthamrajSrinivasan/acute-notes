/**
 * ASCII trees → `VisualPlan` (F42 Phase 3): the types shared by the two
 * deterministic parsers (indented `├──` trees and top-down box trees) and the
 * plan builder. Like Mermaid (F33), an ASCII drawing is only an *input*
 * representation: it becomes shapes and parent → child relationships, which go
 * through F29 validation and F30 rendering like any other plan.
 */
import type { VisualPlan } from "@/ai/visual-plan/types";

export interface Span {
  start: number;
  end: number;
}

/**
 * - `indented`: one node per line, nesting shown by `├──` / `└──` / `│` (or `|--`, `` `-- ``, `+--`), as the `tree`
 *   command, `tree /F` and most chat answers draw them.
 * - `box`: drawn top down, labels (or boxed labels) joined by connector lines such as `┌──┴──┐` or `+--+--+`.
 */
export type AsciiTreeStyle = "indented" | "box";

export interface AsciiTreeNode {
  /** Cleaned label; a box-style label spanning several lines keeps them, joined by "\n". */
  label: string;
  /** The label as written, as UTF-16 offsets into the parsed source (no `sourceOffset` applied). */
  span: Span;
  /** Index into `AsciiTree.nodes`; null for a root. */
  parent: number | null;
  /** Indexes into `AsciiTree.nodes`, in reading order (top to bottom, left to right). */
  children: number[];
}

export interface AsciiTree {
  style: AsciiTreeStyle;
  /** In pre-order: each node before its children, roots in reading order. */
  nodes: AsciiTreeNode[];
  /** Indexes of the root nodes (a lone label not connected to anything is a root too). */
  roots: number[];
  /** Things the parser skipped or simplified, in plain language. */
  notes: string[];
}

export type AsciiTreeErrorCode =
  /** Nothing but whitespace. */
  | "empty"
  /** No tree here: prose, a table, a flow of arrows, a chart or other ASCII art. */
  | "not_a_tree"
  /** Looks like a tree, but can't be read confidently (merging branches, diagonal lines, mixed styles…). */
  | "unsupported"
  /** Over the source size or F29's node limit. */
  | "too_large"
  /** The built plan failed F29 validation (an internal bug if it ever happens). */
  | "invalid_plan";

export interface AsciiTreeError {
  code: AsciiTreeErrorCode;
  message: string;
  /** 1-based line of the problem, when there is one. */
  line?: number;
}

export type AsciiTreeParseResult = { ok: true; tree: AsciiTree } | { ok: false; error: AsciiTreeError };

export type AsciiTreeConversionResult =
  | {
      ok: true;
      style: AsciiTreeStyle;
      /** `validateVisualPlan`'s output: safe to hand to `renderVisualPlan` as is. */
      plan: VisualPlan;
      /** What was simplified or skipped, in plain language (parser notes, then builder, then validator). */
      warnings: string[];
      tree: AsciiTree;
    }
  | { ok: false; error: AsciiTreeError };

export interface ConvertAsciiTreeOptions {
  /** Added to every `sourceSpan`, so spans point into the containing document when `source` is a code block's body. */
  sourceOffset?: number;
  /** The plan's title (e.g. the heading above the code block); also the section label of a multi-root tree. */
  title?: string;
}

export interface AsciiTreeDetection {
  style: AsciiTreeStyle;
  /** Node count. */
  nodes: number;
  /** Roots that have children (a tree with more than one is drawn as a `tree` group). */
  trees: number;
}
