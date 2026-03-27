import type { JSX } from "react";
import { useThemeContext } from "@grackle-ai/web-components";
import { AppearancePanel } from "@grackle-ai/web-components/src/components/panels/AppearancePanel.js";

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
