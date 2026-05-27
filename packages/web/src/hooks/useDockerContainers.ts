/**
 * Domain hook for Docker container discovery (attach mode, issue #1223).
 *
 * Uses ConnectRPC to list running containers the user can attach an
 * environment to.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { DockerContainer, UseDockerContainersResult } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToDockerContainer } from "./proto-converters.js";

export type { UseDockerContainersResult } from "@grackle-ai/web-components";

/**
 * Hook that manages the list of attachable Docker containers via ConnectRPC.
 *
 * @returns Docker container state and actions.
 */
export function useDockerContainers(): UseDockerContainersResult {
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);
  const [dockerContainersError, setDockerContainersError] = useState("");

  const listDockerContainers = useCallback(async () => {
    try {
      const resp = await grackleClient.listDockerContainers({});
      setDockerContainers(resp.containers.map(protoToDockerContainer));
      setDockerContainersError(resp.error);
    } catch (err) {
      // Surface the failure so the UI can fall back to manual container entry
      // instead of leaving the user stuck with an empty picker.
      setDockerContainers([]);
      setDockerContainersError(
        err instanceof Error ? err.message : "Failed to list Docker containers",
      );
    }
  }, []);

  const domainHook: DomainHook = {
    // Container discovery is lazy (loaded when the user opens the picker), so
    // there is nothing to refresh on connect.
    onConnect: async () => {},
    onDisconnect: () => {},
    handleEvent: () => false,
  };

  return {
    dockerContainers,
    dockerContainersError,
    listDockerContainers,
    domainHook,
  };
}
