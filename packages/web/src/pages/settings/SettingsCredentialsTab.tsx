import type { JSX } from "react";
import { CredentialProvidersPanel } from "../../components/panels/CredentialProvidersPanel.js";
import { TokensPanel } from "../../components/panels/TokensPanel.js";

/** Settings tab combining credential providers and custom tokens. */
export function SettingsCredentialsTab(): JSX.Element {
  return (
    <>
      <CredentialProvidersPanel />
      <TokensPanel />
    </>
  );
}
