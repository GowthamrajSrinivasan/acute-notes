"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreIcon } from "@/components/common/icons";

/**
 * Generic overflow ("⋮") menu: a trigger button plus a fixed-position panel
 * that flips above when clipped and closes on outside pointerdown/Escape/
 * resize. Originally built for the navigator's per-row menus; the app-level
 * `⋮` menu (`TopHeader.tsx`) is a second real caller, so it lives here
 * instead of Navigator.tsx.
 */
export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  /** A non-interactive group label. */
  heading?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
}

export interface OpenMenu {
  id: string;
  label: string;
  items: MenuItem[];
  anchor: DOMRect;
}

export function MenuButton({
  label,
  open,
  onOpen,
  className,
}: {
  label: string;
  open: boolean;
  onOpen: (button: HTMLElement) => void;
  className: string;
}) {
  return (
    <button
      type="button"
      className={className}
      title="More"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      data-acute-menu-anchor=""
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <MoreIcon size={14} />
    </button>
  );
}

const MENU_WIDTH = 220;

/** Fixed-position so a scrolling ancestor never clips it. */
export function RowMenu({ menu, onClose }: { menu: OpenMenu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(menu.anchor.bottom + 4);
  const left = Math.max(8, Math.min(menu.anchor.left, window.innerWidth - MENU_WIDTH - 8));

  // Flip above the button when there is no room below.
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const below = menu.anchor.bottom + 4;
    setTop(below + height > window.innerHeight - 8 ? Math.max(8, menu.anchor.top - height - 4) : below);
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      // The anchor buttons toggle the menu themselves.
      if (!ref.current?.contains(target) && !target.closest?.("[data-acute-menu-anchor]")) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" aria-label={menu.label} className="acute-menu acute-menu--fixed" style={{ top, left, minWidth: MENU_WIDTH }}>
      {menu.items.map((item, i) => (
        <div key={`${i}-${item.label}`}>
          {item.separatorBefore && <div className="acute-menu__sep" role="separator" />}
          {item.heading ? (
            <div className="acute-menu__label">{item.label}</div>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect?.();
              }}
            >
              <span className="truncate">{item.label}</span>
              {item.hint && <span className="acute-menu__hint">{item.hint}</span>}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
