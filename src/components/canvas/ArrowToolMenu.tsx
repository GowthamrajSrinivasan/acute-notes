"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUiPref, type ArrowTool } from "@/state/uiPrefs";
import { chooseArrowTool } from "./architectureArrows";
import { useToolbarSlot } from "./toolbarSlot";

const ANCHOR_SELECTOR = '.App-toolbar label:has(> [data-testid="toolbar-arrow"])';

const MODES: { value: ArrowTool; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    value: "excalidraw",
    label: "Arrow",
    hint: "Excalidraw's arrow: straight, or curved from the properties panel",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20 C 8 8, 14 6, 20 4" />
        <path d="M14 4h6v6" />
      </svg>
    ),
  },
  {
    value: "architecture",
    label: "Architecture arrow",
    hint: "Right-angle connector, routed around objects (as in AI diagrams)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20v-8h12V6" />
        <path d="M12 9l4-4 4 4" />
      </svg>
    ),
  },
];

/**
 * A ▾ next to Excalidraw's arrow tool: choose what the arrow tool draws
 * (see `architectureArrows.ts`). Picking a mode also picks the arrow tool.
 */
export function ArrowToolMenu({ api }: { api: ExcalidrawImperativeAPI }) {
  const slot = useToolbarSlot(ANCHOR_SELECTOR);
  const mode = useUiPref("arrowTool");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !slot.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, slot]);

  const rect = open ? slot.firstElementChild?.getBoundingClientRect() : undefined;
  const current = MODES.find((m) => m.value === mode) ?? MODES[0]!;

  return createPortal(
    <>
      <button
        type="button"
        className="acute-arrow-mode"
        data-mode={mode}
        aria-label={`Arrow type: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Arrow type: ${current.label}`}
        data-testid="toolbar-acute-arrow-mode"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Arrow type"
            className="acute-arrow-mode__menu"
            style={{ top: rect.bottom + 8, left: rect.left + rect.width / 2 }}
          >
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="menuitemradio"
                aria-checked={mode === m.value}
                className="acute-arrow-mode__item"
                onClick={() => {
                  setOpen(false);
                  chooseArrowTool(api, m.value);
                }}
              >
                <span className="acute-arrow-mode__icon">{m.icon}</span>
                <span>
                  <span className="acute-arrow-mode__label">{m.label}</span>
                  <span className="acute-arrow-mode__hint">{m.hint}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>,
    slot,
  );
}
