import type { JSX } from "react";
import { useHotkey } from "../../hooks/useHotkey.js";
import { useAppNavigate } from "../../utils/navigation.js";

/** Keyboard shortcut reference page URL. */
const SHORTCUTS_URL: string = "/settings/shortcuts";

/** New task form URL. */
const NEW_TASK_URL: string = "/tasks/new";

/**
 * Registers global keyboard shortcuts that work from any page.
 * Rendered once inside the app shell.
 */
export function GlobalShortcuts(): JSX.Element {
  const navigate = useAppNavigate();

  useHotkey({ key: "?" }, () => {
    navigate(SHORTCUTS_URL);
  });

  useHotkey({ key: "n" }, () => {
    navigate(NEW_TASK_URL);
  });

  // Also match uppercase N (CapsLock or Shift held without shift option).
  useHotkey({ key: "N" }, () => {
    navigate(NEW_TASK_URL);
  });

  return <></>;
}
