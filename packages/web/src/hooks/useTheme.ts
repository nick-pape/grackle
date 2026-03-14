import { useCallback, useEffect, useSyncExternalStore } from "react";

/** Available theme choices. */
export type Theme = "light" | "dark" | "system";

interface ThemeSnapshot {
  theme: Theme;
  systemDark: boolean;
}

const STORAGE_KEY: string = "grackle-theme";
const MEDIA_QUERY: string = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | undefined = undefined;

/** Notify all subscribers of a state change. */
function emitChange(): void {
  lastSnapshot = undefined;
  for (const listener of listeners) {
    listener();
  }
}

/** Check whether the OS prefers dark mode. */
function getSystemDark(): boolean {
  return window.matchMedia(MEDIA_QUERY).matches;
}

/** Read the persisted theme choice from localStorage, defaulting to "system". */
function getStored(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // localStorage may be unavailable
  }
  return "system";
}

/** Apply the resolved theme to the document root element. */
function applyTheme(theme: Theme, suppressTransitions: boolean = false): void {
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  const isDark = theme === "dark" || (theme === "system" && getSystemDark());
  document.documentElement.dataset.theme = isDark ? "dark" : "light";

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions, no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

// Apply immediately on module load to prevent flash of wrong theme
applyTheme(getStored());

// Listen for OS color scheme changes
window.matchMedia(MEDIA_QUERY).addEventListener("change", () => {
  if (getStored() === "system") {
    applyTheme("system");
  }
  emitChange();
});

/** Build the current snapshot for useSyncExternalStore. */
function getSnapshot(): ThemeSnapshot {
  if (lastSnapshot === undefined) {
    lastSnapshot = {
      theme: getStored(),
      systemDark: getSystemDark(),
    };
  }
  return lastSnapshot;
}

/** Subscribe to snapshot changes. */
function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** React hook for reading and setting the application theme. */
export function useTheme(): {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (next: Theme) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { theme } = snapshot;

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable
    }
    applyTheme(next, true);
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme, resolvedTheme };
}
