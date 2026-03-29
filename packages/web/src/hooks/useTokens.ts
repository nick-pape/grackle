/**
 * Domain hook for token management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { TokenInfo, GrackleEvent, UseTokensResult } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToToken } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseTokensResult } from "@grackle-ai/web-components";

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

  return { tokens, tokensLoading, loadTokens, setToken, deleteToken, handleEvent };
}
