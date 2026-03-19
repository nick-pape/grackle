/**
 * Domain hook for persona management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { PersonaData, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { asValidArray, isPersonaData } from "./types.js";

/** Values returned by {@link usePersonas}. */
export interface UsePersonasResult {
  /** All known personas. */
  personas: PersonaData[];
  /** Create a new persona. */
  createPersona: (
    name: string,
    description: string,
    systemPrompt: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
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
  ) => void;
  /** Delete a persona by ID. */
  deletePersona: (personaId: string) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages persona state and CRUD actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Persona state, actions, and a message handler.
 */
export function usePersonas(send: SendFunction): UsePersonasResult {
  const [personas, setPersonas] = useState<PersonaData[]>([]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "persona.created":
      case "persona.updated":
      case "persona.deleted":
        send({ type: "list_personas" });
        return true;
      default:
        return false;
    }
  }, [send]);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "personas": {
        const list = asValidArray(
          msg.payload?.personas,
          isPersonaData,
          "personas",
          "personas",
        );
        setPersonas(list);
        return true;
      }
      default:
        return false;
    }
  }, []);

  const createPersona = useCallback(
    (
      name: string,
      description: string,
      systemPrompt: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
    ) => {
      send({
        type: "create_persona",
        payload: {
          name,
          description,
          systemPrompt,
          runtime: runtime || "",
          model: model || "",
          maxTurns: maxTurns || 0,
        },
      });
    },
    [send],
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
    ) => {
      // Only include fields that were explicitly provided so the server can
      // distinguish "not provided" (keep existing) from "set to empty" (clear).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: Record<string, any> = { personaId };
      if (name !== undefined) { payload.name = name; }
      if (description !== undefined) { payload.description = description; }
      if (systemPrompt !== undefined) { payload.systemPrompt = systemPrompt; }
      if (runtime !== undefined) { payload.runtime = runtime; }
      if (model !== undefined) { payload.model = model; }
      if (maxTurns !== undefined) { payload.maxTurns = maxTurns; }
      send({ type: "update_persona", payload });
    },
    [send],
  );

  const deletePersona = useCallback(
    (personaId: string) => {
      send({ type: "delete_persona", payload: { personaId } });
    },
    [send],
  );

  return { personas, createPersona, updatePersona, deletePersona, handleMessage, handleEvent };
}
