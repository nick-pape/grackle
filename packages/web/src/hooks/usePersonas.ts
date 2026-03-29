/**
 * Domain hook for persona management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { PersonaData, GrackleEvent } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToPersona } from "./proto-converters.js";

/** Values returned by {@link usePersonas}. */
export interface UsePersonasResult {
  /** All known personas. */
  personas: PersonaData[];
  /** Request the current persona list from the server. */
  loadPersonas: () => void;
  /** Create a new persona. */
  createPersona: (
    name: string,
    description: string,
    systemPrompt: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
    type?: string,
    script?: string,
    allowedMcpTools?: string[],
  ) => Promise<PersonaData>;
  /** Update an existing persona. */
  updatePersona: (
    personaId: string,
    name?: string,
    description?: string,
    systemPrompt?: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
    type?: string,
    script?: string,
    allowedMcpTools?: string[],
  ) => Promise<PersonaData>;
  /** Delete a persona by ID. */
  deletePersona: (personaId: string) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages persona state and CRUD actions via ConnectRPC.
 *
 * @returns Persona state, actions, and an event handler.
 */
export function usePersonas(): UsePersonasResult {
  const [personas, setPersonas] = useState<PersonaData[]>([]);

  const loadPersonas = useCallback(async () => {
    try {
      const resp = await grackleClient.listPersonas({});
      setPersonas(resp.personas.map(protoToPersona));
    } catch {
      // empty
    }
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "persona.created":
      case "persona.updated":
      case "persona.deleted":
        loadPersonas().catch(() => {});
        return true;
      default:
        return false;
    }
  }, [loadPersonas]);

  const createPersona = useCallback(
    async (
      name: string,
      description: string,
      systemPrompt: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
      type?: string,
      script?: string,
      allowedMcpTools?: string[],
    ): Promise<PersonaData> => {
      const resp = await grackleClient.createPersona({
        name,
        description,
        systemPrompt,
        runtime: runtime || "",
        model: model || "",
        maxTurns: maxTurns || 0,
        type: type || "agent",
        script: script || "",
        allowedMcpTools: allowedMcpTools || [],
      });
      const createdPersona = protoToPersona(resp);
      setPersonas((prev) => [...prev.filter((persona) => persona.id !== createdPersona.id), createdPersona]);
      return createdPersona;
    },
    [],
  );

  const updatePersona = useCallback(
    async (
      personaId: string,
      name?: string,
      description?: string,
      systemPrompt?: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
      type?: string,
      script?: string,
      allowedMcpTools?: string[],
    ): Promise<PersonaData> => {
      // Build the request with only defined fields so the server can distinguish
      // "not provided" (keep existing) from "set to empty" (clear).
      const request: Record<string, unknown> = { id: personaId };
      if (name !== undefined) { request.name = name; }
      if (description !== undefined) { request.description = description; }
      if (systemPrompt !== undefined) { request.systemPrompt = systemPrompt; }
      if (runtime !== undefined) { request.runtime = runtime; }
      if (model !== undefined) { request.model = model; }
      if (maxTurns !== undefined) { request.maxTurns = maxTurns; }
      if (type !== undefined) { request.type = type; }
      if (script !== undefined) { request.script = script; }
      if (allowedMcpTools !== undefined) { request.allowedMcpTools = { tools: allowedMcpTools }; }
      const resp = await grackleClient.updatePersona(request);
      const updatedPersona = protoToPersona(resp);
      setPersonas((prev) => prev.map((persona) => (
        persona.id === updatedPersona.id ? updatedPersona : persona
      )));
      return updatedPersona;
    },
    [],
  );

  const deletePersona = useCallback(
    async (personaId: string): Promise<void> => {
      await grackleClient.deletePersona({ id: personaId });
      setPersonas((prev) => prev.filter((persona) => persona.id !== personaId));
    },
    [],
  );

  /* eslint-disable @typescript-eslint/no-misused-promises -- async hooks returned as fire-and-forget void actions */
  return { personas, loadPersonas, createPersona, updatePersona, deletePersona, handleEvent };
  /* eslint-enable @typescript-eslint/no-misused-promises */
}
