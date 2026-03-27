import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { CredentialProvidersPanel } from "../../components/panels/CredentialProvidersPanel.js";
import { TokensPanel } from "../../components/panels/TokensPanel.js";

/** Settings tab combining credential providers and custom tokens. */
export function SettingsCredentialsTab(): JSX.Element {
  const { tokens, setToken, deleteToken, credentialProviders, updateCredentialProviders } = useGrackle();
  const { showToast } = useToast();

  return (
    <>
      <CredentialProvidersPanel credentialProviders={credentialProviders} onUpdateCredentialProviders={updateCredentialProviders} />
      <TokensPanel tokens={tokens} onSetToken={setToken} onDeleteToken={deleteToken} onShowToast={showToast} />
    </>
  );
}
