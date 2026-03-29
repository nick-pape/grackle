/**
 * Domain hook for token management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { TokenInfo, GrackleEvent } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToToken } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

/** Values returned by {@link useTokens}. */
export interface UseTokensResult {
  /** All known tokens. */
  tokens: TokenInfo[];
  /** Whether the token list is currently being loaded. */
  tokensLoading: boolean;
  /** Request the current token list from the server. */
  loadTokens: () => Promise<void>;
  /** Create or update a token on the server. */
  setToken: (
    name: string,
    value: string,
    tokenType: string,
    envVar: string,
    filePath: string,
  ) => Promise<void>;
  /** Delete a token by name. */
  deleteToken: (name: string) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/**
 * Hook that manages token state and CRUD actions via ConnectRPC.
 *
 * @returns Token state, actions, and an event handler.
 */
export function useTokens(): UseTokensResult {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const { loading: tokensLoading, track: trackTokens } = useLoadingState();

  const loadTokens = useCallback(async () => {
    try {
      const resp = await trackTokens(grackleClient.listTokens({}));
      setTokens(resp.tokens.map(protoToToken));
    } catch {
      // empty
    }
  }, [trackTokens]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "token.changed") {
      loadTokens().catch(() => {});
      return true;
    }
    return false;
  }, [loadTokens]);

  const setToken = useCallback(
    async (
      name: string,
      value: string,
      tokenType: string,
      envVar: string,
      filePath: string,
    ) => {
      try {
        await grackleClient.setToken({ name, value, type: tokenType, envVar, filePath });
      } catch {
        // empty
      }
    },
    [],
  );

  const deleteToken = useCallback(
    async (name: string) => {
      try {
        await grackleClient.deleteToken({ name });
      } catch {
        // empty
      }
    },
    [],
  );

  const domainHook: DomainHook = {
    onConnect: () => loadTokens(),
    onDisconnect: () => {},
    handleEvent,
  };

  return { tokens, tokensLoading, loadTokens, setToken, deleteToken, handleEvent, domainHook };
}
