// @vitest-environment happy-dom
/**
 * The block View preference with the "Cards" view (`.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md` step 2):
 * `cards` round-trips through the device's meta store while the build flag is on, and reads as Compact while it is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const meta = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/persistence", () => ({
  getPersistence: () => ({
    meta: {
      get: async (k: string) => meta.get(k),
      set: async (k: string, v: unknown) => void meta.set(k, structuredClone(v)),
    },
  }),
}));

/** A fresh copy of the module (its preferences are module state), loaded from the meta store. */
async function load() {
  vi.resetModules();
  const mod = await import("./uiPrefs");
  // Preferences load on the first subscription (`useUiPref`), as in the app: mount one subscriber, let the load settle.
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(() => (mod.useUiPref("blockDisplay"), null))));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  root.unmount();
  return mod;
}

beforeEach(() => {
  meta.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("blockDisplayOf", () => {
  it("keeps compact and editor; keeps cards only while Cards is available; anything else is compact", () => {
    expect(["compact", "editor", "cards", "bogus", undefined].map((v) => blockDisplayOfWith(v, true))).toEqual(["compact", "editor", "cards", "compact", "compact"]);
    expect(["compact", "editor", "cards"].map((v) => blockDisplayOfWith(v, false))).toEqual(["compact", "editor", "compact"]);
  });
});

let blockDisplayOfWith: (v: unknown, on: boolean) => string = () => "";
beforeEach(async () => {
  const { blockDisplayOf } = await import("./uiPrefs");
  blockDisplayOfWith = (v, on) => blockDisplayOf(v, on);
});

describe("the View preference (Cards)", () => {
  it("round-trips cards through the meta store with the flag on", async () => {
    vi.stubEnv("NEXT_PUBLIC_OPENUI_CANVAS", "on");
    const first = await load();
    first.setUiPref("blockDisplay", "cards");
    expect(first.getUiPref("blockDisplay")).toBe("cards");
    await new Promise((r) => setTimeout(r, 0));
    expect((meta.get("ui.prefs") as { blockDisplay: string }).blockDisplay).toBe("cards");

    const reloaded = await load();
    expect(reloaded.getUiPref("blockDisplay")).toBe("cards");
  });

  it("falls back to Compact when the flag is off: a stored cards reads as compact, and cards can't be set", async () => {
    meta.set("ui.prefs", { blockDisplay: "cards" });
    vi.stubEnv("NEXT_PUBLIC_OPENUI_CANVAS", "off");
    const mod = await load();
    expect(mod.getUiPref("blockDisplay")).toBe("compact");
    mod.setUiPref("blockDisplay", "editor");
    mod.setUiPref("blockDisplay", "cards");
    expect(mod.getUiPref("blockDisplay")).toBe("compact");
  });
});
