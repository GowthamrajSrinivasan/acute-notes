import { afterEach, describe, expect, it, vi } from "vitest";
import { aiMarkers, TIMED_MARKER_MS } from "./aiMarkersStore";

describe("aiMarkers", () => {
  afterEach(() => {
    aiMarkers.clearAll();
    vi.useRealTimers();
  });

  it("marks a change set's objects per canvas, and clears them after a few seconds by default", () => {
    vi.useFakeTimers();
    aiMarkers.mark("c1", ["a", "b"]);
    expect([...aiMarkers.get("c1")]).toEqual(["a", "b"]);
    expect(aiMarkers.get("c2").size).toBe(0);
    vi.advanceTimersByTime(TIMED_MARKER_MS - 1);
    expect(aiMarkers.get("c1").size).toBe(2);
    vi.advanceTimersByTime(1);
    expect(aiMarkers.get("c1").size).toBe(0);
  });

  it("dismisses one marker (a clicked dot), leaving the rest, and notifies subscribers only on a change", () => {
    const listener = vi.fn();
    const off = aiMarkers.subscribe(listener);
    aiMarkers.mark("c1", ["a", "b"]);
    aiMarkers.dismiss("c1", ["a"]);
    aiMarkers.dismiss("c1", ["missing"]);
    expect([...aiMarkers.get("c1")]).toEqual(["b"]);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it("a later set's markers outlive an earlier set's timer only for their own objects", () => {
    vi.useFakeTimers();
    aiMarkers.mark("c1", ["a"]);
    vi.advanceTimersByTime(TIMED_MARKER_MS / 2);
    aiMarkers.mark("c1", ["b"]);
    vi.advanceTimersByTime(TIMED_MARKER_MS / 2);
    expect([...aiMarkers.get("c1")]).toEqual(["b"]);
  });
});
