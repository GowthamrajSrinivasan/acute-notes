/**
 * Renderer-side persistence backend for the desktop app: every repository call becomes one validated request over
 * the storage IPC (electron/storage/), where SQLite and the asset files live. The shape of the API is the shared
 * contract in electron/storage/contract.json, so this file cannot offer a method the main process does not allow.
 *
 * The only translation is images: `StoredAsset.blob` (a `Blob`) crosses the boundary as plain bytes.
 */
import contract from "../../../electron/storage/contract.json";
import type { PersistenceServices, StoredAsset } from "./types";

export interface StorageErrorInfo {
  name?: string;
  code?: string;
  message: string;
}

export type StorageResponse = { ok: true; value: unknown } | { ok: false; error: StorageErrorInfo };

/** One request to the main process (`window.acuteDesktop.storage.invoke` in the app; a test double in tests). */
export type StorageInvoke = (service: string, method: string, args: unknown[]) => Promise<StorageResponse>;

/** An error thrown by the main process, with its `code` preserved (e.g. "DB_TOO_NEW", "BAD_REQUEST"). */
export class StorageIpcError extends Error {
  readonly code?: string;
  constructor(info: StorageErrorInfo) {
    super(info.message);
    this.name = info.name ?? "StorageError";
    this.code = info.code;
  }
}

/** `{ service: [method, …] }` straight from the contract (without its `_doc` note). */
export const STORAGE_METHODS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(contract)
    .filter(([key]) => !key.startsWith("_"))
    .map(([service, methods]) => [service, Object.keys(methods as Record<string, unknown>)]),
);

/** Asset as it crosses the boundary. */
interface WireAsset {
  id: string;
  data: Uint8Array;
  mimeType: string;
  createdAt: number;
}

export function createIpcServices(invoke: StorageInvoke): PersistenceServices {
  const call = async (service: string, method: string, args: unknown[]): Promise<unknown> => {
    // Drop trailing `undefined`s (optional arguments) so the request is minimal.
    while (args.length && args[args.length - 1] === undefined) args = args.slice(0, -1);
    const response = await invoke(service, method, args);
    if (!response.ok) throw new StorageIpcError(response.error);
    return response.value;
  };

  const services: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const [service, methods] of Object.entries(STORAGE_METHODS)) {
    const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    for (const method of methods) api[method] = (...args) => call(service, method, args);
    services[service] = api;
  }

  services.assets = {
    async put(asset) {
      const { id, blob, mimeType, createdAt } = asset as StoredAsset;
      const wire: WireAsset = { id, data: new Uint8Array(await blob.arrayBuffer()), mimeType, createdAt };
      await call("assets", "put", [wire]);
    },
    async get(id) {
      const wire = (await call("assets", "get", [id])) as WireAsset | null;
      return wire ? ({ id: wire.id, blob: new Blob([wire.data as BlobPart], { type: wire.mimeType }), mimeType: wire.mimeType, createdAt: wire.createdAt } satisfies StoredAsset) : null;
    },
    has: (id) => call("assets", "has", [id]),
  };

  return services as unknown as PersistenceServices;
}

/** The desktop storage bridge exposed by electron/preload.cjs, if this page is running inside the desktop app. */
export function desktopStorageInvoke(): StorageInvoke | null {
  const storage = typeof window === "undefined" ? undefined : window.acuteDesktop?.storage;
  return storage ? (service, method, args) => storage.invoke(service, method, args) : null;
}
