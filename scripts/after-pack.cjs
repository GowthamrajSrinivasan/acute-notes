// electron-builder afterPack hook: copy the Next standalone server into the
// app's resources/server. Done by hand because `extraResources` silently drops
// `node_modules` and dot-folders (`.next`), both of which the server needs.
const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  if (!existsSync(path.join(src, "server.js"))) throw new Error("Run the desktop build first: .next/standalone is missing.");
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  cpSync(src, path.join(resources, "server"), { recursive: true });
  console.log(`  • copied standalone server -> ${path.join(resources, "server")}`);
};
