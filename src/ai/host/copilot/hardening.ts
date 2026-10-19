/**
 * The one, unconditional hardened configuration every Copilot client/session
 * is built with (PRD §13.15.11): zero built-in tools, every permission
 * request denied, `mode: "empty"` (the SDK's own documented posture for
 * "multi-user server applications ... ambient behavior is unsafe"), and an
 * isolated empty directory — never the repo, the host's home directory, or
 * workspace files. `CopilotHostRuntime.ts` is the only caller; there is no
 * path to a Copilot session that skips this.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CopilotClientOptions, PermissionHandler, PermissionRequestResult, SessionConfig } from "@github/copilot-sdk";

const denyAllPermissions: PermissionHandler = (): PermissionRequestResult => ({
  kind: "reject",
  feedback: "Acute-Notes does not allow the AI to run tools.",
});

export interface Hardening {
  isolatedDirectory: string;
  clientOptions: Pick<CopilotClientOptions, "mode" | "baseDirectory" | "workingDirectory">;
  sessionConfig: Pick<SessionConfig, "availableTools" | "onPermissionRequest" | "workingDirectory">;
}

/** A fresh, empty, per-call directory outside the repo and the host's home directory. */
function createIsolatedDirectory(): string {
  return mkdtempSync(join(tmpdir(), "acute-ai-host-"));
}

export function buildHardening(): Hardening {
  const isolatedDirectory = createIsolatedDirectory();
  return {
    isolatedDirectory,
    clientOptions: {
      mode: "empty",
      baseDirectory: isolatedDirectory,
      workingDirectory: isolatedDirectory,
    },
    sessionConfig: {
      availableTools: [],
      onPermissionRequest: denyAllPermissions,
      workingDirectory: isolatedDirectory,
    },
  };
}
