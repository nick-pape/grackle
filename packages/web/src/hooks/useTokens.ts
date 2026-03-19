/**
 * Domain hook for token management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { TokenInfo, WsMessage, SendFunction, GrackleEvent } from "./types.js";
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
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages token state and CRUD actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Token state, actions, and a message handler.
 */
export function useTokens(send: SendFunction): UseTokensResult {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "token.changed") {
      send({ type: "list_tokens" });
      return true;
    }
    return false;
  }, [send]);

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
      default:
        return false;
    }
  }, []);

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

  return { tokens, loadTokens, setToken, deleteToken, handleMessage, handleEvent };
}
