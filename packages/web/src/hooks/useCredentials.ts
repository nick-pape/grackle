/**
 * Domain hook for credential provider configuration.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { CredentialProviderConfig, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { isCredentialProviderConfig } from "./types.js";

/** Values returned by {@link useCredentials}. */
export interface UseCredentialsResult {
  /** Current credential provider configuration. */
  credentialProviders: CredentialProviderConfig;
  /** Update the credential provider configuration on the server. */
  updateCredentialProviders: (config: CredentialProviderConfig) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages credential provider configuration state and actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Credential provider state, actions, and a message handler.
 */
export function useCredentials(send: SendFunction): UseCredentialsResult {
  const [credentialProviders, setCredentialProviders] = useState<CredentialProviderConfig>({
    claude: "off",
    github: "off",
    copilot: "off",
    codex: "off",
  });

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "credential.providers_changed") {
      if (isCredentialProviderConfig(event.payload)) {
        setCredentialProviders(event.payload);
      }
      return true;
    }
    return false;
  }, []);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "credential_providers":
        if (isCredentialProviderConfig(msg.payload)) {
          setCredentialProviders(msg.payload);
        }
        return true;
      default:
        return false;
    }
  }, []);

  const updateCredentialProviders = useCallback(
    (config: CredentialProviderConfig) => {
      send({
        type: "set_credential_providers",
        payload: config as unknown as Record<string, unknown>,
      });
    },
    [send],
  );

  return { credentialProviders, updateCredentialProviders, handleMessage, handleEvent };
}
