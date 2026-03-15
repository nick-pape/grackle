import type { JSX } from "react";
import { TokensPanel } from "../../components/panels/TokensPanel.js";

/** Settings tab wrapping the tokens panel. */
export function SettingsTokensTab(): JSX.Element {
  return <TokensPanel />;
}
