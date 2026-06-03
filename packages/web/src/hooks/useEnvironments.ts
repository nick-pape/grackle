/**
 * Domain hook for environment management.
 *
 * Uses ConnectRPC for all CRUD/lifecycle operations. Domain events from the
 * WebSocket event bus trigger re-fetches or direct state updates.
 *
 * @module
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ConnectError } from "@connectrpc/connect";
import { warnBadPayload } from "@grackle-ai/web-components";
import type {
  Environment,
  GrackleEvent,
  ProvisionStatus,
  WsMessage,
  UseEnvironmentsResult,
} from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToEnvironment } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

/** Delay in milliseconds before clearing a successful provision status. */
const PROVISION_STATUS_CLEAR_DELAY_MS: number = 5_000;

/** Extracts a user-facing message from a caught error. */
function extractErrorMessage(err: unknown): string {
  return err instanceof ConnectError ? err.message : "Operation failed";
}

export type { UseEnvironmentsResult } from "@grackle-ai/web-components";

/**
 * Hook that manages environment state and lifecycle actions via ConnectRPC.
 *
 * @returns Environment state, actions, and an event handler.
 */
export function useEnvironments(): UseEnvironmentsResult {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const { loading: environmentsLoading, track: trackEnvironments } = useLoadingState();
  const [provisionStatus, setProvisionStatus] = useState<Record<string, ProvisionStatus>>({});
  const [operationError, setOperationError] = useState("");
  const provisionClearTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearOperationError = useCallback(() => {
    setOperationError("");
  }, []);

  /** Schedule (or reschedule) a timer to clear provision status for an environment. */
  const scheduleProvisionClear = useCallback((environmentId: string) => {
    clearTimeout(provisionClearTimersRef.current[environmentId]);
    provisionClearTimersRef.current[environmentId] = setTimeout(() => {
      delete provisionClearTimersRef.current[environmentId];
      setProvisionStatus((prev) => {
        const next = { ...prev };
        delete next[environmentId];
        return next;
      });
    }, PROVISION_STATUS_CLEAR_DELAY_MS);
  }, []);

  const loadEnvironments = useCallback(async () => {
    try {
      const resp = await trackEnvironments(grackleClient.listEnvironments({}));
      setEnvironments(resp.environments.map(protoToEnvironment));
    } catch {
      // empty
    }
  }, [trackEnvironments]);

  const handleEvent = useCallback(
    (event: GrackleEvent): boolean => {
      switch (event.type) {
        case "environment.added":
          // Signal only — re-fetch triggered by environment.changed
          return true;
        case "environment.removed": {
          const removedId = event.payload.environmentId as string | undefined;
          if (removedId) {
            clearTimeout(provisionClearTimersRef.current[removedId]);
            delete provisionClearTimersRef.current[removedId];
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
          loadEnvironments().catch(() => {});
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
            scheduleProvisionClear(pp.environmentId as string);
          }
          return true;
        }
        default:
          return false;
      }
    },
    [loadEnvironments, scheduleProvisionClear],
  );

  const handleLegacyMessage = useCallback((msg: WsMessage): boolean => {
    if (msg.type === "environments") {
      const incoming = Array.isArray(msg.payload?.environments)
        ? (msg.payload.environments as Environment[])
        : [];
      setEnvironments(incoming);
      return true;
    }
    return false;
  }, []);

  const addEnvironment = useCallback(
    async (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
      githubAccountId?: string,
    ) => {
      setOperationError("");
      try {
        await grackleClient.addEnvironment({
          displayName,
          adapterType,
          adapterConfig: JSON.stringify(adapterConfig ?? {}),
          githubAccountId: githubAccountId ?? "",
        });
      } catch (err) {
        setOperationError(extractErrorMessage(err));
      }
    },
    [],
  );

  const updateEnvironment = useCallback(
    async (
      environmentId: string,
      fields: {
        displayName?: string;
        adapterConfig?: Record<string, unknown>;
        githubAccountId?: string;
      },
    ) => {
      setOperationError("");
      try {
        await grackleClient.updateEnvironment({
          id: environmentId,
          displayName: fields.displayName,
          adapterConfig: fields.adapterConfig ? JSON.stringify(fields.adapterConfig) : undefined,
          githubAccountId: fields.githubAccountId,
        });
      } catch (err) {
        setOperationError(extractErrorMessage(err));
      }
    },
    [],
  );

  const provisionEnvironment = useCallback(
    async (environmentId: string, force?: boolean) => {
      setOperationError("");
      try {
        const stream = grackleClient.provisionEnvironment({
          id: environmentId,
          force: force ?? false,
        });
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
            scheduleProvisionClear(environmentId);
          }
        }
      } catch (err) {
        setProvisionStatus((prev) => {
          const next = { ...prev };
          delete next[environmentId];
          return next;
        });
        setOperationError(extractErrorMessage(err));
      }
    },
    [scheduleProvisionClear],
  );

  const stopEnvironment = useCallback(async (environmentId: string) => {
    setOperationError("");
    try {
      await grackleClient.stopEnvironment({ id: environmentId });
    } catch (err) {
      setOperationError(extractErrorMessage(err));
    }
  }, []);

  const removeEnvironment = useCallback(async (environmentId: string) => {
    setOperationError("");
    try {
      await grackleClient.removeEnvironment({ id: environmentId });
    } catch (err) {
      setOperationError(extractErrorMessage(err));
    }
  }, []);

  const onDisconnect = useCallback(() => {
    for (const timerId of Object.values(provisionClearTimersRef.current)) {
      clearTimeout(timerId);
    }
    provisionClearTimersRef.current = {};
    setProvisionStatus({});
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(provisionClearTimersRef.current)) {
        clearTimeout(timerId);
      }
      provisionClearTimersRef.current = {};
    };
  }, []);

  const domainHook: DomainHook = useMemo(
    () => ({
      onConnect: () => loadEnvironments(),
      onDisconnect,
      handleEvent,
    }),
    [loadEnvironments, onDisconnect, handleEvent],
  );

  return {
    environments,
    environmentsLoading,
    provisionStatus,
    operationError,
    clearOperationError,
    loadEnvironments,
    addEnvironment,
    updateEnvironment,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
    handleEvent,
    handleLegacyMessage,
    domainHook,
  };
}
