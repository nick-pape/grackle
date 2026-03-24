import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { PersonaManager } from "../../components/personas/PersonaManager.js";

/** Settings tab wrapping the persona manager. */
export function SettingsPersonasTab(): JSX.Element {
  const { personas, createPersona, updatePersona, deletePersona, appDefaultPersonaId, setAppDefaultPersonaId } = useGrackle();

  return (
    <PersonaManager
      personas={personas}
      appDefaultPersonaId={appDefaultPersonaId}
      onCreatePersona={createPersona}
      onUpdatePersona={updatePersona}
      onDeletePersona={deletePersona}
      onSetAppDefaultPersonaId={setAppDefaultPersonaId}
    />
  );
}
