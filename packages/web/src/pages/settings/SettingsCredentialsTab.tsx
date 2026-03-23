import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { CredentialProvidersPanel } from "../../components/panels/CredentialProvidersPanel.js";
import { TokensPanel } from "../../components/panels/TokensPanel.js";

/** Settings tab combining credential providers and custom tokens. */
export function SettingsCredentialsTab(): JSX.Element {
  const { tokens, setToken, deleteToken } = useGrackle();

  return (
    <>
      <CredentialProvidersPanel />
      <TokensPanel tokens={tokens} onSetToken={setToken} onDeleteToken={deleteToken} />
    </>
  );
}
