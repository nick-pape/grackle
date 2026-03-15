import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_IDS, DEFAULT_THEME_ID, getThemeById } from "../themes.js";

interface ThemeSnapshot {
  themeId: string;
  systemDark: boolean;
  preferSystem: boolean;
}

const STORAGE_KEY: string = "grackle-theme";
const PREFER_SYSTEM_KEY: string = "grackle-prefer-system";
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

/** Read the persisted prefer-system flag from localStorage. */
function getPreferSystem(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(PREFER_SYSTEM_KEY) === "true";
  } catch {
    return false;
  }
}

/** Resolve a theme ID to the data-theme attribute value applied to the document. */
function resolveDataTheme(themeId: string, preferSystem: boolean): string {
  const def = getThemeById(themeId);
  // Parent variant IDs (e.g., "grackle") resolve based on system preference or default to dark
  if (def?.variantDarkId) {
    if (preferSystem && def.variantLightId) {
      return getSystemDark() ? def.variantDarkId : def.variantLightId;
    }
    return def.variantDarkId;
  }
  return themeId;
}

/** Apply the resolved theme to the document root element. */
function applyTheme(themeId: string, preferSystem: boolean, suppressTransitions: boolean = false): void {
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  document.documentElement.dataset.theme = resolveDataTheme(themeId, preferSystem);

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
  applyTheme(getStored(), getPreferSystem());
}

/** Build the current snapshot for useSyncExternalStore. */
function getSnapshot(): ThemeSnapshot {
  if (lastSnapshot === undefined) {
    lastSnapshot = {
      themeId: getStored(),
      systemDark: getSystemDark(),
      preferSystem: getPreferSystem(),
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
  /** The user's chosen theme ID. */
  themeId: string;
  /** The actually-applied data-theme value after resolving system preference. */
  resolvedThemeId: string;
  /** Set a new theme by ID. */
  setTheme: (nextId: string) => void;
  /** Whether the theme follows the OS light/dark preference. */
  preferSystem: boolean;
  /** Toggle the OS preference auto-switch behavior. */
  setPreferSystem: (prefer: boolean) => void;
}

/** React hook for reading and setting the application theme. */
export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { themeId, preferSystem } = snapshot;

  const resolvedThemeId: string = resolveDataTheme(themeId, preferSystem);

  const setTheme = useCallback((nextId: string) => {
    if (!THEME_IDS.has(nextId)) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, nextId);
    } catch {
      // localStorage may be unavailable
    }
    applyTheme(nextId, getPreferSystem(), true);
    emitChange();
  }, []);

  const setPreferSystem = useCallback((prefer: boolean) => {
    try {
      localStorage.setItem(PREFER_SYSTEM_KEY, prefer ? "true" : "false");
    } catch {
      // localStorage may be unavailable
    }
    applyTheme(getStored(), prefer, true);
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(themeId, preferSystem);
  }, [themeId, preferSystem]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQueryList: MediaQueryList = window.matchMedia(MEDIA_QUERY);
    const handleChange = (): void => {
      const stored: string = getStored();
      const prefer: boolean = getPreferSystem();
      if (prefer) {
        const def = getThemeById(stored);
        if (def?.variantDarkId && def?.variantLightId) {
          applyTheme(stored, prefer);
        }
      }
      emitChange();
    };

    mediaQueryList.addEventListener("change", handleChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  return { themeId, setTheme, resolvedThemeId, preferSystem, setPreferSystem };
}
