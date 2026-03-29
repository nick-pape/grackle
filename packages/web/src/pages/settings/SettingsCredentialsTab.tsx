import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { CredentialProvidersPanel, TokensPanel, useToast } from "@grackle-ai/web-components";

/** Settings tab combining credential providers and custom tokens. */
export function SettingsCredentialsTab(): JSX.Element {
  const { tokens: { tokens, setToken, deleteToken }, credentials: { credentialProviders, updateCredentialProviders } } = useGrackle();
  const { showToast } = useToast();

  return (
    <>
      <CredentialProvidersPanel credentialProviders={credentialProviders} onUpdateCredentialProviders={(cfg) => { updateCredentialProviders(cfg).catch(() => {}); }} />
      <TokensPanel tokens={tokens} onSetToken={(name, value, tokenType, envVar, filePath) => { setToken(name, value, tokenType, envVar, filePath).catch(() => {}); }} onDeleteToken={(name) => { deleteToken(name).catch(() => {}); }} onShowToast={showToast} />
    </>
  );
}
