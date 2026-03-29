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
import { grackleClient } from "./useGrackleClient.js";
import { protoToToken } from "./proto-converters.js";

/** Values returned by {@link useTokens}. */
export interface UseTokensResult {
  /** All known tokens. */
  tokens: TokenInfo[];
  /** Request the current token list from the server. */
  loadTokens: () => void;
  /** Create or update a token on the server. */
  setToken: (
    name: string,
    value: string,
    tokenType: string,
    envVar: string,
    filePath: string,
  ) => void;
  /** Delete a token by name. */
  deleteToken: (name: string) => void;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages token state and CRUD actions via ConnectRPC.
 *
 * @returns Token state, actions, and an event handler.
 */
export function useTokens(): UseTokensResult {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  const loadTokens = useCallback(async () => {
    try {
      const resp = await grackleClient.listTokens({});
      setTokens(resp.tokens.map(protoToToken));
    } catch {
      // empty
    }
  }, []);

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

  /* eslint-disable @typescript-eslint/no-misused-promises -- async hooks returned as fire-and-forget void actions */
  return { tokens, loadTokens, setToken, deleteToken, handleEvent };
  /* eslint-enable @typescript-eslint/no-misused-promises */
}
