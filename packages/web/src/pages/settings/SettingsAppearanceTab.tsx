import type { JSX } from "react";
import { useThemeContext } from "../../context/ThemeContext.js";
import { AppearancePanel } from "../../components/panels/AppearancePanel.js";

/** Settings tab wrapping the appearance panel. */
export function SettingsAppearanceTab(): JSX.Element {
  const { themeId, resolvedThemeId, setTheme, preferSystem, setPreferSystem } = useThemeContext();

  return (
    <AppearancePanel
      themeId={themeId}
      resolvedThemeId={resolvedThemeId}
      onSetTheme={setTheme}
      preferSystem={preferSystem}
      onSetPreferSystem={setPreferSystem}
    />
  );
}
