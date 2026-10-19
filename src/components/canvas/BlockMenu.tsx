"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CodeIcon, PageIcon, TableIcon, TodoIcon } from "@/components/common/icons";
import { compositeOutline, type CompositeShapeKind } from "@/domain/canvas/compositeShapes";

export type BlockMenuChoice = "page" | "todo" | "table" | "code" | CompositeShapeKind;

type Item = { id: BlockMenuChoice; label: string; icon: React.ReactNode };

const ITEMS: Item[] = [
  { id: "page", label: "Page", icon: <PageIcon size={16} /> },
  { id: "todo", label: "Todo", icon: <TodoIcon size={16} /> },
  { id: "table", label: "Table", icon: <TableIcon size={16} /> },
  { id: "code", label: "Code", icon: <CodeIcon size={16} /> },
];

/** A composite shape's icon: its own outline, drawn small, so the menu always shows what it inserts. */
function ShapeGlyph({ kind }: { kind: CompositeShapeKind }) {
  const [w, h, dx, dy] = [18, 14, 3, 5];
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" aria-hidden="true">
      {Object.entries(compositeOutline(kind, w, h)).map(([part, points]) => (
        <polyline key={part} points={points.map(([x, y]) => `${x + dx},${y + dy}`).join(" ")} />
      ))}
    </svg>
  );
}

/** Diagram shapes Excalidraw's own toolbar doesn't have (composite shapes), named by their usual meaning. */
const SHAPE_ITEMS: Item[] = (
  [
    ["cylinder", "Cylinder (database)"],
    ["hexagon", "Hexagon (preparation)"],
    ["parallelogram", "Parallelogram (input / output)"],
    ["trapezoid", "Trapezoid (manual step)"],
    ["document", "Document"],
    ["subroutine", "Predefined process"],
  ] as const
).map(([id, label]) => ({ id, label, icon: <ShapeGlyph kind={id} /> }));

interface BlockMenuProps {
  /** Viewport coordinates of the menu's top-centre. */
  position: { top: number; left: number };
  /** Pointer-downs inside this element (the toggle button) don't close the menu. */
  ignoreEl?: HTMLElement | null;
  onClose: () => void;
  onSelect: (choice: BlockMenuChoice) => void;
}

/** The intentionally tiny "Add block" menu (PRD §6.3). */
export function BlockMenu({ position, ignoreEl, onClose, onSelect }: BlockMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !ignoreEl?.contains(target)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [ignoreEl, onClose]);

  const renderItem = (item: Item) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        onSelect(item.id);
      }}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm text-[var(--acute-text)] hover:bg-[var(--acute-accent-soft)]"
    >
      <span className="text-[var(--acute-text-muted)]">{item.icon}</span>
      {item.label}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Add block"
      className="fixed z-50 w-48 -translate-x-1/2 rounded-[10px] border border-[var(--acute-border)] bg-[var(--acute-surface)] p-1.5 shadow-[var(--acute-shadow)]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="px-2 pb-1 pt-0.5 text-xs font-semibold text-[var(--acute-text-muted)]">Add block</div>
      {ITEMS.map(renderItem)}
      <div className="px-2 pb-1 pt-2 text-xs font-semibold text-[var(--acute-text-muted)]">Shapes</div>
      {SHAPE_ITEMS.map(renderItem)}
    </div>,
    document.body,
  );
}
