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
      type?: string,
      script?: string,
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
          type: type || "agent",
          script: script || "",
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
      type?: string,
      script?: string,
    ) => {
      send({
        type: "update_persona",
        payload: {
          personaId,
          name: name || "",
          description: description || "",
          systemPrompt: systemPrompt || "",
          runtime: runtime || "",
          model: model || "",
          maxTurns: maxTurns || 0,
          type: type || "",
          script: script || "",
        },
      });
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
