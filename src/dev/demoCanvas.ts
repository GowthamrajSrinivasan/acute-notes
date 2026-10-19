/**
 * Dev-only "AI test canvas": creates a new canvas in the current workspace and
 * fills it with every kind of object Acute-Notes supports, so AI features can
 * be tried without building content by hand.
 *
 * Canvas content lives in this browser's IndexedDB, so seeding must run in the
 * app: `requestDemoCanvas` creates the canvas and leaves a one-shot flag, and
 * the canvas seeds itself (`seedPendingDemoCanvas`) once it opens.
 *
 * Contents — one "Checkout revamp" scenario, so Explain / Summarize / Find
 * related / Turn into tasks / Create test cases / Create plan all have
 * something real to work on:
 * - rich blocks: text card, todo, table, code; a frameless text item
 * - pages: a content preview (headings, quote, toggle, divider, lists, code,
 *   table) and a compact card
 * - native shapes (rectangle, diamond, ellipse) with labels, native text,
 *   a line, a freehand stroke and an image
 * - arrows between objects: typed relations (F23), a labelled arrow, and
 *   arrows bound to blocks and pages
 * - an unrelated note, so "Find related" has something to leave out
 */
import { CaptureUpdateAction, convertToExcalidrawElements, restoreElements } from "@excalidraw/excalidraw";
import { connectorEndpoints } from "@/ai/changes/geometry";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { BLOCK_STYLE } from "@/components/canvas/richBlocks";
import { blockLink, pageLink, type AcuteEmbedRef } from "@/domain/canvas/adapter";
import { CARD_STYLE, TEXT_ITEM_STYLE } from "@/domain/content/blockStyle";
import { PAGE_PREVIEW_SIZE } from "@/domain/content/richContent";
import { newId, randomId } from "@/domain/ids";
import type { ContentBlock, DocumentHome, InlineContent, RelationType, RichBlockType, RichContent } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { newBlockId } from "@/sync/blockIds";
import { createCanvas } from "@/workspaces/hierarchy";

export const DEMO_CANVAS_TITLE = "AI test canvas";
const PENDING_KEY = "acute:pending-demo-canvas";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Element = Mutable<ExcalidrawElement> & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Content

const t = (text: string, styles: Record<string, true> = {}) => ({ type: "text" as const, text, styles });
const h = (level: 1 | 2 | 3, text: string): ContentBlock => ({ type: "heading", props: { level }, content: text });
const p = (content: string | InlineContent[]): ContentBlock => ({ type: "paragraph", content });
const bullet = (text: string, children?: ContentBlock[]): ContentBlock => ({ type: "bulletListItem", content: text, ...(children ? { children } : {}) });
const numbered = (text: string): ContentBlock => ({ type: "numberedListItem", content: text });
const todo = (text: string, checked = false, children?: ContentBlock[]): ContentBlock => ({
  type: "checkListItem",
  props: { checked },
  content: text,
  ...(children ? { children } : {}),
});
const code = (language: string, text: string): ContentBlock => ({ type: "codeBlock", props: { language }, content: text });
const table = (rows: string[][]): ContentBlock => ({
  type: "table",
  content: { type: "tableContent", headerRows: 1, rows: rows.map((r) => ({ cells: r.map((c) => [t(c)]) })) },
});

const OVERVIEW: RichContent = [
  h(2, "Checkout revamp — overview"),
  p([
    t("Checkout drops "),
    t("4% of payments", { bold: true }),
    t(" when the payment gateway times out. We will add "),
    t("idempotent retries", { italic: true }),
    t(" and move order writes behind a queue. See the "),
    { type: "link", href: "https://example.com/checkout-rfc", content: [t("RFC")] },
    t("."),
  ]),
  bullet("Goal: cut failed payments below 0.5%"),
  bullet("Scope: web checkout and the Checkout API", [bullet("Mobile apps follow in Q3")]),
  bullet("Non-goal: changing payment providers"),
  numbered("Ship retries behind a feature flag"),
  numbered("Roll out to 10%, then 100%"),
];

const TASKS: RichContent = [
  h(3, "Launch checklist"),
  todo("Write the retry RFC", true),
  todo("Add idempotency keys to /payments", false, [todo("Store keys for 24 hours"), todo("Reject reused keys with 409")]),
  todo("Load-test the gateway at 3× peak"),
  todo("Update the on-call runbook"),
];

