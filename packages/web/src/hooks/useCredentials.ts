/**
 * Domain hook for credential provider configuration.
 *
 * Uses ConnectRPC for all operations. Domain events from the WebSocket
 * event bus trigger local state updates.
 *
 * @module
 */

import { useState, useCallback } from "react";
import { isCredentialProviderConfig } from "@grackle-ai/web-components";
import type { CredentialProviderConfig, GrackleEvent } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToCredentialConfig } from "./proto-converters.js";

/** Values returned by {@link useCredentials}. */
export interface UseCredentialsResult {
  /** Current credential provider configuration. */
  credentialProviders: CredentialProviderConfig;
  /** Request the current credential provider configuration from the server. */
  loadCredentials: () => Promise<void>;
  /** Update the credential provider configuration on the server. */
  updateCredentialProviders: (config: CredentialProviderConfig) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages credential provider configuration state and actions via ConnectRPC.
 *
 * @returns Credential provider state, actions, and an event handler.
 */
export function useCredentials(): UseCredentialsResult {
  const [credentialProviders, setCredentialProviders] = useState<CredentialProviderConfig>({
    claude: "off",
    github: "off",
    copilot: "off",
    codex: "off",
    goose: "off",
  });

  const loadCredentials = useCallback(async () => {
    try {
      const resp = await grackleClient.getCredentialProviders({});
      setCredentialProviders(protoToCredentialConfig(resp));
    } catch {
      // empty
    }
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "credential.providers_changed") {
      if (isCredentialProviderConfig(event.payload)) {
        setCredentialProviders(event.payload);
      }
      return true;
    }
    return false;
  }, []);

  const updateCredentialProviders = useCallback(
    async (config: CredentialProviderConfig) => {
      const entries: Array<{ provider: string; value: string }> = [
        { provider: "claude", value: config.claude },
        { provider: "github", value: config.github },
        { provider: "copilot", value: config.copilot },
        { provider: "codex", value: config.codex },
        { provider: "goose", value: config.goose },
      ];
      await Promise.allSettled(
        entries.map(({ provider, value }) =>
          grackleClient.setCredentialProvider({ provider, value }),
        ),
      );
    },
    [],
  );

  return { credentialProviders, loadCredentials, updateCredentialProviders, handleEvent };
}
