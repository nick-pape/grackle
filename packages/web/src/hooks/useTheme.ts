import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_IDS, DEFAULT_THEME_ID, getThemeById } from "../themes.js";

interface ThemeSnapshot {
  themeId: string;
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
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(MEDIA_QUERY).matches;
}

/** Read the persisted theme ID from localStorage, defaulting to the registry default. */
function getStored(): string {
  if (typeof localStorage === "undefined") {
    return DEFAULT_THEME_ID;
  }
  try {
    const raw: string | null = localStorage.getItem(STORAGE_KEY);
    if (raw !== null && THEME_IDS.has(raw)) {
      return raw;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_THEME_ID;
}

/** Resolve a theme ID to the data-theme attribute value applied to the document. */
function resolveDataTheme(themeId: string): string {
  const def = getThemeById(themeId);
  if (def?.isSystemAuto) {
    return getSystemDark() ? (def.systemDarkId ?? "dark") : (def.systemLightId ?? "light");
  }
  return themeId;
}

/** Apply the resolved theme to the document root element. */
function applyTheme(themeId: string, suppressTransitions: boolean = false): void {
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  document.documentElement.dataset.theme = resolveDataTheme(themeId);

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
if (typeof document !== "undefined") {
  applyTheme(getStored());
}

/** Build the current snapshot for useSyncExternalStore. */
function getSnapshot(): ThemeSnapshot {
  if (lastSnapshot === undefined) {
    lastSnapshot = {
      themeId: getStored(),
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

/** Result shape for the useTheme hook. */
export interface UseThemeResult {
  /** The user's chosen theme ID (may be "system"). */
  themeId: string;
  /** The actually-applied data-theme value after resolving system preference. */
  resolvedThemeId: string;
  /** Set a new theme by ID. */
  setTheme: (nextId: string) => void;
}

/** React hook for reading and setting the application theme. */
export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { themeId } = snapshot;

  const resolvedThemeId: string = resolveDataTheme(themeId);

  const setTheme = useCallback((nextId: string) => {
    if (!THEME_IDS.has(nextId)) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, nextId);
    } catch {
      // localStorage may be unavailable
    }
    applyTheme(nextId, true);
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQueryList: MediaQueryList = window.matchMedia(MEDIA_QUERY);
    const handleChange = (): void => {
      const stored: string = getStored();
      const def = getThemeById(stored);
      if (def?.isSystemAuto) {
        applyTheme(stored);
      }
      emitChange();
    };

    mediaQueryList.addEventListener("change", handleChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  return { themeId, setTheme, resolvedThemeId };
}
