/**
 * Image picking without the File System Access read path.
 *
 * Excalidraw opens images through `browser-fs-access`, which uses Chrome's
 * `showOpenFilePicker` when present. `FileSystemFileHandle.getFile()` then
 * fails with `NotAllowedError` for files the browser won't expose that way
 * (OneDrive / cloud-synced placeholders, policy-protected folders), while the
 * classic `<input type="file">` reads the same files fine.
 *
 * We replace `showOpenFilePicker` with an API-compatible shim backed by an
 * `<input type="file">`: its handles return the picked `File` directly. This
 * works regardless of module load order (browser-fs-access detects the API
 * once, at import time), so it is safe under HMR too. Acute-Notes does not use
 * the API's write-back features (scene save/load are disabled).
 */

interface PickerAcceptType {
  description?: string;
  accept?: Record<string, string | string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: PickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface ShimFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  isSameEntry(other: unknown): Promise<boolean>;
}

function acceptAttribute(types: PickerAcceptType[] | undefined): string {
  const parts = new Set<string>();
  for (const t of types ?? []) {
    for (const [mime, exts] of Object.entries(t.accept ?? {})) {
      parts.add(mime);
      for (const ext of Array.isArray(exts) ? exts : [exts]) if (ext) parts.add(ext);
    }
  }
  return [...parts].join(",");
}

function abortError(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

export function showOpenFilePickerViaInput(options: OpenFilePickerOptions = {}): Promise<ShimFileHandle[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!options.multiple;
    const accept = acceptAttribute(options.types);
    if (accept) input.accept = accept;
    input.style.display = "none";

    const cleanup = () => input.remove();
    input.addEventListener(
      "change",
      () => {
        const files = [...(input.files ?? [])];
        cleanup();
        if (!files.length) return reject(abortError());
        resolve(
          files.map((file) => ({
            kind: "file" as const,
            name: file.name,
            getFile: async () => file,
            isSameEntry: async (other: unknown) => other === file,
          })),
        );
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        cleanup();
        reject(abortError());
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

// Install wherever the File System Access API exists (or existed: an earlier
// build removed the property, which HMR can leave behind).
if (typeof window !== "undefined" && ("showOpenFilePicker" in window || "FileSystemFileHandle" in window)) {
  (window as unknown as { showOpenFilePicker: typeof showOpenFilePickerViaInput }).showOpenFilePicker =
    showOpenFilePickerViaInput;
}

export {};
