// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_SOURCES_WARNING, WorkspaceExportDialog, workspaceSourcesHint } from "./WorkspaceTransfer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const checkbox = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const status = () => host.querySelector('[role="status"]');

async function open(measureSources: () => Promise<{ count: number; bytes: number }>) {
  const onExport = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    root.render(createElement(WorkspaceExportDialog, { workspaceName: "Research", measureSources, onExport, onClose }));
  });
  return { onExport, onClose };
}

describe("workspaceSourcesHint", () => {
  it("adds the count and size once known, or says there are none", () => {
    expect(workspaceSourcesHint(null)).toMatch(/citations can be checked\.$/);
    expect(workspaceSourcesHint({ count: 0, bytes: 0 })).toContain("This workspace has no sources on this device.");
    expect(workspaceSourcesHint({ count: 1, bytes: 300 })).toContain("1 source, 300 B.");
    expect(workspaceSourcesHint({ count: 3, bytes: 1_500_000 })).toContain("3 sources, 1.4 MB.");
  });
});

describe("WorkspaceExportDialog", () => {
  it("includes sources by default, shows their size, and exports with them", async () => {
    const { onExport } = await open(() => Promise.resolve({ count: 2, bytes: 12 * 1024 }));
    expect(host.querySelector("h2")!.textContent).toBe("Export workspace");
    expect(checkbox().checked).toBe(true);
    expect(host.textContent).toContain("Include sources");
    expect(host.textContent).toContain("2 sources, 12 KB.");
    expect(status()).toBeNull();
    act(() => button("Export")!.click());
    expect(onExport).toHaveBeenCalledWith(true);
  });

  it("warns when sources are left out, and still exports", async () => {
    const { onExport } = await open(() => Promise.resolve({ count: 0, bytes: 0 }));
    expect(host.textContent).toContain("no sources on this device");
    act(() => checkbox().click());
    expect(checkbox().checked).toBe(false);
    expect(status()!.textContent).toBe(NO_SOURCES_WARNING);
    expect(NO_SOURCES_WARNING).toBe("This file won't include the original sources. Citations in it can't be checked.");
    expect(button("Export")!.disabled).toBe(false);
    act(() => button("Export")!.click());
    expect(onExport).toHaveBeenCalledWith(false);
    act(() => checkbox().click());
    expect(status()).toBeNull();
  });

  it("keeps the plain hint when measuring fails; Cancel, Close and Escape close it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onClose, onExport } = await open(() => Promise.reject(new Error("no store")));
    expect(host.textContent).toMatch(/citations can be checked\.(?!\s*\d)/);
    expect(warn).toHaveBeenCalled();
    act(() => button("Cancel")!.click());
    act(() => button("Close")!.click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onExport).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
