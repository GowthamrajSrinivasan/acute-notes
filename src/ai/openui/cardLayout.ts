/**
 * Stored card layouts (note-taking-modes plan §4.2, Step 3): what the Cards view draws for a text block, and whether a
 * stored layout still matches the card's text. Pure: no store, no model call.
 *
 * Draw order for a text block in the Cards view:
 * 1. its stored layout, while the layout is current (its `contentHash` matches the card's text);
 * 2. the card derived from its text (`cardLangOf`) — for a card that cites a source (as before), any card on an AI-managed
 *    canvas, and a card whose stored layout is stale (a layout was asked for it, so it stays a card);
 * 3. otherwise the Compact preview. A layout that fails the structure check (`layoutCheck.ts`) is skipped, and one that
 *    fails to render falls through to the next.
 *
 * Manual canvases keep the "cites a source" rule for derived cards (D5); a stored layout is drawn in every mode (P1).
 */
import { fnv1a } from "@/domain/lens/paging";
import { CARD_LAYOUT_LANG_MAX, type CardLayout, type NoteMode, type RichContent } from "@/domain/types";
import { cardLangOf, cardTextOf } from "./cardLang";
import { flowLang, flowOfContent, isFlowLang } from "./flowLayout";

/** At most this many characters of Lang per card: a layout must never carry a large payload into the canvas. */
export const LAYOUT_LANG_MAX = CARD_LAYOUT_LANG_MAX;

type CardText = { title: string; snapshot: RichContent };

/**
 * The hash of a card's text as a layout is composed from it: its title, plain text and table, not its formatting — making
 * a word bold doesn't make the layout stale, changing a word does.
 */
export function cardContentHash(rec: CardText): string {
  const text = JSON.stringify(cardTextOf(rec));
  return fnv1a(text) + fnv1a(text, 0x01000193);
}

export class LayoutError extends Error {}

/** A layout for this card's current text. Throws `LayoutError` for empty or oversized Lang (no parsing here: Step 4). */
export function layoutFor(rec: CardText, lang: string, now = Date.now()): CardLayout {
  const trimmed = lang.trim();
  if (!trimmed) throw new LayoutError("The layout is empty.");
  if (trimmed.length > LAYOUT_LANG_MAX) throw new LayoutError(`The layout is longer than ${LAYOUT_LANG_MAX} characters.`);
  return { format: "openui-lang", version: 1, lang: trimmed, contentHash: cardContentHash(rec), writtenAt: now };
}

export type LayoutState = "none" | "current" | "stale";

export function layoutStateOf(rec: CardText & { layout?: CardLayout }): LayoutState {
  if (!rec.layout) return "none";
  return rec.layout.contentHash === cardContentHash(rec) ? "current" : "stale";
}

export interface CardRenderPlan {
  /** Lang to try, in order (stored layout first when current, then the derived card). Never empty. */
  langs: string[];
  /** The card has a stored layout that no longer matches its text. */
  stale: boolean;
}

/**
 * What the Cards view draws for one text block; null when it stays Compact. `cites`/`needsReview` are the published
 * citation data of a source-citing card (none for any other block).
 */
export function cardRenderPlan(
  rec: CardText & { layout?: CardLayout },
  opts: {
    noteMode: NoteMode;
    cites?: readonly string[];
    needsReview?: string;
    /**
     * Whether a stored layout may be drawn: the caller passes the structure check (`layoutCheck.ts`
     * `checkLayoutStructure`), which needs the card library — kept out of this module so the canvas writer can hash
     * cards without loading OpenUI. Without it no stored layout is drawn: a layout that reached storage some other way
     * (an import, an older build) is never drawn unchecked.
     */
    drawable?: (lang: string) => boolean;
  },
): CardRenderPlan | null {
  const state = layoutStateOf(rec);
  const cited = !!opts.cites?.length;
  const langs: string[] = [];
  if (state === "current" && opts.drawable?.(rec.layout!.lang)) langs.push(rec.layout!.lang);
  // A flow card (Step 6) whose text changed since its layout was made — an update, a hand edit — is drawn as a flow again,
  // rebuilt in code from its text now, so it is never out of date while its text is still a flow.
  if (state === "stale" && isFlowLang(rec.layout!.lang)) {
    const flow = flowOfContent(rec);
    const lang = flow ? flowLang(flow, opts.cites ?? []) : null;
    if (lang && opts.drawable?.(lang)) {
      const derived = cardLangOf(rec, { cites: opts.cites ?? [], ...(opts.needsReview ? { needsReview: opts.needsReview } : {}) });
      return { langs: derived ? [lang, derived] : [lang], stale: false };
    }
  }
  if (cited || opts.noteMode === "ai" || state !== "none") {
    const derived = cardLangOf(rec, { cites: opts.cites ?? [], ...(opts.needsReview ? { needsReview: opts.needsReview } : {}) });
    if (derived) langs.push(derived);
  }
  return langs.length ? { langs, stale: state === "stale" } : null;
}
