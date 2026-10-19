/**
 * Appended paragraphs by reference (content fidelity Wave B1, on the update path): a section that only had paragraphs appended is
 * planned from those paragraphs alone, and they are numbered block by block ([P1] [L1] [T1] [C1], the same mechanism a first run
 * uses, `fidelity/sourceBlocks.ts`) so the model can place a block by reference instead of retyping it. References are expanded
 * into their verbatim blocks here, deterministically, before the reply is merged with the section's current nodes.
 *
 * A first run has the content safety net (`attachUncovered`) behind its references; an update had none, so a reference that
 * doesn't resolve, or a block a reply of references leaves out, would have dropped content. The same safety net runs here, but only
 * for a reply that used references: a reply that retyped everything is handled exactly as it was before.
 */
import { attachUncovered } from "@/ai/fidelity/safetyNet";
import { expandSourceRefs, numberSource, type SourceBlock } from "@/ai/fidelity/sourceBlocks";

/** The appended paragraphs numbered block by block; no `numbered` when there is nothing to number (the prompt then shows the text as before). */
export async function numberAppended(text: string): Promise<{ numbered?: string; blocks: SourceBlock[] }> {
  const source = await numberSource(text).catch(() => null);
  return source?.blocks.length ? { numbered: source.numbered, blocks: source.blocks } : { blocks: [] };
}

/**
 * An `appended` reply with its references expanded into the verbatim blocks, block numbers the model copied into its text removed,
 * and — when it referenced anything (or referenced a block that doesn't exist) — whatever of `text` it left out attached verbatim.
 */
export async function resolveAppendedRefs(raw: unknown, blocks: readonly SourceBlock[], text: string): Promise<unknown> {
  if (!blocks.length) return raw;
  const x = expandSourceRefs(raw, blocks);
  if (!x.expanded && !x.unknown.length) return x.raw;
  return (await attachUncovered(x.raw, text)).raw;
}
