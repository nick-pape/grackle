import { useEffect, useRef } from "react";

/** Options for the {@link useHotkey} hook. */
export interface HotkeyOptions {
  /** The key to match against `KeyboardEvent.key` (e.g. `"n"`, `"Escape"`, `"?"`). */
  key: string;
  /** When true, requires `Ctrl` (Windows/Linux) or `Cmd` (Mac). */
  ctrl?: boolean;
  /** When true, requires the `Shift` modifier. */
  shift?: boolean;
  /**
   * When true (the default), the shortcut is suppressed while the user is
   * focused on an input, textarea, select, or contentEditable element.
   */
  suppressInInputs?: boolean;
  /** When false, the shortcut listener is inactive. Defaults to true. */
  enabled?: boolean;
}

/** Returns true if the currently focused element is a text-entry control. */
function isEditableElement(element: Element | undefined): boolean {
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if ((element as HTMLElement).isContentEditable) {
    return true;
  }
  return false;
}

/**
 * Registers a global keyboard shortcut on `document`.
 *
 * The callback is stored in a ref so the listener is registered only once per
 * mount/unmount cycle, regardless of callback identity changes.
 */
export function useHotkey(options: HotkeyOptions, callback: () => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const { key, ctrl = false, shift = false, suppressInInputs = true, enabled = true } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (suppressInInputs && isEditableElement(document.activeElement ?? undefined)) {
        return;
      }

      // Modifier checks: ctrl maps to Ctrl on Windows or Cmd on Mac.
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (ctrl !== ctrlOrMeta) {
        return;
      }
      // Only enforce shift when explicitly required. Characters like "?" inherently
      // need Shift to produce, so we must not reject them when shift is unset.
      if (shift && !e.shiftKey) {
        return;
      }

      if (e.key === key) {
        callbackRef.current();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [key, ctrl, shift, suppressInInputs, enabled]);
}
