/**
 * Domain hook for environment management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Environment, ProvisionStatus, WsMessage, SendFunction } from "./types.js";
import { asValidArray, isEnvironment, isProvisionProgress, warnBadPayload } from "./types.js";

/** Delay in milliseconds before clearing a successful provision status. */
const PROVISION_STATUS_CLEAR_DELAY_MS: number = 5_000;

/** Values returned by {@link useEnvironments}. */
export interface UseEnvironmentsResult {
  /** All known environments. */
  environments: Environment[];
  /** Per-environment provisioning progress. */
  provisionStatus: Record<string, ProvisionStatus>;
  /** Add a new environment. */
  addEnvironment: (
    displayName: string,
    adapterType: string,
    adapterConfig?: Record<string, unknown>,
    defaultRuntime?: string,
  ) => void;
  /** Provision an environment by ID. */
  provisionEnvironment: (environmentId: string) => void;
  /** Stop an environment by ID. */
  stopEnvironment: (environmentId: string) => void;
  /** Remove an environment by ID. */
  removeEnvironment: (environmentId: string) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
}

/**
 * Hook that manages environment state and lifecycle actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Environment state, actions, and a message handler.
 */
export function useEnvironments(send: SendFunction): UseEnvironmentsResult {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [provisionStatus, setProvisionStatus] = useState<
    Record<string, ProvisionStatus>
  >({});

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "environments":
        setEnvironments(
          asValidArray(
            msg.payload?.environments,
            isEnvironment,
            "environments",
            "environments",
          ),
        );
        return true;
      case "provision_progress": {
        if (!isProvisionProgress(msg.payload)) {
          warnBadPayload(
            "provision_progress",
            "payload is not a valid ProvisionStatus with environmentId",
          );
          return true;
        }
        const pp = msg.payload;
        setProvisionStatus((prev) => ({
          ...prev,
          [pp.environmentId]: {
            stage: pp.stage,
            message: pp.message,
            progress: pp.progress,
          },
        }));
        // Auto-clear provision status after successful completion only;
        // errors persist until the user retries or removes the environment
        if (pp.stage === "ready") {
          setTimeout(() => {
            setProvisionStatus((prev) => {
              const next = { ...prev };
              delete next[pp.environmentId];
              return next;
            });
          }, PROVISION_STATUS_CLEAR_DELAY_MS);
        }
        return true;
      }
      case "environment_added":
        // Server already broadcasts updated environment list via broadcastEnvironments()
        return true;
      case "environment_removed":
        // Clean up stale provision status and optimistically remove the
        // environment from local state so the UI updates immediately even
        // when the removal was triggered via gRPC/CLI (which does not call
        // broadcastEnvironments).
        if (typeof msg.payload?.environmentId === "string") {
          const removedId = msg.payload.environmentId;
          setEnvironments((prev) => prev.filter((e) => e.id !== removedId));
          setProvisionStatus((prev) => {
            const next = { ...prev };
            delete next[removedId];
            return next;
          });
        }
        // Fetch sessions since the server deletes them but doesn't broadcast sessions
        send({ type: "list_sessions" });
        return true;
      default:
        return false;
    }
  }, [send]);

  const addEnvironment = useCallback(
    (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
      defaultRuntime?: string,
    ) => {
      const payload: Record<string, unknown> = {
        displayName,
        adapterType,
        adapterConfig: adapterConfig || {},
      };
      if (defaultRuntime) {
        payload.defaultRuntime = defaultRuntime;
      }
      send({ type: "add_environment", payload });
    },
    [send],
  );

  const provisionEnvironment = useCallback(
    (environmentId: string) => {
      send({ type: "provision_environment", payload: { environmentId } });
    },
    [send],
  );

  const stopEnvironment = useCallback(
    (environmentId: string) => {
      send({ type: "stop_environment", payload: { environmentId } });
    },
    [send],
  );

  const removeEnvironment = useCallback(
    (environmentId: string) => {
      send({ type: "remove_environment", payload: { environmentId } });
    },
    [send],
  );

  return {
    environments,
    provisionStatus,
    addEnvironment,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
    handleMessage,
  };
}
