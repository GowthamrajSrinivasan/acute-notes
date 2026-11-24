// Types for scripts/desktop-models.mjs (read by its unit test, src/ai/router/desktopModels.test.ts).
export declare const DESKTOP_MODELS: Record<string, string>;
export declare const DEFAULT_DESKTOP_MODEL: string;
export declare const MODEL_FILES: readonly string[];
export declare const MODELS_FOLDER: string;
export declare const MANIFEST: string;
export declare function bundleModel(options: { key?: string; cacheDir: string; serverDir: string }): { missing: string[]; target?: string };
