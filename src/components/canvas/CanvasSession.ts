/**
 * Binds one Excalidraw instance to its local-first canvas state:
 *
 *   Excalidraw onChange ──(skip while pointer is down)──▶ SceneBinding diff
 *        │                                                   │ (throttled)
 *        │                                                   ▼
 *        │                                    canvas Y.Doc ──▶ DocumentProvider ──▶ IndexedDB
 *        ├─ new image files ──▶ AssetRepository (Blob, never in scene state)
 *        └─ viewport / theme ──▶ CanvasRepository / MetaRepository (debounced)
 *
 * Nothing here is awaited from Excalidraw's event path.
 */
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type * as Y from "yjs";
import type { CanvasDocument } from "@/domain/types";
import type { PersistenceServices } from "@/persistence";
import { canvasDocId } from "@/sync/docIds";
import { DocumentProvider } from "@/sync/DocumentProvider";
import { saveStatusStore } from "@/sync/saveStatus";
import { SceneBinding } from "@/sync/sceneBinding";

type SceneElement = OrderedExcalidrawElement;
type Theme = AppState["theme"];

const COMMIT_DELAY_MS = 120;
const VIEWPORT_SAVE_DELAY_MS = 600;
const THEME_KEY = "ui.theme";

export class CanvasSession {
  private readonly provider: DocumentProvider;
  private readonly binding: SceneBinding<SceneElement>;
  private readonly meta: Y.Map<unknown>;
  private api: ExcalidrawImperativeAPI | null = null;

  private latestElements: readonly SceneElement[] | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private viewportTimer: ReturnType<typeof setTimeout> | null = null;

  private lastViewport = { x: 0, y: 0, zoom: 1 };
  private lastBackground: string | null = null;
  private lastTheme: Theme | null = null;
  private lastFiles: BinaryFiles | null = null;
  private readonly persistedFileIds = new Set<string>();
  private readonly initialFileIds = new Set<string>();
  private filesRequested = false;

  private constructor(
    private canvas: CanvasDocument,
    private readonly services: PersistenceServices,
  ) {
    this.provider = new DocumentProvider(canvasDocId(canvas.id), services.yupdates, {
      onStateChange: (s) => saveStatusStore.set(s),
    });
    this.binding = new SceneBinding(this.provider.doc.getMap<SceneElement>("elements"));
    this.meta = this.provider.doc.getMap("meta");
  }

  static async open(canvas: CanvasDocument, services: PersistenceServices): Promise<CanvasSession> {
    const session = new CanvasSession(canvas, services);
    const [, theme] = await Promise.all([session.provider.load(), services.meta.get<Theme>(THEME_KEY)]);
    session.lastTheme = theme ?? "light";
    return session;
  }

  /** Scene + UI state for Excalidraw's `initialData`. Files load lazily. */
  getInitialData(): ExcalidrawInitialDataState {
    const elements = this.binding.readScene();
    for (const el of elements) {
      if (el.type === "image" && el.fileId && !el.isDeleted) this.initialFileIds.add(el.fileId);
    }
    const vp = this.canvas.viewport;
    if (vp) this.lastViewport = vp;
    const background = this.meta.get("viewBackgroundColor");
    this.lastBackground = typeof background === "string" ? background : null;
    return {
      elements,
      appState: {
        theme: this.lastTheme ?? "light",
        ...(this.lastBackground ? { viewBackgroundColor: this.lastBackground } : {}),
        ...(vp ? { scrollX: vp.x, scrollY: vp.y, zoom: { value: vp.zoom as never } } : {}),
      },
    };
  }

  get theme(): Theme {
    return this.lastTheme ?? "light";
  }

  /** Called when Excalidraw hands over its API (before its scene is initialised). */
  attach(api: ExcalidrawImperativeAPI): void {
    this.api = api;
  }

