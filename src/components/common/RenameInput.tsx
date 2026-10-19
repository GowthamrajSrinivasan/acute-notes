"use client";

import { useRef } from "react";

interface RenameInputProps {
  value: string;
  /** Accessible name, e.g. "Canvas name". */
  label: string;
  className?: string;
  /** The new name (trimmed), or null when renaming was cancelled. */
  onDone: (value: string | null) => void;
}

/**
 * Inline rename used everywhere a workspace, canvas or page name is shown:
 * Enter or blur commits, Escape cancels. Pointer events stay in the input so
 * a host (e.g. the canvas) never starts a drag or selection from it.
 */
export function RenameInput({ value, label, className = "acute-page-row__rename", onDone }: RenameInputProps) {
  const cancelled = useRef(false);
  return (
    <input
      autoFocus
      className={className}
      aria-label={label}
      defaultValue={value}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(cancelled.current ? null : e.currentTarget.value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
