/**
 * Canvas shortcut registry (F15): every shortcut Acute adds, in one place,
 * behind one capture-phase listener with a shared typing guard.
 *
 * Excalidraw natively owns: V selection, H hand, R rectangle, D diamond,
 * O ellipse, A arrow, L line, P draw, T text (taken over as Acute text),
 * Delete/Backspace, Mod+Z undo, Mod+Shift+Z redo, Mod+D duplicate. Those are
 * not redefined here. Text-formatting shortcuts live with the text tools
 * (`textParity.ts`) because they depend on the selected text item.
 */

/** "Mod" is ⌘ on macOS and Ctrl elsewhere. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function modKey(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** True when keyboard input is going into a text field or rich editor. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

export type ShortcutScope =
  /** Nothing is being typed and no other surface (page panel, dialog, menu) has focus. */
  | "canvas"
  /** Anywhere except while typing (e.g. Find, Export). */
  | "not-typing";

export interface Shortcut {
  id: string;
  /** Human-readable keys for help/tooltips, e.g. "Mod+Shift+E". */
  keys: string;
  scope: ShortcutScope;
  matches(e: KeyboardEvent): boolean;
  /** Return false to let the event continue (not handled). */
  run(e: KeyboardEvent): boolean | void;
}

/**
 * Canvas shortcuts work unless focus is in another surface that owns its keys
 * (the page panel, a dialog or menu). Focus left on a header or sidebar button
 * still counts as "on the canvas".
 */
function focusOnCanvas(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  // (Excalidraw's own popovers, e.g. the colour picker, are part of the canvas.)
  return !active.closest('[data-acute-page-panel], .acute-dialog, [role="menu"]');
}

/** Plain key (no modifiers), case-insensitive for letters. */
export function plainKey(key: string): (e: KeyboardEvent) => boolean {
  return (e) => !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === key.toLowerCase();
}

/** Installs the shortcuts; returns the uninstaller. */
export function installShortcuts(shortcuts: readonly Shortcut[]): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const typing = isTypingTarget(e.target);
    for (const s of shortcuts) {
      if (typing) continue;
      if (s.scope === "canvas" && !focusOnCanvas()) continue;
      if (!s.matches(e)) continue;
      if (s.run(e) === false) continue;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  return () => document.removeEventListener("keydown", onKeyDown, true);
}
