/**
 * Domain hook for environment management.
 *
 * Uses ConnectRPC for all CRUD/lifecycle operations. Domain events from the
 * WebSocket event bus trigger re-fetches or direct state updates.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Environment, ProvisionStatus, GrackleEvent, WsMessage } from "./types.js";
import { warnBadPayload } from "./types.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToEnvironment } from "./proto-converters.js";

/** Delay in milliseconds before clearing a successful provision status. */
const PROVISION_STATUS_CLEAR_DELAY_MS: number = 5_000;

/** Values returned by {@link useEnvironments}. */
export interface UseEnvironmentsResult {
  /** All known environments. */
  environments: Environment[];
  /** Per-environment provisioning progress. */
  provisionStatus: Record<string, ProvisionStatus>;
  /** Request the current environment list from the server. */
  loadEnvironments: () => void;
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
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Handle legacy WS messages injected by E2E tests. */
  handleLegacyMessage?: (msg: WsMessage) => boolean;
}

/**
 * Hook that manages environment state and lifecycle actions via ConnectRPC.
 *
 * @returns Environment state, actions, and an event handler.
 */
export function useEnvironments(): UseEnvironmentsResult {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [provisionStatus, setProvisionStatus] = useState<
    Record<string, ProvisionStatus>
  >({});

  const loadEnvironments = useCallback(() => {
    grackleClient.listEnvironments({}).then(
      (resp) => { setEnvironments(resp.environments.map(protoToEnvironment)); },
      () => {},
    );
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "environment.added":
        // Signal only — re-fetch triggered by environment.changed
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
        // Sessions refresh is a sessions concern; useGrackleSocket handles it.
        return true;
      }
      case "environment.changed":
        loadEnvironments();
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
  }, [loadEnvironments]);

  const handleLegacyMessage = useCallback((msg: WsMessage): boolean => {
    if (msg.type === "environments") {
      const incoming = Array.isArray(msg.payload?.environments) ? msg.payload.environments as Environment[] : [];
      setEnvironments(incoming);
      return true;
    }
    return false;
  }, []);

  const addEnvironment = useCallback(
    (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
    ) => {
      grackleClient.addEnvironment({
        displayName,
        adapterType,
        adapterConfig: JSON.stringify(adapterConfig ?? {}),
      }).catch(
        () => {},
      );
    },
    [],
  );

  const updateEnvironment = useCallback(
    (
      environmentId: string,
      fields: { displayName?: string; adapterConfig?: Record<string, unknown> },
    ) => {
      grackleClient.updateEnvironment({
        id: environmentId,
        displayName: fields.displayName,
        adapterConfig: fields.adapterConfig ? JSON.stringify(fields.adapterConfig) : undefined,
      }).catch(
        () => {},
      );
    },
    [],
  );

  const provisionEnvironment = useCallback(
    (environmentId: string) => {
      const runProvision = async (): Promise<void> => {
        try {
          const stream = grackleClient.provisionEnvironment({ id: environmentId });
          for await (const event of stream) {
            setProvisionStatus((prev) => ({
              ...prev,
              [environmentId]: {
                stage: event.stage,
                message: event.message,
                progress: event.progress,
              },
            }));
            if (event.stage === "ready") {
              setTimeout(() => {
                setProvisionStatus((prev) => {
                  const next = { ...prev };
                  delete next[environmentId];
                  return next;
                });
              }, PROVISION_STATUS_CLEAR_DELAY_MS);
            }
          }
        } catch {
          setProvisionStatus((prev) => {
            const next = { ...prev };
            delete next[environmentId];
            return next;
          });
        }
      };
      runProvision().catch(() => {});
    },
    [],
  );

  const stopEnvironment = useCallback(
    (environmentId: string) => {
      grackleClient.stopEnvironment({ id: environmentId }).catch(
        () => {},
      );
    },
    [],
  );

  const removeEnvironment = useCallback(
    (environmentId: string) => {
      grackleClient.removeEnvironment({ id: environmentId }).catch(
        () => {},
      );
    },
    [],
  );

  return {
    environments,
    provisionStatus,
    loadEnvironments,
    addEnvironment,
    updateEnvironment,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
    handleEvent,
    handleLegacyMessage,
  };
}
