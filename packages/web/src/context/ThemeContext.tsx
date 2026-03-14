import React, { createContext, useContext, type ReactNode, type JSX } from "react";
import { useTheme, type UseThemeResult } from "../hooks/useTheme.js";

const ThemeContext: React.Context<UseThemeResult | undefined> = createContext<UseThemeResult | undefined>(undefined);

/** Provides theme state to the component tree. */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const themeState = useTheme();
  return (
    <ThemeContext.Provider value={themeState}>{children}</ThemeContext.Provider>
  );
}

/** Consumes the theme context; must be called within a ThemeProvider. */
export function useThemeContext(): UseThemeResult {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
