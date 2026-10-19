import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: import.meta.dirname,
    resolveAlias: {
      // The Markdown parser (F28) runs in a Web Worker. This package's
      // "browser" build decodes HTML entities through `document`, which workers
      // don't have; its portable build (a lookup table) works everywhere.
      "decode-named-character-reference": "./node_modules/decode-named-character-reference/index.js",
    },
  },
  // Same alias for `next build --webpack` (the desktop build; the Turbopack
  // production build of the workspace page hangs on this machine).
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "decode-named-character-reference$": path.join(
        import.meta.dirname,
        "node_modules/decode-named-character-reference/index.js",
      ),
    };
    return config;
  },
  // The Copilot SDK resolves and spawns its bundled native CLI runtime (and
  // loads it via koffi) relative to its own package files — bundling it into
  // the AI host route handlers breaks that resolution, so load it with
  // native Node `require` instead.
  serverExternalPackages: ["@github/copilot-sdk", "koffi"],
  // Desktop (Electron) build: emit a self-contained server in .next/standalone.
  ...(process.env.ACUTE_DESKTOP
    ? {
        output: "standalone" as const,
        // The Copilot runtime lives in a per-platform optional package that the
        // file trace doesn't pick up; only the one installed on the build machine exists.
        outputFileTracingIncludes: { "/api/ai/*": ["./node_modules/@github/copilot-sdk-*/**/*"] },
      }
    : {}),
  // Lets a production build (e.g. for performance checks) run beside `next dev`.
  ...(process.env.ACUTE_DIST_DIR ? { distDir: process.env.ACUTE_DIST_DIR } : {}),
};

export default nextConfig;
