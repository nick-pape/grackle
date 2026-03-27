import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "@grackle-ai/web-components";
import { CredentialProvidersPanel } from "@grackle-ai/web-components";
import { TokensPanel } from "@grackle-ai/web-components";

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
