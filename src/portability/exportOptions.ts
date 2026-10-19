/**
 * How much detail a canvas export carries. Every option is on by default;
 * turning one off strips that detail from the bundle, which stays a valid
 * `.acute.json` file (the content itself — text, shapes, pages, arrows — is
 * always kept).
 */
import type { AcuteBundle, BundleElement } from "./bundle";

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
}

export const EXPORT_OPTION_KEYS = ["origin", "blockStyles", "connectionTypes", "images", "viewSettings", "layoutHints"] as const satisfies readonly (keyof ExportOptions)[];

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { origin: true, blockStyles: true, connectionTypes: true, images: true, viewSettings: true, layoutHints: true };

/** The bundle with the details `options` turns off removed. Never mutates `bundle`. */
export function applyExportOptions(bundle: AcuteBundle, options: ExportOptions): AcuteBundle {
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
