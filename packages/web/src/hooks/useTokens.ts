/**
 * Domain hook for token management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { TokenInfo, WsMessage, SendFunction } from "./types.js";
import { asValidArray, isTokenInfo } from "./types.js";

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
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
}

/**
 * Hook that manages token state and CRUD actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Token state, actions, and a message handler.
 */
export function useTokens(send: SendFunction): UseTokensResult {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "tokens":
        setTokens(
          asValidArray(
            msg.payload?.tokens,
            isTokenInfo,
            "tokens",
            "tokens",
          ),
        );
        return true;
      case "token_changed":
        send({ type: "list_tokens" });
        return true;
      default:
        return false;
    }
  }, [send]);

  const loadTokens = useCallback(() => {
    send({ type: "list_tokens" });
  }, [send]);

  const setToken = useCallback(
    (
      name: string,
      value: string,
      tokenType: string,
      envVar: string,
      filePath: string,
    ) => {
      send({
        type: "set_token",
        payload: { name, value, tokenType, envVar, filePath },
      });
    },
    [send],
  );

  const deleteToken = useCallback(
    (name: string) => {
      send({ type: "delete_token", payload: { name } });
    },
    [send],
  );

  return { tokens, loadTokens, setToken, deleteToken, handleMessage };
}
