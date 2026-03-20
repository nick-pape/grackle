/**
 * Domain hook for environment management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Environment, ProvisionStatus, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { asValidArray, isEnvironment, warnBadPayload } from "./types.js";

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
  ) => void;
  /** Update an existing environment's mutable fields. */
  updateEnvironment: (
    environmentId: string,
    fields: { displayName?: string; adapterConfig?: Record<string, unknown> },
  ) => void;
  /** Provision an environment by ID. */
  provisionEnvironment: (environmentId: string) => void;
  /** Stop an environment by ID. */
  stopEnvironment: (environmentId: string) => void;
  /** Remove an environment by ID. */
  removeEnvironment: (environmentId: string) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
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

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "environment.added":
        // Signal only — re-fetch handled by environment.changed
        return true;
      case "environment.removed": {
        const removedId = event.payload.environmentId as string | undefined;
        if (removedId) {
          setEnvironments((prev) => prev.filter((e) => e.id !== removedId));
          setProvisionStatus((prev) => {
            const next = { ...prev };
            delete next[removedId];
            return next;
          });
        }
        send({ type: "list_sessions" });
        return true;
      }
      case "environment.changed":
        send({ type: "list_environments" });
        return true;
      case "environment.provision_progress": {
        const pp = event.payload;
        if (
          typeof pp.environmentId !== "string" ||
          typeof pp.stage !== "string" ||
          typeof pp.message !== "string" ||
          typeof pp.progress !== "number"
        ) {
          warnBadPayload("environment.provision_progress", "invalid payload");
          return true;
        }
        setProvisionStatus((prev) => ({
          ...prev,
          [pp.environmentId as string]: {
            stage: pp.stage as string,
            message: pp.message as string,
            progress: pp.progress as number,
          },
        }));
        if (pp.stage === "ready") {
          const envId = pp.environmentId as string;
          setTimeout(() => {
            setProvisionStatus((prev) => {
              const next = { ...prev };
              delete next[envId];
              return next;
            });
          }, PROVISION_STATUS_CLEAR_DELAY_MS);
        }
        return true;
      }
      default:
        return false;
    }
  }, [send]);

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
      default:
        return false;
    }
  }, []);

  const addEnvironment = useCallback(
    (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
    ) => {
      const payload: Record<string, unknown> = {
        displayName,
        adapterType,
        adapterConfig: adapterConfig || {},
      };
      send({ type: "add_environment", payload });
    },
    [send],
  );

  const updateEnvironment = useCallback(
    (
      environmentId: string,
      fields: { displayName?: string; adapterConfig?: Record<string, unknown> },
    ) => {
      const payload: Record<string, unknown> = { environmentId, ...fields };
      send({ type: "update_environment", payload });
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
    updateEnvironment,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
    handleMessage,
    handleEvent,
  };
}
