import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { PluginsPanel } from "@grackle-ai/web-components";

/** Settings tab for managing Grackle plugins. */
export function SettingsPluginsTab(): JSX.Element {
  const { plugins: { plugins, pluginsLoading, setPluginEnabled } } = useGrackle();

  return (
    <PluginsPanel
      plugins={plugins}
      loading={pluginsLoading}
      onSetPluginEnabled={(name, enabled) => { setPluginEnabled(name, enabled).catch(() => {}); }}
    />
  );
}