const ENDPOINTS: RichContent = [
  table([
    ["Endpoint", "Method", "Owner", "p95 latency"],
    ["/cart", "GET", "Web team", "120 ms"],
    ["/checkout", "POST", "Payments", "480 ms"],
    ["/payments/:id", "GET", "Payments", "90 ms"],
    ["/orders", "POST", "Orders", "210 ms"],
  ]),
];

const RETRY_CODE: RichContent = [
  code(
    "typescript",
    [
      "export async function chargeWithRetry(order: Order, attempts = 3): Promise<Charge> {",
      "  const key = `charge:${order.id}`; // idempotency key",
      "  for (let i = 1; i <= attempts; i++) {",
      "    try {",
      "      return await gateway.charge(order.total, { idempotencyKey: key });",
      "    } catch (err) {",
      "      if (!isRetryable(err) || i === attempts) throw err;",
      "      await sleep(2 ** i * 100); // exponential backoff",
      "    }",
      "  }",
      '  throw new Error("unreachable");',
      "}",
    ].join("\n"),
  ),
];

const OPEN_QUESTION: RichContent = [p("Open question: should retries be keyed by order id or by payment attempt?")];

const OFFSITE: RichContent = [
  h(3, "Team offsite"),
  p("Friday lunch at the harbour, then a planning session."),
  bullet("Book the room"),
  bullet("Collect dietary requirements"),
];

const DESIGN_DOC: RichContent = [
  p("How the Checkout API retries gateway calls without charging a customer twice."),
  h(2, "Context"),
  { type: "quote", content: "Customers were charged twice during the March gateway incident." },
  p([t("Retries must be "), t("safe to repeat", { bold: true }), t(": every charge carries an idempotency key derived from the order.")]),
  { type: "divider" },
  h(2, "Proposal"),
  numbered("Derive the idempotency key from the order id"),
  numbered("Retry only timeouts and 5xx responses, with exponential backoff"),
  numbered("Write the order through a queue so a slow database never blocks checkout"),
  { type: "toggleListItem", content: "Alternatives considered", children: [p("Client-side retries — rejected: the browser can't guarantee idempotency.")] },
  h(2, "Rollout"),
  todo("Feature flag per region"),
  todo("Dashboard for retry rate and double-charge alerts"),
  h(2, "Error budget"),
  table([
    ["Metric", "Today", "Target"],
    ["Failed payments", "4%", "< 0.5%"],
    ["Double charges", "12 / month", "0"],
  ]),
  code("sql", "SELECT count(*) FROM charges\nGROUP BY idempotency_key\nHAVING count(*) > 1;"),
];

const POSTMORTEM: RichContent = [
  p("On 12 March the payment gateway timed out for 18 minutes; client retries charged 212 customers twice."),
  h(2, "Action items"),
  todo("Refund affected customers", true),
  todo("Add idempotency keys (see design doc)"),
];

/** Every block gets its own id (an id-less document would share BlockNote's default one). */
function withIds(blocks: RichContent): RichContent {
  return blocks.map((b) => ({ ...b, id: newBlockId(), ...(b.children ? { children: withIds(b.children) } : {}) }));
}

// ---------------------------------------------------------------------------
// Canvas creation + one-shot seeding

/** Creates the canvas and marks it for seeding when it opens. Returns its id. */
export async function requestDemoCanvas(workspaceId: string): Promise<string> {
  const canvas = await createCanvas(getPersistence(), workspaceId, DEMO_CANVAS_TITLE);
  try {
    sessionStorage.setItem(PENDING_KEY, canvas.id);
  } catch {
    // Without sessionStorage the canvas just opens empty.
  }
  return canvas.id;
}

