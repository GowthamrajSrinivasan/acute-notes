import { afterEach, describe, expect, it, vi } from "vitest";
import { saveNow, type Savers } from "./saveAfterAccept";

/** Savers whose writes finish only when `finish()` is called; `log` records the order things happened in. */
function controlled(log: string[]) {
  const done: (() => void)[] = [];
  const write = (name: string) => () => {
    log.push(`start ${name}`);
    return new Promise<void>((resolve) => done.push(() => (log.push(`saved ${name}`), resolve())));
  };
  const savers: Savers = { canvas: write("canvas"), documents: write("documents"), open: write("open") };
  return { savers, finish: () => done.splice(0).forEach((f) => f()) };
}

afterEach(() => vi.restoreAllMocks());

describe("saving what an Accept wrote (#34)", () => {
  it("starts every store's write before it returns — in the Accept's own task, ahead of the content version", () => {
    const log: string[] = [];
    const { savers } = controlled(log);
    void saveNow(savers);
    log.push("content version recorded"); // what acceptPending does next, in the same task
    expect(log).toEqual(["start canvas", "start documents", "start open", "content version recorded"]);
  });

  it("resolves only once every store is saved", async () => {
    const log: string[] = [];
    const { savers, finish } = controlled(log);
    let settled = false;
    const saved = saveNow(savers).then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    finish();
    await saved;
    expect(log).toEqual(["start canvas", "start documents", "start open", "saved canvas", "saved documents", "saved open"]);
  });

  it("a store that fails (or throws) doesn't stop the others, and the save still settles", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saved: string[] = [];
    await saveNow({
      canvas: () => {
        throw new Error("no canvas");
      },
      documents: () => Promise.reject(new Error("disk full")),
      open: async () => void saved.push("open"),
    });
    expect(saved).toEqual(["open"]);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("no canvas open: the other stores are still saved", async () => {
    const saved: string[] = [];
    await saveNow({ canvas: () => null, documents: async () => void saved.push("documents"), open: async () => void saved.push("open") });
    expect(saved).toEqual(["documents", "open"]);
  });
});
