import type { JSX } from "react";
import { useHotkey } from "../../hooks/useHotkey.js";
import { SETTINGS_SHORTCUTS_URL, useAppNavigate } from "../../utils/navigation.js";
import { TASKS_URL } from "../../utils/navigation.js";

/** URL for the new task form. */
const NEW_TASK_URL: string = `${TASKS_URL}/new`;

/**
 * Registers global keyboard shortcuts that work from any page.
 * Rendered once inside the app shell.
 */
export function GlobalShortcuts(): JSX.Element {
  const navigate = useAppNavigate();

  useHotkey({ key: "?" }, () => {
    navigate(SETTINGS_SHORTCUTS_URL);
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