/** Seeds the canvas if `requestDemoCanvas` created it (once). Returns whether it seeded. */
export async function seedPendingDemoCanvas(api: ExcalidrawImperativeAPI, home: DocumentHome): Promise<boolean> {
  try {
    if (sessionStorage.getItem(PENDING_KEY) !== home.canvasId) return false;
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return false;
  }
  await seedDemoCanvas(api, home);
  api.scrollToContent(undefined, { fitToContent: true });
  return true;
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Adds the demo content to the open canvas in one scene update (no undo step). */
export async function seedDemoCanvas(api: ExcalidrawImperativeAPI, home: DocumentHome): Promise<void> {
  // Native text is measured when created: load the hand-drawn font first so labels aren't clipped.
  await Promise.all(["16px Excalifont", "20px Excalifont", "28px Excalifont"].map((f) => document.fonts.load(f).catch(() => undefined)));
  const store = getDocumentStore();
  const now = Date.now();
  const writes: Promise<void>[] = [];
  const embeds: Element[] = [];

  const putDoc = (kind: "block" | "page", title: string, content: RichContent): string => {
    const id = newId(kind === "page" ? "page" : "doc");
    writes.push(
      store.put({ id, ...home, kind, title, snapshot: withIds(content), createdAt: now, updatedAt: now, metadata: { ai: { createdBy: "user" } } }),
    );
    return id;
  };

  const embed = (ref: AcuteEmbedRef, box: Omit<Box, "id">, frameless = false): Box => {
    const id = randomId();
    const link = ref.kind === "rich-block" ? blockLink(ref.documentId) : pageLink(ref.pageId);
    const style = frameless
      ? { strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0, roundness: null }
      : BLOCK_STYLE;
    embeds.push({ ...style, type: "embeddable", id, ...box, link, customData: { acute: ref } } as unknown as Element);
    return { id, ...box };
  };

  const block = (blockType: RichBlockType, title: string, content: RichContent, box: Omit<Box, "id">): Box =>
    embed({ kind: "rich-block", blockType, documentId: putDoc("block", title, content), style: CARD_STYLE }, box);

  // Row 1: rich blocks.
  const overview = block("text", "Checkout revamp — overview", OVERVIEW, { x: 0, y: 0, width: 420, height: 380 });
  const tasks = block("todo", "Launch checklist", TASKS, { x: 480, y: 0, width: 380, height: 260 });
  block("table", "Endpoints", ENDPOINTS, { x: 920, y: 0, width: 520, height: 230 });
  const retryCode = block("code", "chargeWithRetry", RETRY_CODE, { x: 1500, y: 0, width: 620, height: 330 });
  // Unrelated, so "Find related" has something to leave out.
  block("text", "Team offsite", OFFSITE, { x: 1500, y: 500, width: 380, height: 220 });

  // Row 2: pages, a frameless text item, native text.
  const designPageId = putDoc("page", "Design doc: payment retries", DESIGN_DOC);
  const design = embed({ kind: "page-preview", pageId: designPageId, preview: true }, { x: 0, y: 500, ...PAGE_PREVIEW_SIZE.content });
  const postmortemPageId = putDoc("page", "Incident postmortem: double charges", POSTMORTEM);
  const postmortem = embed({ kind: "page-preview", pageId: postmortemPageId, preview: false }, { x: 520, y: 500, ...PAGE_PREVIEW_SIZE.card });
  embed(
    { kind: "rich-block", blockType: "text", documentId: putDoc("block", "Open question", OPEN_QUESTION), style: { ...TEXT_ITEM_STYLE, autoWidth: false } },
    { x: 520, y: 700, width: 360, height: 72 },
    true,
  );

  // Row 3: architecture diagram (native shapes with labels + arrows).
  const shape = (type: "rectangle" | "diamond" | "ellipse", label: string, x: number, y: number, backgroundColor: string) => ({
    type,
    id: randomId(),
    x,
    y,
    width: 200,
    height: 110,
    backgroundColor,
    fillStyle: "solid" as const,
    roughness: 1,
    label: { text: label },
  });
  const web = shape("rectangle", "Web client", 0, 1150, "#a5d8ff");
  const api_ = shape("rectangle", "Checkout API", 360, 1150, "#b2f2bb");
  const gateway = shape("diamond", "Payment gateway", 720, 1130, "#ffec99");
  const db = shape("ellipse", "Orders DB", 360, 1420, "#eebefa");

  const typed = (relation?: RelationType) => (relation ? { customData: { acuteRelation: relation } } : {});
  const shapeArrow = (from: typeof web, to: typeof web, relation?: RelationType, label?: string) => {
    const { start, end } = connectorEndpoints(from, to);
    return {
      type: "arrow" as const,
      id: randomId(),
      x: start.x,
      y: start.y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      points: [
        [0, 0],
        [end.x - start.x, end.y - start.y],
      ] as [number, number][],
      start: { id: from.id },
      end: { id: to.id },
      ...(label ? { label: { text: label, fontSize: 16 } } : {}),
      ...typed(relation),
    };
  };

  const skeletons = [
    web,
    api_,
    gateway,
    db,
    shapeArrow(web, api_, undefined, "HTTPS"),
    shapeArrow(api_, gateway, "depends_on"),
    shapeArrow(api_, db, undefined, "writes orders"),
    { type: "text" as const, id: randomId(), x: 1000, y: 520, text: "Sticky: ask finance how refunds are reported", fontSize: 20, strokeColor: "#e03131" },
    { type: "line" as const, id: randomId(), x: 0, y: 1080, points: [[0, 0], [2100, 0]] as [number, number][], strokeStyle: "dashed" as const, strokeColor: "#adb5bd" },
    { type: "text" as const, id: randomId(), x: 0, y: 1040, text: "Architecture", fontSize: 28 },
  ];
  const natives = convertToExcalidrawElements(skeletons as never, { regenerateIds: false }) as unknown as Element[];

  // Freehand "check" mark next to the checklist.
  natives.push(
    ...(restoreElements(
      [
        {
          type: "freedraw",
          id: randomId(),
          x: 880,
          y: 60,
          strokeColor: "#2f9e44",
          strokeWidth: 2,
          points: [[0, 20], [8, 30], [14, 36], [22, 24], [34, 8], [44, 0]],
          pressures: [],
          simulatePressure: true,
        } as unknown as ExcalidrawElement,
      ],
      null,
    ) as unknown as Element[]),
  );

  // Image: a generated diagram sketch.
  const fileId = randomId() as FileId;
  const file: BinaryFileData = { id: fileId, mimeType: "image/png", dataURL: sketchImage(), created: now, lastRetrieved: now };
  natives.push(
    ...(restoreElements(
      [{ type: "image", id: randomId(), x: 1100, y: 1150, width: 400, height: 260, fileId, status: "saved", scale: [1, 1] } as unknown as ExcalidrawElement],
      null,
    ) as unknown as Element[]),
  );

  // Arrows bound to blocks/pages (skeleton binding doesn't cover embeddables).
  const all = [...embeds, ...natives];
  const byId = new Map(all.map((el) => [el.id, el]));
  const apiBox = byId.get(api_.id)!;
  const boundArrows = [
    bindArrow(byId, retryCode, apiBox, "implements"),
    bindArrow(byId, design, overview, "references"),
    bindArrow(byId, postmortem, design, "caused_by"),
    bindArrow(byId, tasks, overview, "derived_from"),
  ];


  await Promise.all(writes);
  api.addFiles([file]);
  api.updateScene({
    elements: [
      ...api.getSceneElementsIncludingDeleted(),
      ...restoreElements([...embeds, ...natives, ...boundArrows] as unknown as ExcalidrawElement[], null, { refreshDimensions: true }),
    ],
    appState: { selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

/** A straight arrow from `from`'s right edge to `to`'s nearest side, bound at both ends, optionally typed. */
function bindArrow(byId: Map<string, Element>, from: Box, to: Box, relation?: RelationType): Element {
  const id = randomId();
  const { start, end } = connectorEndpoints(from, to);
  for (const target of [from.id, to.id]) {
    const el = byId.get(target);
    if (el) el.boundElements = [...(el.boundElements ?? []), { id, type: "arrow" }];
  }
  return {
    type: "arrow",
    id,
    x: start.x,
    y: start.y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: 2,
    roughness: 1,
    startArrowhead: null,
    endArrowhead: "arrow",
    startBinding: { elementId: from.id, focus: 0, gap: 8 },
    endBinding: { elementId: to.id, focus: 0, gap: 8 },
    ...(relation ? { customData: { acuteRelation: relation } } : {}),
  } as unknown as Element;
}

/** A small hand-drawn-looking architecture sketch as a PNG. */
function sketchImage(): DataURL {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 520;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff9db";
  ctx.fillRect(0, 0, 800, 520);
  ctx.strokeStyle = "#495057";
  ctx.lineWidth = 4;
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = "#343a40";
  const boxes: [number, number, string][] = [
    [60, 80, "Client"],
    [320, 80, "Queue"],
    [580, 80, "Worker"],
    [320, 330, "Orders DB"],
  ];
  for (const [x, y, label] of boxes) {
    ctx.strokeRect(x, y, 170, 100);
    ctx.fillText(label, x + 16, y + 60);
  }
  ctx.beginPath();
  ctx.moveTo(230, 130);
  ctx.lineTo(320, 130);
  ctx.moveTo(490, 130);
  ctx.lineTo(580, 130);
  ctx.moveTo(665, 180);
  ctx.lineTo(490, 380);
  ctx.stroke();
  ctx.font = "24px sans-serif";
  ctx.fillText("Proposed: orders written through a queue", 60, 480);
  return canvas.toDataURL("image/png") as DataURL;
}
