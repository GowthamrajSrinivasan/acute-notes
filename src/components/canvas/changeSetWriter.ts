/**
 * Writes an accepted AI change set (F19) to the Excalidraw scene, through
 * the same element constructors as manual creation (`createBlockElement`,
 * Excalidraw's own element skeletons). Everything goes in with one scene
 * update; the caller wraps it in one history step (`acceptChangeSet`).
 */
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ChangeSetCanvas } from "@/ai/changes/accept";
import type { Box, ChangeSet, ChangeTarget, ProposedChange } from "@/ai/changes/changeSet";
import { frameNameBand, placeLabel, routeConnectors, sectionAvoid } from "@/ai/changes/routing";
import { relationStyle } from "@/ai/changes/relationStyle";
import { blockLink, getEmbedRef, isWhereAcutePlacedIt, pageLink, withLayoutHint, withRelation, type SceneElement } from "@/domain/canvas/adapter";
import { getFrameLens, getNodeLens, withDiagramMeta, withEdgeSemantics, withFrameLens, withNodeLens, withNodeSemantics } from "@/domain/canvas/diagram";
import { applyNodePatch, kindChangeStyle, nodeKindIn } from "@/domain/canvas/nodePatch";
import { NODE_KIND_STYLES } from "@/domain/canvas/nodeKindStyle";
import { fingerprintContent, fingerprintShape } from "@/ai/content/fingerprint";
import { fingerprintOf, labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import { getDocumentStore } from "@/state/documents";
import { CARD_STYLE, TEXT_ITEM_STYLE, type BlockStyle } from "@/domain/content/blockStyle";
import { randomId } from "@/domain/ids";
import { createPage } from "@/domain/pages/pageCommands";
import type { AIMetadata, DocumentHome, ObjectMetadata, SourceRef } from "@/domain/types";
import { connectorPoints, elbowFields, isAcuteRouted, isRouteObstacle, labelCenter, routedBox, straightFields } from "./connectorRoutes";
import { compositePartOf, isCompositeShape, shapeKindOf } from "@/domain/canvas/compositeShapes";
import { createCompositeShapeElements, withNormalizedComposites } from "./compositeShapes";
import { createPagePreviewElement } from "./pagePreviews";
import { createBlockDocument, createBlockElement } from "./richBlocks";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type BoundRef = { id: string; type: "arrow" | "text" };

const boxOf = (el: ExcalidrawElement): Box => ({ x: el.x, y: el.y, width: el.width, height: el.height });

/** The change-set canvas for `api`, with the scene as it is right now. */
export function changeSetCanvas(api: ExcalidrawImperativeAPI, home: DocumentHome): ChangeSetCanvas {
  const live = new Map(api.getSceneElements().map((el) => [el.id, el as ExcalidrawElement] as const));
  return {
    boxOf: (id) => {
      const el = live.get(id);
      return el ? boxOf(el) : undefined;
    },
    write: (set, changes) => writeChanges(api, home, set, changes),
  };
}

/** Excalidraw's default label font (the one skeleton labels get), with its CJK fallback, at its default size. */
const LABEL_FONT = "20px Excalifont, Xiaolai";

const hasFonts = () => typeof document !== "undefined" && !!document.fonts;

/** Every character of the set's shape and connector labels (they pick which unicode-range subsets of the font are needed). */
function labelText(set: ChangeSet): string {
  const labels = set.changes.flatMap((c) => ((c.kind === "create_shape" || c.kind === "update_shape" || c.kind === "connect") && c.label ? [c.label] : []));
  return [...new Set(labels.join(""))].join("");
}

/**
 * Excalidraw wraps a label and fits its shape by measuring it once, when the
 * element is written, and never again when the font arrives later: measured
 * in the fallback font (~10% narrower), a label then spills over its shape's
 * outline or breaks mid-word. Excalidraw loads a font only once the scene
 * uses it, so a canvas of only blocks has never loaded it — hence these.
 */

/** Starts loading the label font's common subset (on canvas open, well before any change set is written). */
export function preloadLabelFont(): void {
  if (hasFonts()) void document.fonts.load(LABEL_FONT).catch(() => undefined);
}

/** Whether the font `set`'s labels are drawn in is loaded, so they can be written now and measure true. */
export function labelFontsReady(set: ChangeSet): boolean {
  const text = labelText(set);
  return !text || !hasFonts() || document.fonts.check(LABEL_FONT, text);
}

/** Loads the font `set`'s labels are drawn in. Never rejects. */
export function loadLabelFonts(set: ChangeSet): Promise<void> {
  const text = labelText(set);
  if (!text || !hasFonts()) return Promise.resolve();
  return document.fonts.load(LABEL_FONT, text).then(
    () => undefined,
    () => undefined,
  );
}

function writeChanges(api: ExcalidrawImperativeAPI, home: DocumentHome, set: ChangeSet, changes: readonly ProposedChange[]): Map<string, string> {
  const metadata: ObjectMetadata = { ai: set.metadata };
  const source = set.contentSource;
  /** Provenance for one object: the set's, plus its reconciliation link (F37) when the set comes from a content source. */
  // A split set's pieces (F42 Phase 4) link to the split block's source, at its version, as pieces of its node.
  const split = set.split;
  const link = source ? { sourceId: source.sourceId, version: source.version } : split ? { sourceId: split.sourceId, version: split.version } : null;
  const metadataFor = (stableNodeKey: string | undefined, fingerprint: string, previous?: unknown): ObjectMetadata => {
    if (!link || !stableNodeKey) return metadata;
    const ai: AIMetadata = {
      ...(isRecord(previous) ? (previous as unknown as AIMetadata) : {}),
      ...set.metadata,
      contentSourceId: link.sourceId,
      contentSourceVersion: link.version,
      stableNodeKey,
      contentFingerprint: fingerprint,
      ...(split ? { splitOf: split.of, splitFingerprint: split.fingerprint } : {}),
    };
    return { ai };
  };
  /**
   * An update that isn't from a content source (an MCP edit, F21) changes content only: the object keeps its
   * previous provenance and reconciliation link (a user's block stays the user's; a Visualize block keeps its
   * baseline, so reconciliation treats the accepted edit as the user's own).
   */
  const updatedMetadata = (stableNodeKey: string | undefined, fingerprint: string, previous: ObjectMetadata | undefined): ObjectMetadata =>
    source && stableNodeKey ? metadataFor(stableNodeKey, fingerprint, previous?.ai) : (previous ?? {});
  /** The object's external source records (F43: repo path at a commit), when the change carries them; they replace any previous ones. */
  const withRefs = (meta: ObjectMetadata, refs: readonly SourceRef[] | undefined): ObjectMetadata =>
    refs?.length && meta.ai ? { ...meta, ai: { ...meta.ai, sourceRefs: [...refs] } } : meta;
  /** A connector's provenance: the source link only (no node key — connectors are matched by their ends, F38b). */
  const connectorMetadata: ObjectMetadata = link ? { ai: { ...set.metadata, contentSourceId: link.sourceId, contentSourceVersion: link.version } } : metadata;
  const scene = api.getSceneElementsIncludingDeleted() as readonly ExcalidrawElement[];
  const existing = new Map(scene.map((el) => [el.id, el] as const));
  /** Existing elements this change set modifies (moved, or newly bound to a connector). */
  const replaced = new Map<string, ExcalidrawElement>();
  const current = (id: string) => replaced.get(id) ?? existing.get(id);
  /** New elements, in creation order (blocks and shapes first, then connectors). */
  const added: Mutable<ExcalidrawElement>[] = [];
  const addedById = new Map<string, Mutable<ExcalidrawElement>>();
  const ids = new Map<string, string>();
  /**
   * A new composite shape's outline parts → their host. Not objects of their own (no layout hint), they join their
   * host's section here, so they are ordered before its frame as Excalidraw expects of a frame's children.
   */
  const partHost = new Map<string, string>();
  const inSection = (el: ExcalidrawElement, members: ReadonlySet<string>) =>
    members.has(el.id) || (el.type === "text" && !!el.containerId && members.has(el.containerId)) || members.has(partHost.get(el.id) ?? "");
  const add = (els: readonly ExcalidrawElement[]) => {
    for (const el of els) {
      added.push(el as Mutable<ExcalidrawElement>);
      addedById.set(el.id, el as Mutable<ExcalidrawElement>);
    }
  };

  // 1. Objects.
  for (const c of changes) {
    if (c.kind === "create_block") {
      // Aligned text (a centred title) keeps its box's width; a card follows its content's height until resized (F42).
      const base: BlockStyle =
        c.frame === "none" ? { ...TEXT_ITEM_STYLE, ...(c.textAlign ? { textAlign: c.textAlign, autoWidth: false } : {}) } : { ...CARD_STYLE, autoHeight: true };
      const style: BlockStyle = { ...base, ...(c.fontSize ? { fontSize: c.fontSize } : {}) };
      const el = createBlockElement(home, c.blockType, { box: c.box, style, content: c.content, backgroundColor: c.backgroundColor, metadata: withRefs(metadataFor(c.stableNodeKey, fingerprintContent(c.content)), c.sourceRefs) });
      // A card's kind (Lens Phase 2) in its own acuteNode, as a shape's.
      if (c.semantics) (el as Mutable<ExcalidrawElement>).customData = withNodeSemantics(el.customData, c.semantics);
      ids.set(c.key, el.id);
      add([el]);
    } else if (c.kind === "create_shape") {
      const id = randomId();
      ids.set(c.key, id);
      // An architecture component's kind sets its colours (as choosing the kind in the panel does).
      // A project node's kind comes in its project patch (Phase 7B); an architecture node's in its semantics.
      const kindOfShape = c.semantics?.kind ?? c.project?.kind ?? undefined;
      const kindStyle = kindOfShape ? NODE_KIND_STYLES[kindOfShape] : undefined;
      const acuteMeta = withRefs(metadataFor(c.stableNodeKey, fingerprintShape(c.shape, c.label ?? "")), c.sourceRefs);
      if (isCompositeShape(c.shape)) {
        const els = createCompositeShapeElements(c.shape, {
          id,
          box: c.box,
          ...(c.label ? { label: c.label } : {}),
          ...(kindStyle ? { strokeColor: kindStyle.strokeColor } : {}),
          backgroundColor: kindStyle?.backgroundColor ?? c.backgroundColor ?? "transparent",
          customData: nodeCustomData({ acuteMeta }, c),
        });
        for (const el of els) if (compositePartOf(el as unknown as SceneElement)) partHost.set(el.id, id);
        add(els);
        continue;
      }
      const skeleton = {
        type: c.shape,
        id,
        ...c.box,
        backgroundColor: kindStyle?.backgroundColor ?? c.backgroundColor ?? "transparent",
        ...(kindStyle ? { strokeColor: kindStyle.strokeColor } : {}),
        fillStyle: "solid",
        roughness: 1,
        customData: c.backdrop ? { acuteMeta: metadata, acuteBackdrop: true } : nodeCustomData({ acuteMeta }, c),
        // A sub-topic's backdrop: a soft dashed outline with rounded corners, filled with nothing, behind what it groups.
        ...(c.backdrop ? { strokeColor: "#adb5bd", strokeStyle: "dashed", strokeWidth: 1, roundness: { type: 3 } } : {}),
        ...(c.label ? { label: { text: c.label } } : {}),
      };
      add(convertToExcalidrawElements([skeleton] as never, { regenerateIds: false }) as unknown as ExcalidrawElement[]);
    } else if (c.kind === "create_page") {
      const pageId = createPage(home.workspaceId, home.canvasId, { title: c.title, content: c.content, metadata: withRefs(metadataFor(c.stableNodeKey, fingerprintContent(c.content, c.title)), c.sourceRefs) });
      const el = createPagePreviewElement(pageId, c.box);
      ids.set(c.key, el.id);
      add([el]);
    }
  }

  // Sections (F42): each frame after its members (Excalidraw's order for frame children), members and their labels
  // assigned to it. A frame carries only the set's provenance, never a content-source link: its title is reconciled instead.
  for (const c of changes) {
    if (c.kind !== "create_frame") continue;
    const members = new Set(c.children.flatMap((k) => (ids.has(k) ? [ids.get(k)!] : [])));
    // A frame named with no children is created empty (a template's frame, setup plan Part B); one whose children all
    // failed to be created is skipped.
    if (!members.size && c.children.length) continue;
    const id = randomId();
    ids.set(c.key, id);
    for (const el of added) if (inSection(el, members)) el.frameId = id;
    const customData = { acuteMeta: metadata, ...(c.overview ? { acuteOverview: c.overview } : {}) };
    const skeleton = {
      type: "frame",
      id,
      ...c.box,
      name: c.title,
      children: [],
      customData: frameCustomData(customData, c),
    };
    const [frame] = convertToExcalidrawElements([skeleton] as never, { regenerateIds: false }) as unknown as Mutable<ExcalidrawElement>[];
    // Excalidraw fits a skeleton frame to its skeleton children; these members aren't skeletons, so the box is set here.
    Object.assign(frame!, c.box);
    add([frame!]);
  }

  // New objects joining an existing section (F42 Phase 3): members of its frame, which grows to fit them (below).
  const refit = new Set<string>();
  for (const c of changes) {
    if (c.kind !== "update_frame") continue;
    const frame = current(c.target);
    if (!frame || frame.isDeleted || frame.type !== "frame") continue;
    if (c.name !== undefined && (frame as { name?: string | null }).name !== c.name) replaced.set(frame.id, newElementWith(frame, { name: c.name } as never));
    const members = new Set(c.add.flatMap((k) => (ids.has(k) ? [ids.get(k)!] : [])));
    for (const el of added) if (inSection(el, members)) el.frameId = frame.id;
    if (members.size) refit.add(frame.id);
  }

  // Where Acute put each new object (F41's layout hint: it stays cheap to move until the user moves it). Labels go with their container.
  for (const el of added) if (!(el.type === "text" && el.containerId) && !partHost.has(el.id)) el.customData = withLayoutHint(el.customData, el);

  // 2. Moves of existing objects (before connectors, so they bind to where objects end up).
  for (const c of changes) if (c.kind === "move") moveElement(c.target, c.to, current, replaced);
  // A frame whose members were moved to make room grows to keep them inside it.
  for (const c of changes) {
    const frameId = c.kind === "move" ? current(c.target)?.frameId : null;
    if (frameId) refit.add(frameId);
  }

  // 3. Connectors, bound at both ends.
  const resolve = (t: ChangeTarget): ExcalidrawElement | undefined => ("existing" in t ? current(t.existing) : addedById.get(ids.get(t.created)!));
  const bind = (el: ExcalidrawElement, arrowId: string) => {
    const refs: BoundRef[] = [...((el.boundElements as BoundRef[] | null) ?? []), { id: arrowId, type: "arrow" }];
    const target = addedById.get(el.id);
    if (target) target.boundElements = refs;
    else replaced.set(el.id, newElementWith(el, { boundElements: refs }));
  };
  // Right-angle routes for every new connector at once, so connectors sharing a box side spread out
  // and none runs through an unrelated object (Wave 1b item 2, `ai/changes/routing.ts`).
  const connects = changes.flatMap((c) => {
    if (c.kind !== "connect") return [];
    const from = resolve(c.from);
    const to = resolve(c.to);
    return from && to ? [{ c, from, to }] : []; // resolved before writing; defensive only
  });
  const obstacles = [...scene.filter((el) => !addedById.has(el.id)).map((el) => current(el.id)!), ...added].filter(isRouteObstacle).map(routedBox);
  // A link between two sections avoids the other sections' frames: it runs in the gutters between them.
  const frames = [...scene.filter((el) => !addedById.has(el.id) && el.type === "frame" && !el.isDeleted).map((el) => current(el.id)!), ...added.filter((el) => el.type === "frame")].map(routedBox);
  const avoidFor = (from: ExcalidrawElement, to: ExcalidrawElement) =>
    from.type === "frame" && to.type === "frame" ? { avoid: sectionAvoid(frames, from.id, to.id), wide: true } : {};
  const routes = routeConnectors(
    connects.map(({ c, from, to }) => ({ key: c.key, from: routedBox(from), to: routedBox(to), ...avoidFor(from, to) })),
    obstacles,
  );
  // Labels already placed, so the next one goes where it doesn't cover them — nor a section's name.
  const placedLabels: Box[] = frames.map(frameNameBand);
  for (const { c, from, to } of connects) {
    const id = randomId();
    ids.set(c.key, id);
    const route = routes.get(c.key)!;
    const toFields = c.routing === "straight" ? straightFields : elbowFields;
    const fields = toFields(route, from.id, to.id, withEdgeSemantics(withRelation({ acuteMeta: connectorMetadata }, c.relation), c.explanation || c.confidence !== undefined ? { ...(c.explanation ? { explanation: c.explanation } : {}), ...(c.confidence !== undefined ? { confidence: c.confidence } : {}) } : undefined));
    // The relation type is visible on the arrow itself (Wave C): dashed for "depends on", a bar for "blocks"…
    const style = relationStyle(c.relation);
    const labelText = c.label ?? style.defaultLabel;
    const skeleton = {
      type: "arrow",
      id,
      x: fields.x,
      y: fields.y,
      width: fields.width,
      height: fields.height,
      points: fields.points,
      strokeStyle: style.strokeStyle,
      endArrowhead: style.endArrowhead,
      customData: fields.customData,
      ...(labelText ? { label: { text: labelText, fontSize: 16 } } : {}),
    };
    const [arrow, ...label] = convertToExcalidrawElements([skeleton] as never, { regenerateIds: false }) as unknown as Mutable<ExcalidrawElement>[];
    Object.assign(arrow!, fields);
    // The label sits on the route's longest segment (conversion placed it for a straight arrow), or the nearest
    // spot along the route clear of the labels placed before it.
    for (const text of label) {
      const at = placeLabel(connectorPoints(route, c.routing), text.width, text.height, placedLabels);
      Object.assign(text, { x: at.x - text.width / 2, y: at.y - text.height / 2 });
      placedLabels.push({ x: text.x, y: text.y, width: text.width, height: text.height });
    }
    add([arrow!, ...label]);
    bind(from, id);
    bind(to, id);
  }
  // Existing Acute-routed connectors whose ends were moved (step 2): shifting an end breaks the right angles, so route them again.
  const moved = [...replaced.values()].filter((el) => isAcuteRouted(el) && !el.isDeleted) as (ExcalidrawElement & {
    startBinding: { elementId: string } | null;
    endBinding: { elementId: string } | null;
  })[];
  const rerouteRequests = moved.flatMap((a) => {
    const from = a.startBinding && current(a.startBinding.elementId);
    const to = a.endBinding && current(a.endBinding.elementId);
    return from && to ? [{ key: a.id, from: routedBox(from), to: routedBox(to) }] : [];
  });
  const rerouted = routeConnectors(rerouteRequests, obstacles);
  for (const r of rerouteRequests) {
    const arrow = current(r.key)!;
    const route = rerouted.get(r.key)!;
    replaced.set(arrow.id, newElementWith(arrow, elbowFields(route, r.from.id, r.to.id, arrow.customData as Record<string, unknown> | undefined) as never));
    const at = labelCenter(route.points);
    for (const ref of (arrow.boundElements as BoundRef[] | null) ?? []) {
      const text = ref.type === "text" ? current(ref.id) : undefined;
      if (text) replaced.set(text.id, newElementWith(text, { x: at.x - text.width / 2, y: at.y - text.height / 2 }));
    }
  }

  // 4. Reconciliation (F38/F39): updates, removals and "Keep mine" baselines of existing objects.
  const relabelled = new Set<string>();
  const labels = labelsByContainer(scene as unknown as readonly SceneElement[]);
  const boundOf = (el: ExcalidrawElement) =>
    ((el.boundElements as BoundRef[] | null) ?? []).map((b) => current(b.id)).filter((b): b is ExcalidrawElement => !!b && !b.isDeleted);
  for (const c of changes) {
    if (c.kind !== "update_block" && c.kind !== "update_shape" && c.kind !== "update_node" && c.kind !== "set_lens" && c.kind !== "remove" && c.kind !== "rebaseline") continue;
    const el = current(c.target);
    if (!el || el.isDeleted) continue;
    const ref = getEmbedRef(el);
    if (c.kind === "update_block") {
      if (ref?.kind === "rich-block") {
        const previous = getDocumentStore().get(ref.documentId)?.metadata;
        const documentId = createBlockDocument(home, c.content, withRefs(updatedMetadata(c.stableNodeKey, fingerprintContent(c.content), previous), c.sourceRefs));
        replaced.set(el.id, newElementWith(el, { link: blockLink(documentId), customData: { ...el.customData, acute: { ...ref, documentId } } }));
      } else if (ref?.kind === "page-preview") {
        const old = getDocumentStore().get(ref.pageId);
        const title = c.title ?? old?.title ?? "";
        const pageId = createPage(home.workspaceId, home.canvasId, {
          title,
          content: c.content,
          metadata: withRefs(updatedMetadata(c.stableNodeKey, fingerprintContent(c.content, title), old?.metadata), c.sourceRefs),
        });
        replaced.set(el.id, newElementWith(el, { link: pageLink(pageId), customData: { ...el.customData, acute: { ...ref, pageId } } }));
      }
    } else if (c.kind === "update_shape") {
      const label = boundOf(el).find((b) => b.type === "text");
      if (label) {
        replaced.set(label.id, newElementWith(label, { text: c.label, originalText: c.label } as never));
        relabelled.add(label.id);
      }
      const previous = (el.customData?.acuteMeta as ObjectMetadata | undefined)?.ai;
      replaced.set(el.id, newElementWith(el, { customData: { ...el.customData, acuteMeta: withRefs(metadataFor(c.stableNodeKey, fingerprintShape(shapeKindOf(el as unknown as SceneElement) ?? el.type, c.label), previous), c.sourceRefs) } }));
    } else if (c.kind === "update_node") {
      // Shapes only; the Lens half is never in a patch, so key / expandsTo / sources pass through untouched.
      if (el.type !== "rectangle" && el.type !== "ellipse" && el.type !== "diamond") continue;
      const customData = applyNodePatch(el.customData, c.semantics);
      const style = kindChangeStyle(el, nodeKindIn(el.customData), nodeKindIn(customData));
      replaced.set(el.id, newElementWith(el, { customData, ...style }));
    } else if (c.kind === "set_lens") {
      // D43: a frame's level, a node's drill link; nothing else on the element changes.
      if (el.type === "frame") {
        if (c.level !== undefined) replaced.set(el.id, newElementWith(el, { customData: withFrameLens(el.customData, { ...getFrameLens(el), level: c.level ?? undefined }) }));
      } else if (c.expandsTo !== undefined) {
        replaced.set(el.id, newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), expandsTo: c.expandsTo ?? undefined }) }));
      }
    } else if (c.kind === "remove") {
      replaced.set(el.id, newElementWith(el, { isDeleted: true }));
      for (const b of boundOf(el)) {
        // Its label goes with it; so do connectors this same content source drew (the user's own arrows stay).
        const aiSource = (b.customData?.acuteMeta as ObjectMetadata | undefined)?.ai?.contentSourceId;
        if (b.type === "text" || (b.type === "arrow" && source && aiSource === source.sourceId)) {
          replaced.set(b.id, newElementWith(b, { isDeleted: true }));
          for (const l of boundOf(b)) if (l.type === "text") replaced.set(l.id, newElementWith(l, { isDeleted: true }));
        }
      }
    } else {
      // Keep mine: the current content becomes the baseline; nothing visible changes.
      const now = objectContent(el as unknown as SceneElement, labels, (id) => getDocumentStore().get(id));
      if (!now) continue;
      const fingerprint = fingerprintOf(now);
      const version = source ? { contentSourceVersion: source.version } : {};
      if (now.kind === "shape") {
        const previous = (el.customData?.acuteMeta as ObjectMetadata | undefined)?.ai;
        replaced.set(el.id, newElementWith(el, { customData: { ...el.customData, acuteMeta: { ai: { ...(previous ?? set.metadata), ...version, contentFingerprint: fingerprint } } } }));
      } else {
        const rec = getDocumentStore().get(now.documentId);
        if (rec) getDocumentStore().update(now.documentId, { metadata: { ...rec.metadata, ai: { ...(rec.metadata?.ai ?? set.metadata), ...version, contentFingerprint: fingerprint } } });
      }
    }
  }
  // 6. Connections changed (Phase 7C): relation (with its line style), label, explanation.
  for (const c of changes) {
    if (c.kind !== "update_connection") continue;
    const arrow = current(c.target);
    if (!arrow || arrow.isDeleted || arrow.type !== "arrow") continue;
    let customData = arrow.customData as Record<string, unknown> | undefined;
    const lineStyle: Record<string, unknown> = {};
    if (c.relation !== undefined) {
      customData = withRelation(customData, c.relation ?? undefined);
      const style = relationStyle(c.relation ?? undefined);
      Object.assign(lineStyle, { strokeStyle: style.strokeStyle, endArrowhead: style.endArrowhead });
    }
    if (c.explanation !== undefined) customData = withEdgeSemantics(customData, c.explanation ? { explanation: c.explanation } : undefined);
    // The arrow itself changes only when its relation or explanation does (a label lives in its own text element).
    if (c.relation !== undefined || c.explanation !== undefined) replaced.set(arrow.id, newElementWith(arrow, { ...lineStyle, customData } as never));
    if (c.label === undefined) continue;
    const text = boundOf(arrow).find((b) => b.type === "text");
    if (!c.label) {
      if (text) replaced.set(text.id, newElementWith(text, { isDeleted: true }));
    } else if (text) {
      replaced.set(text.id, newElementWith(text, { text: c.label, originalText: c.label } as never));
      relabelled.add(text.id);
    } else {
      // A label for an arrow that had none: bound to it, at the middle of its path.
      const points = (arrow as unknown as { points: readonly (readonly [number, number])[] }).points ?? [[0, 0]];
      const mid = points[Math.floor(points.length / 2)] ?? [0, 0];
      const [label] = convertToExcalidrawElements([{ type: "text", x: arrow.x + mid[0], y: arrow.y + mid[1], text: c.label, fontSize: 16 }] as never, { regenerateIds: true }) as unknown as Mutable<ExcalidrawElement>[];
      Object.assign(label!, { containerId: arrow.id, textAlign: "center", verticalAlign: "middle" });
      add([label!]);
      const latest = replaced.get(arrow.id)!;
      replaced.set(arrow.id, newElementWith(latest, { boundElements: [...((latest.boundElements as BoundRef[] | null) ?? []), { id: label!.id, type: "text" }] }));
    }
  }

  // 7. Groups (Phase 7C's group_blocks): a new titled frame around existing objects and their labels. Frames can't nest,
  // so an object already in one (or a frame, or an arrow) stays out.
  for (const c of changes) {
    if (c.kind !== "group_objects") continue;
    const members = c.targets.map((t) => current(t)).filter((el): el is ExcalidrawElement => !!el && !el.isDeleted && el.type !== "frame" && el.type !== "arrow" && !el.frameId);
    if (!members.length) continue;
    const labels = members.flatMap((m) => boundOf(m).filter((b) => b.type === "text"));
    const minX = Math.min(...members.map((m) => m.x));
    const minY = Math.min(...members.map((m) => m.y));
    const maxX = Math.max(...members.map((m) => m.x + m.width));
    const maxY = Math.max(...members.map((m) => m.y + m.height));
    const box = { x: minX - FRAME_PADDING, y: minY - FRAME_PADDING - 20, width: maxX - minX + FRAME_PADDING * 2, height: maxY - minY + FRAME_PADDING * 2 + 20 };
    const id = randomId();
    ids.set(c.key, id);
    const [frame] = convertToExcalidrawElements([{ type: "frame", id, ...box, name: c.title, children: [], customData: { acuteMeta: metadata } }] as never, { regenerateIds: false }) as unknown as Mutable<ExcalidrawElement>[];
    Object.assign(frame!, box);
    add([frame!]);
    for (const m of [...members, ...labels]) replaced.set(m.id, newElementWith(current(m.id)!, { frameId: id }));
  }

  // 5. Restores (D43, a revert of an agent's change): the element as it was, keeping its id and bindings. One still in
  // the scene (live or deleted) is reset in place, so it keeps its z-order; one gone from the scene entirely is re-created.
  const reinstated: ExcalidrawElement[] = [];
  for (const c of changes) {
    if (c.kind !== "restore") continue;
    const { version: _v, versionNonce: _n, updated: _u, index: _i, ...fields } = c.element as Record<string, unknown>;
    const el = current(c.target);
    // Rebuilt from the snapshot (a field it doesn't have isn't kept from the current element), keeping the current
    // version history and z-order so the element moves forward rather than back.
    if (el) replaced.set(el.id, newElementWith({ ...fields, version: el.version, versionNonce: el.versionNonce, index: (el as { index?: unknown }).index } as unknown as ExcalidrawElement, {}));
    else reinstated.push(...restoreElements([fields as unknown as ExcalidrawElement], null));
  }
  // A section frame Acute drew goes with its last member (F42): a removed section leaves no empty frame. The user's own frames stay.
  const emptied = new Set(changes.flatMap((c) => (c.kind === "remove" ? [existing.get(c.target)?.frameId] : [])).filter((id): id is string => !!id));
  for (const frameId of emptied) {
    const frame = current(frameId);
    if (!frame || frame.isDeleted || !(frame.customData?.acuteMeta as ObjectMetadata | undefined)?.ai) continue;
    const live = scene.some((el) => el.frameId === frameId && !(current(el.id)?.isDeleted ?? el.isDeleted));
    if (!live) replaced.set(frameId, newElementWith(frame, { isDeleted: true }));
  }
  if (relabelled.size) {
    // Re-measure changed labels so they wrap inside their shapes.
    const fresh = restoreElements([...relabelled].map((id) => replaced.get(id)!), null, { refreshDimensions: true });
    for (const el of fresh) replaced.set(el.id, el);
  }

  const restored = restoreElements(added as ExcalidrawElement[], null, { refreshDimensions: true });
  for (const frameId of refit) growFrame(frameId, [...scene.map((el) => replaced.get(el.id) ?? el), ...restored], replaced);
  api.updateScene({
    // A moved or removed composite shape's outline follows its host, in this same step.
    elements: withNormalizedComposites(inFrameOrder([...scene.map((el) => replaced.get(el.id) ?? el), ...reinstated], restored)) as ExcalidrawElement[],
    appState: {
      selectedElementIds: Object.fromEntries([...ids.values()].filter((id) => addedById.get(id)?.type !== "arrow").map((id) => [id, true as const])),
      selectedGroupIds: {},
      activeEmbeddable: null,
    },
    // Recorded by the canvas history's transaction (`CanvasHistory.record`), not Excalidraw's.
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return ids;
}

/** A created shape's `customData`: its semantics, then (a project node, Phase 7B) its project fields and Lens key. */
function nodeCustomData(base: Record<string, unknown>, c: Extract<ProposedChange, { kind: "create_shape" }>): Record<string, unknown> {
  let customData = withNodeSemantics(base, c.semantics);
  if (c.project) customData = applyNodePatch(customData, c.project);
  if (c.lensKey) customData = withNodeLens(customData, { key: c.lensKey });
  return customData;
}

/** A created frame's `customData`: interactive when it is a diagram or has a profile, with that profile (D25). */
function frameCustomData(base: Record<string, unknown>, c: Extract<ProposedChange, { kind: "create_frame" }>): Record<string, unknown> {
  if (!c.diagram && !c.profile) return base;
  const customData = withDiagramMeta(base, { type: "architecture", interactive: true, ...(c.diagram?.cards ? { cards: c.diagram.cards } : {}) });
  return c.profile || c.level !== undefined ? withFrameLens(customData, { ...(c.profile ? { profile: c.profile } : {}), ...(c.level !== undefined ? { level: c.level } : {}) }) : customData;
}

/** Room kept between a frame's edge and its members: the renderer's section padding (F42). */
const FRAME_PADDING = 40;

/** Grows (never shrinks) an existing frame so every live member fits inside it with `FRAME_PADDING` to spare. */
function growFrame(frameId: string, elements: readonly ExcalidrawElement[], replaced: Map<string, ExcalidrawElement>): void {
  const frame = elements.find((el) => el.id === frameId);
  const members = elements.filter((el) => el.frameId === frameId && !el.isDeleted);
  if (!frame || frame.isDeleted || !members.length) return;
  const x = Math.min(frame.x, ...members.map((m) => m.x - FRAME_PADDING));
  const y = Math.min(frame.y, ...members.map((m) => m.y - FRAME_PADDING));
  const right = Math.max(frame.x + frame.width, ...members.map((m) => m.x + m.width + FRAME_PADDING));
  const bottom = Math.max(frame.y + frame.height, ...members.map((m) => m.y + m.height + FRAME_PADDING));
  if (x === frame.x && y === frame.y && right === frame.x + frame.width && bottom === frame.y + frame.height) return;
  replaced.set(frameId, newElementWith(frame, { x, y, width: right - x, height: bottom - y }));
}

/**
 * The scene with the new elements: a new member of an existing frame goes just before that frame (Excalidraw
 * keeps a frame's children before it); everything else after the scene, as created.
 */
function inFrameOrder(scene: readonly ExcalidrawElement[], added: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const existingFrames = new Set(scene.flatMap((el) => (el.type === "frame" ? [el.id] : [])));
  const joining = new Map<string, ExcalidrawElement[]>();
  const rest: ExcalidrawElement[] = [];
  for (const el of added) {
    if (el.frameId && existingFrames.has(el.frameId)) joining.set(el.frameId, [...(joining.get(el.frameId) ?? []), el]);
    else rest.push(el);
  }
  return [...scene.flatMap((el) => [...(joining.get(el.id) ?? []), el]), ...rest];
}

/**
 * Moves an existing object, carrying along what Excalidraw would move with
 * it: its bound label, and the bound ends of connectors attached to it.
 */
function moveElement(
  id: string,
  to: { x: number; y: number },
  current: (id: string) => ExcalidrawElement | undefined,
  replaced: Map<string, ExcalidrawElement>,
): void {
  const el = current(id);
  if (!el || el.isDeleted) return;
  const dx = to.x - el.x;
  const dy = to.y - el.y;
  if (!dx && !dy) return;
  // An object Acute placed stays "placed by Acute" where Acute moves it; one the user placed stays the user's.
  replaced.set(id, newElementWith(el, { x: to.x, y: to.y, ...(isWhereAcutePlacedIt(el) ? { customData: withLayoutHint(el.customData, to) } : {}) }));
  for (const ref of (el.boundElements as BoundRef[] | null) ?? []) {
    const bound = current(ref.id);
    if (!bound || bound.isDeleted) continue;
    if (ref.type === "text") {
      replaced.set(bound.id, newElementWith(bound, { x: bound.x + dx, y: bound.y + dy }));
    } else if (bound.type === "arrow") {
      replaced.set(bound.id, shiftArrowEnds(bound, bound.startBinding?.elementId === id, bound.endBinding?.elementId === id, dx, dy));
      // The connector's label sits at its middle: move it by half as much when only one end moved.
      const both = bound.startBinding?.elementId === id && bound.endBinding?.elementId === id;
      for (const labelRef of (bound.boundElements as BoundRef[] | null) ?? []) {
        const label = labelRef.type === "text" ? current(labelRef.id) : undefined;
        if (label) replaced.set(label.id, newElementWith(label, { x: label.x + (both ? dx : dx / 2), y: label.y + (both ? dy : dy / 2) }));
      }
    }
  }
}

function shiftArrowEnds(arrow: Extract<ExcalidrawElement, { points: unknown }>, start: boolean, end: boolean, dx: number, dy: number): ExcalidrawElement {
  const abs = arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py] as [number, number]);
  const last = abs.length - 1;
  abs.forEach((p, i) => {
    if ((start && end) || (start && i === 0) || (end && i === last)) {
      p[0] += dx;
      p[1] += dy;
    }
  });
  const [ox, oy] = abs[0]!;
  const points = abs.map(([x, y]) => [x - ox, y - oy] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return newElementWith(arrow, {
    x: ox,
    y: oy,
    points: points as never,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
