/**
 * How much detail a canvas export carries. Every option is on by default;
 * turning one off strips that detail from the bundle, which stays a valid
 * `.acute.json` file (the content itself — text, shapes, pages, arrows — is
 * always kept).
 */
import { normalizeObjectMetadata } from "@/domain/provenance";
import type { AcuteBundle, BundleElement } from "./bundle";
import { withSanitizedMetadata } from "./sanitize";

export interface ExportOptions {
  /** Who created each object (AI, with its provider and task, or the user): `metadata.ai` / `customData.acuteMeta`. */
  origin: boolean;
  /** Rich blocks' colours, fonts and frame (`customData.acute.style`). */
  blockStyles: boolean;
  /** Arrows' relation types (`customData.acuteRelation`) and the derived relations list. */
  connectionTypes: boolean;
  /** Image files, embedded as data URLs. */
  images: boolean;
  /** The canvas's scroll/zoom and background colour. */
  viewSettings: boolean;
  /** Where Acute last placed each object (`customData.acuteLayout`, F41). */
  layoutHints: boolean;
  /**
   * The content sources the canvas was made from, with every version's text, and the links that tie each object to
   * them (knowledge-notes plan §6.4), so its citations can still be checked after an import. Needs `origin`: the links
   * live in the objects' origin. On for the user's own files (a backup, a canvas export); any future share flow starts
   * with it off, because a source can hold material the canvas doesn't show.
   */
  sources: boolean;
}

export const EXPORT_OPTION_KEYS = ["origin", "blockStyles", "connectionTypes", "images", "viewSettings", "layoutHints", "sources"] as const satisfies readonly (keyof ExportOptions)[];

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { origin: true, blockStyles: true, connectionTypes: true, images: true, viewSettings: true, layoutHints: true, sources: true };

/** Whether a file exported with `options` carries its sources (they need the origin, where the links live). */
export function includesSources(options: ExportOptions): boolean {
  return options.sources && options.origin;
}

/**
 * The bundle without its `sources` section and without the reconciliation links on objects (as every export was
 * before §6.4): nothing in it points at a source the file doesn't carry. Never mutates `bundle`.
 */
export function withoutSources(bundle: AcuteBundle): AcuteBundle {
  const { sources: _sources, ...rest } = bundle;
  return {
    ...rest,
    canvases: bundle.canvases.map((c) => ({ ...c, elements: c.elements.map((el) => withSanitizedMetadata(el)) })),
    documents: bundle.documents.map(({ metadata, ...d }) => {
      const meta = normalizeObjectMetadata(metadata);
      return meta ? { ...d, metadata: meta as Record<string, unknown> } : d;
    }),
  };
}

/** The bundle with the details `options` turns off removed. Never mutates `bundle`. */
export function applyExportOptions(full: AcuteBundle, options: ExportOptions): AcuteBundle {
  const bundle = includesSources(options) ? full : withoutSources(full);
  const element = (el: BundleElement): BundleElement => {
    const data = el.customData as Record<string, unknown> | undefined;
    if (!data) return el;
    const next: Record<string, unknown> = { ...data };
    if (!options.origin) delete next.acuteMeta;
    if (!options.connectionTypes) delete next.acuteRelation;
    if (!options.layoutHints) delete next.acuteLayout;
    if (!options.blockStyles && isRecord(next.acute) && "style" in next.acute) {
      const { style: _style, ...acute } = next.acute;
      next.acute = acute;
    }
    return { ...el, customData: next };
  };
  return {
    ...bundle,
    canvases: bundle.canvases.map((c) => {
      const { viewport, viewBackgroundColor, ...rest } = c;
      return {
        ...rest,
        ...(options.viewSettings && viewport ? { viewport } : {}),
        ...(options.viewSettings && viewBackgroundColor !== undefined ? { viewBackgroundColor } : {}),
        elements: c.elements.map(element),
      };
    }),
    documents: options.origin ? bundle.documents : bundle.documents.map(({ metadata: _metadata, ...d }) => d),
    relations: options.connectionTypes ? bundle.relations : [],
    assets: options.images ? bundle.assets : [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
