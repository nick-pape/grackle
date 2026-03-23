/**
 * Domain hook for token management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { TokenInfo, GrackleEvent } from "./types.js";
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

  const loadTokens = useCallback(() => {
    grackleClient.listTokens({}).then(
      (resp) => { setTokens(resp.tokens.map(protoToToken)); },
      (err) => { console.error("[grpc] listTokens failed:", err); },
    );
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "token.changed") {
      loadTokens();
      return true;
    }
    return false;
  }, [loadTokens]);

  const setToken = useCallback(
    (
      name: string,
      value: string,
      tokenType: string,
      envVar: string,
      filePath: string,
    ) => {
      grackleClient.setToken({ name, value, type: tokenType, envVar, filePath }).catch(
        (err) => { console.error("[grpc] setToken failed:", err); },
      );
    },
    [],
  );

  const deleteToken = useCallback(
    (name: string) => {
      grackleClient.deleteToken({ name }).catch(
        (err) => { console.error("[grpc] deleteToken failed:", err); },
      );
    },
    [],
  );

  return { tokens, loadTokens, setToken, deleteToken, handleEvent };
}
