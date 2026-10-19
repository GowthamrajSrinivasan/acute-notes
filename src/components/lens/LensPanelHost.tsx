"use client";

/**
 * Portals `LensPanel` into the slot AppShell renders next to the canvas (`#acute-lens-slot`), the same way
 * `ObjectSection` portals into Excalidraw's own panel: `LensPanel` needs the live `api` (only available inside the
 * canvas tree), but must render as AppShell's flex sibling of `<main>`, not as a floating overlay on top of it.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getFrameLens } from "@/domain/canvas/diagram";
import type { DocumentHome } from "@/domain/types";
import { lensRootFrames, singleScene } from "@/domain/lens/lensView";
import { TRACE_KINDS } from "@/domain/lens/trace";
import { lensPanel, useLensPanel } from "@/state/lensPanel";
import { lensRoots } from "@/state/lensRoots";
import { flashStore } from "@/components/canvas/flashStore";
import { revealElement } from "@/components/canvas/pagePreviews";
import { clearLensHash, readLensHash } from "./lensHash";
import { LENS_SLOT_ID } from "./lensSlot";
import { clearReveal, pendingReveal } from "./lensReveal";
import { LensPanel } from "./LensPanel";
import { registerLensFocusHost } from "@/mcp/tools/lensFocus";

export function LensPanelHost({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const { root } = useLensPanel();
  // Lazy, not an effect: this component only mounts once the canvas (and AppShell's slot div) already exist.
  const [slot] = useState<Element | null>(() => document.getElementById(LENS_SLOT_ID));

  // Restores a shared deep link once, on load: `#lens=<key>` resolved against this (the open) canvas's frames.
  // `home` is a prop, not `getCanvasCommands()`: that registry is filled by a *parent* effect, which always commits
  // after this (child) component's own effects, so it would still read null here. The scene itself can still be
  // empty at this first commit (local persistence hasn't hydrated yet), so this waits for the first non-empty
  // `onChange` rather than only checking once, synchronously.
  useLayoutEffect(() => {
    if (lensPanel.get().root) return;
    const parsed = readLensHash();
    if (!parsed) return;
    let done = false;
    const tryRestore = () => {
      if (done) return;
      const elements = api.getSceneElements() as unknown as readonly SceneElement[];
      if (!elements.length) return; // not loaded yet; the next onChange retries
      done = true;
      off();
      const frame = elements.find((el) => el.type === "frame" && !el.isDeleted && (getFrameLens(el)?.lensKey === parsed.lens || el.id === parsed.lens));
      if (!frame) return;
      // A shared route: its ends are labelled with their keys until the workspace loads (the Trace card then names them).
      const end = (e: { canvasId: string; key: string } | null) => (e ? { ...e, label: e.key } : null);
      const kind = TRACE_KINDS.find((k) => k === parsed.trace?.kind) ?? "any";
      lensPanel.open(
        { canvasId: home.canvasId, frameId: frame.id },
        { path: parsed.path, nodeKey: parsed.node, ...(parsed.trace ? { trace: { from: end(parsed.trace.from), to: end(parsed.trace.to), kind } } : {}) },
      );
    };
    const off = api.onChange(tryRestore);
    tryRestore();
    return () => {
      done = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Back to canvas" from a Lens level on this canvas, asked for before navigating here (`lensReveal.ts`): select,
  // scroll to and flash the element once the scene has loaded, as `CanvasCommands.revealNode` does.
  useLayoutEffect(() => {
    const elementId = pendingReveal(home.canvasId);
    if (!elementId) return;
    let done = false;
    const tryReveal = () => {
      if (done) return;
      const el = api.getSceneElements().find((e) => e.id === elementId);
      if (!el) return; // not loaded yet; the next onChange retries
      done = true;
      off();
      clearReveal();
      revealElement(api, el);
      flashStore.flash(elementId);
    };
    const off = api.onChange(tryReveal);
    tryReveal();
    return () => {
      done = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Navigator's "Lens" rows: this canvas's root frames, republished (only when they change) as the scene does.
  useLayoutEffect(() => {
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const publish = () => {
      frame = 0;
      const elements = api.getSceneElements() as unknown as readonly SceneElement[];
      lensRoots.set(home.canvasId, lensRootFrames(singleScene(home.canvasId, elements), home.canvasId));
    };
    publish();
    const off = api.onChange((elements) => {
      if (elements === lastElements) return;
      lastElements = elements;
      if (!frame) frame = requestAnimationFrame(publish);
    });
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
      lensRoots.clear(home.canvasId);
    };
  }, [api, home.canvasId]);

  // MCP's `focus_lens` (plan §7.1, tab-only): opens Lens here at the level the tool resolved, selects the node and
  // highlights the keys it was given. UI only — the scene isn't touched.
  useLayoutEffect(
    () =>
      registerLensFocusHost({
        workspaceId: home.workspaceId,
        canvasId: home.canvasId,
        focus: (req) => lensPanel.open(req.root, { path: req.path, nodeKey: req.nodeKey, highlight: req.highlight }),
      }),
    [home.workspaceId, home.canvasId],
  );

  // Closing Lens drops the deep link, so a reload doesn't reopen it. Only on a close: at first mount `root` is null
  // while the restore above is still waiting for the scene. (Here, not in `LensPanel`, which unmounts on close.)
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (root) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      clearLensHash();
    }
  }, [root]);

  if (!root || !slot) return null;
  return createPortal(<LensPanel api={api} home={home} />, slot);
}