  /** Excalidraw `onChange` handler. Must stay cheap: it runs on pointer moves. */
  handleChange = (elements: readonly SceneElement[], appState: AppState, files: BinaryFiles): void => {
    // First onChange = scene initialised: load image binaries off the critical path.
    if (!this.filesRequested && this.api) {
      this.filesRequested = true;
      void this.loadFiles(this.api);
    }

    // Scene: defer while a gesture is in progress; commit once it ends.
    this.latestElements = elements;
    const interacting = appState.cursorButton === "down" || appState.multiElement !== null;
    if (!interacting && !this.commitTimer && this.binding.hasChanges(elements)) {
      this.commitTimer = setTimeout(this.commitScene, COMMIT_DELAY_MS);
    }

    if (appState.viewBackgroundColor !== this.lastBackground) {
      this.lastBackground = appState.viewBackgroundColor;
      this.provider.applyLocalChange(() => this.meta.set("viewBackgroundColor", appState.viewBackgroundColor));
    }

    if (appState.theme !== this.lastTheme) {
      this.lastTheme = appState.theme;
      void this.services.meta.set(THEME_KEY, appState.theme);
    }

    const vp = this.lastViewport;
    if (appState.scrollX !== vp.x || appState.scrollY !== vp.y || appState.zoom.value !== vp.zoom) {
      this.lastViewport = { x: appState.scrollX, y: appState.scrollY, zoom: appState.zoom.value };
      if (this.viewportTimer) clearTimeout(this.viewportTimer);
      this.viewportTimer = setTimeout(this.saveViewport, VIEWPORT_SAVE_DELAY_MS);
    }

    if (files !== this.lastFiles) {
      this.lastFiles = files;
      this.persistNewFiles(files);
    }
  };

  /** Synchronously commits pending scene changes and starts writing them. */
  flush(): Promise<void> {
    this.commitScene();
    if (this.viewportTimer) this.saveViewport();
    return this.provider.flush();
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.api = null;
    await this.provider.dispose();
  }

  private commitScene = (): void => {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    const elements = this.latestElements;
    if (!elements || !this.binding.hasChanges(elements)) return;
    this.provider.applyLocalChange(() => this.binding.commit(elements));
  };

  private saveViewport = (): void => {
    if (this.viewportTimer) {
      clearTimeout(this.viewportTimer);
      this.viewportTimer = null;
    }
    const viewport = this.lastViewport;
    this.canvas = { ...this.canvas, viewport };
    // Read-modify-write: the canvas may have been renamed, moved or deleted meanwhile.
    void this.services.canvases.get(this.canvas.id).then((current) => {
      if (current) return this.services.canvases.put({ ...current, viewport, updatedAt: Date.now() });
    }).catch((err: unknown) => console.error("[acute-notes] Failed to save the viewport", err));
  };

  private persistNewFiles(files: BinaryFiles): void {
    for (const file of Object.values(files)) {
      if (this.persistedFileIds.has(file.id)) continue;
      this.persistedFileIds.add(file.id);
      void this.persistFile(file).catch((err: unknown) => {
        this.persistedFileIds.delete(file.id);
        console.error("[acute-notes] Failed to store image", err);
      });
    }
  }

  private async persistFile(file: BinaryFileData): Promise<void> {
    if (await this.services.assets.has(file.id)) return;
    const blob = await (await fetch(file.dataURL)).blob();
    await this.services.assets.put({ id: file.id, blob, mimeType: file.mimeType, createdAt: file.created });
  }

  private async loadFiles(api: ExcalidrawImperativeAPI): Promise<void> {
    const loaded = await Promise.all(
      [...this.initialFileIds].map(async (id): Promise<BinaryFileData | null> => {
        const asset = await this.services.assets.get(id);
        if (!asset) return null;
        this.persistedFileIds.add(id);
        return {
          id: asset.id as BinaryFileData["id"],
          mimeType: asset.mimeType as BinaryFileData["mimeType"],
          dataURL: (await blobToDataURL(asset.blob)) as DataURL,
          created: asset.createdAt,
          lastRetrieved: Date.now(),
        };
      }),
    );
    const files = loaded.filter((f): f is BinaryFileData => f !== null);
    if (files.length && this.api === api) api.addFiles(files);
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
