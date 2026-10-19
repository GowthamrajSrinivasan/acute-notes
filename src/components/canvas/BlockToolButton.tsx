"use client";

import { createPortal } from "react-dom";
import { BlockIcon } from "@/components/common/icons";
import { BlockMenu, type BlockMenuChoice } from "./BlockMenu";
import { useToolbarSlot } from "./toolbarSlot";

const ANCHOR_SELECTOR = '.App-toolbar label:has(> [data-testid="toolbar-image"])';

interface BlockToolButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (choice: BlockMenuChoice) => void;
}

/**
 * Injects the `🧩 Block` tool into Excalidraw's main toolbar, right after the
 * Image tool, using Excalidraw's own ToolIcon markup so it is visually native.
 */
export function BlockToolButton({ open, onOpenChange, onSelect }: BlockToolButtonProps) {
  const slot = useToolbarSlot(ANCHOR_SELECTOR);

  // The slot uses `display: contents`, so measure the rendered button itself.
  const rect = open ? slot.firstElementChild?.getBoundingClientRect() : undefined;
  const position = rect ? { top: rect.bottom + 8, left: rect.left + rect.width / 2 } : { top: 64, left: window.innerWidth / 2 };

  return createPortal(
    <>
      <label className="ToolIcon Shape" title="Block — B">
        <input
          className="ToolIcon_type_radio ToolIcon_size_medium"
          type="radio"
          name="acute-block-tool"
          aria-label="Block (opens Add block menu)"
          aria-keyshortcuts="B"
          data-testid="toolbar-acute-block"
          checked={open}
          onChange={() => onOpenChange(true)}
          onClick={() => open && onOpenChange(false)}
        />
        <div className="ToolIcon__icon">
          <BlockIcon size={16} />
          <span className="ToolIcon__keybinding">B</span>
        </div>
      </label>
      {open && (
        <BlockMenu position={position} ignoreEl={slot} onClose={() => onOpenChange(false)} onSelect={onSelect} />
      )}
    </>,
    slot,
  );
}
