import { existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PermissionRequest } from "@github/copilot-sdk";
import { buildHardening } from "./hardening";

const createdDirectories: string[] = [];

afterEach(() => {
  while (createdDirectories.length) {
    const dir = createdDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function build() {
  const hardening = buildHardening();
  createdDirectories.push(hardening.isolatedDirectory);
  return hardening;
}

describe("buildHardening", () => {
  it("exposes zero built-in tools via an allow-list, never a deny-list", () => {
    expect(build().sessionConfig.availableTools).toEqual([]);
  });

  it("denies every permission request regardless of kind", () => {
    const { sessionConfig } = build();
    const handler = sessionConfig.onPermissionRequest;
    expect(handler).toBeTypeOf("function");

    const kinds: PermissionRequest["kind"][] = ["shell", "write", "read", "mcp", "custom-tool", "url", "memory", "hook"];
    for (const kind of kinds) {
      const request = { kind } as PermissionRequest;
      const result = handler!(request, { toolCallId: "t1" } as never);
      expect(result).toMatchObject({ kind: "reject" });
    }
  });

  it("uses mode: empty — the SDK's own documented posture for multi-user server apps", () => {
    expect(build().clientOptions.mode).toBe("empty");
  });

  it("isolates the session outside the repo, in a fresh OS scratch directory", () => {
    const { isolatedDirectory, clientOptions, sessionConfig } = build();
    const repoRoot = resolve(__dirname, "../../../..");

    // The OS temp dir is the right isolation primitive even though, on
    // Windows, it happens to live under the user profile (%LOCALAPPDATA%) —
    // what actually matters is that this is never the repo root, never the
    // home directory itself, and never a workspace-content path.
    expect(existsSync(isolatedDirectory)).toBe(true);
    expect(isolatedDirectory.startsWith(resolve(tmpdir()))).toBe(true);
    expect(isolatedDirectory).not.toBe(repoRoot);
    expect(isolatedDirectory.startsWith(repoRoot)).toBe(false);
    expect(isolatedDirectory).not.toBe(resolve(homedir()));

    expect(clientOptions.baseDirectory).toBe(isolatedDirectory);
    expect(clientOptions.workingDirectory).toBe(isolatedDirectory);
    expect(sessionConfig.workingDirectory).toBe(isolatedDirectory);
  });

  it("gives every call its own fresh directory", () => {
    const a = build();
    const b = build();
    expect(a.isolatedDirectory).not.toBe(b.isolatedDirectory);
  });
});
