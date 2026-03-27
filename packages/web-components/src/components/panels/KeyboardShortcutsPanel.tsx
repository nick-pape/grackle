import type { JSX } from "react";
import styles from "./SettingsPanel.module.scss";
import shortcutStyles from "./KeyboardShortcutsPanel.module.scss";

/** A single keyboard shortcut definition. */
interface Shortcut {
  /** Key combination displayed as kbd badges (e.g. ["?"], ["Ctrl", "/"]). */
  keys: string[];
  /** Human-readable description of the action. */
  description: string;
}

/** A named group of related shortcuts. */
interface ShortcutGroup {
  /** Section heading. */
  title: string;
  /** Shortcuts in this group. */
  shortcuts: Shortcut[];
}

/** Static shortcut data — all shortcuts documented in the app. */
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["?"], description: "Open keyboard shortcuts reference" },
      { keys: ["N"], description: "Create a new task" },
      { keys: ["Escape"], description: "Close dialog or cancel editing" },
    ],
  },
  {
    title: "Task Page",
    shortcuts: [
      { keys: ["1"], description: "Switch to Overview tab" },
      { keys: ["2"], description: "Switch to Stream tab" },
      { keys: ["3"], description: "Switch to Findings tab" },
    ],
  },
  {
    title: "Workspace Page",
    shortcuts: [
      { keys: ["1"], description: "Switch to Graph view" },
      { keys: ["2"], description: "Switch to Board view" },
      { keys: ["3"], description: "Switch to Tasks view" },
    ],
  },
  {
    title: "Navigation Lists",
    shortcuts: [
      { keys: ["\u2190"], description: "Previous tab (horizontal nav)" },
      { keys: ["\u2192"], description: "Next tab (horizontal nav)" },
      { keys: ["\u2191"], description: "Previous item (vertical nav)" },
      { keys: ["\u2193"], description: "Next item (vertical nav)" },
      { keys: ["J"], description: "Next item (alias for arrow down/right)" },
      { keys: ["K"], description: "Previous item (alias for arrow up/left)" },
      { keys: ["Home"], description: "Jump to first item" },
      { keys: ["End"], description: "Jump to last item" },
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      { keys: ["Enter"], description: "Activate / save inline edit" },
      { keys: ["Space"], description: "Activate button or start editing" },
      { keys: ["Escape"], description: "Cancel edit and discard changes" },
    ],
  },
  {
    title: "Chat",
    shortcuts: [
      { keys: ["Enter"], description: "Send message (when input is focused)" },
    ],
  },
];

/** Settings panel listing all keyboard shortcuts grouped by category. */
export function KeyboardShortcutsPanel(): JSX.Element {
  return (
    <section className={styles.section} data-testid="keyboard-shortcuts-panel">
      <h3 className={styles.sectionTitle}>Keyboard Shortcuts</h3>
      <p className={styles.sectionDescription}>
        Keyboard shortcuts for navigating and interacting with Grackle. Global shortcuts are
        suppressed while typing in text fields.
      </p>
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.title} className={shortcutStyles.group}>
          <h4 className={shortcutStyles.groupTitle}>{group.title}</h4>
          <div className={shortcutStyles.shortcutList}>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.description} className={shortcutStyles.shortcutRow}>
                <span className={shortcutStyles.keys}>
                  {shortcut.keys.map((k) => (
                    <kbd key={k} className={shortcutStyles.kbd}>{k}</kbd>
                  ))}
                </span>
                <span className={shortcutStyles.description}>{shortcut.description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
