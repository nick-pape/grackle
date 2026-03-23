/**
 * Domain hook for persona management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { PersonaData, GrackleEvent } from "./types.js";
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
  ) => void;
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
  ) => void;
  /** Delete a persona by ID. */
  deletePersona: (personaId: string) => void;
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

  const loadPersonas = useCallback(() => {
    grackleClient.listPersonas({}).then(
      (resp) => { setPersonas(resp.personas.map(protoToPersona)); },
      (err) => { console.error("[grpc] listPersonas failed:", err); },
    );
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "persona.created":
      case "persona.updated":
      case "persona.deleted":
        loadPersonas();
        return true;
      default:
        return false;
    }
  }, [loadPersonas]);

  const createPersona = useCallback(
    (
      name: string,
      description: string,
      systemPrompt: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
      type?: string,
      script?: string,
    ) => {
      grackleClient.createPersona({
        name,
        description,
        systemPrompt,
        runtime: runtime || "",
        model: model || "",
        maxTurns: maxTurns || 0,
        type: type || "agent",
        script: script || "",
      }).catch(
        (err) => { console.error("[grpc] createPersona failed:", err); },
      );
    },
    [],
  );

  const updatePersona = useCallback(
    (
      personaId: string,
      name?: string,
      description?: string,
      systemPrompt?: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
      type?: string,
      script?: string,
    ) => {
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
      grackleClient.updatePersona(request).catch(
        (err) => { console.error("[grpc] updatePersona failed:", err); },
      );
    },
    [],
  );

  const deletePersona = useCallback(
    (personaId: string) => {
      grackleClient.deletePersona({ id: personaId }).catch(
        (err) => { console.error("[grpc] deletePersona failed:", err); },
      );
    },
    [],
  );

  return { personas, loadPersonas, createPersona, updatePersona, deletePersona, handleEvent };
}
