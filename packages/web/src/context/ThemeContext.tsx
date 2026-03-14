import React, { createContext, useContext, type ReactNode, type JSX } from "react";
import { useTheme, type Theme } from "../hooks/useTheme.js";

/** Context value shape for theme state. */
interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "glass" | "light" | "dark";
  setTheme: (next: Theme) => void;
}

const ThemeContext: React.Context<ThemeContextType | undefined> = createContext<ThemeContextType | undefined>(undefined);

/** Provides theme state to the component tree. */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const themeState = useTheme();
  return (
    <ThemeContext.Provider value={themeState}>{children}</ThemeContext.Provider>
  );
}

/** Consumes the theme context; must be called within a ThemeProvider. */
export function useThemeContext(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
