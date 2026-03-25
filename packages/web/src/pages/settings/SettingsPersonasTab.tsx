import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { PersonaManager } from "../../components/personas/PersonaManager.js";
import { NEW_PERSONA_URL, personaUrl, useAppNavigate } from "../../utils/navigation.js";

/** Settings tab wrapping the persona list. */
export function SettingsPersonasTab(): JSX.Element {
  const { personas, deletePersona, appDefaultPersonaId, setAppDefaultPersonaId } = useGrackle();
  const navigate = useAppNavigate();

  return (
    <PersonaManager
      personas={personas}
      appDefaultPersonaId={appDefaultPersonaId}
      onDeletePersona={(personaId) => {
        deletePersona(personaId).catch(() => {});
      }}
      onSetAppDefaultPersonaId={(personaId) => {
        setAppDefaultPersonaId(personaId).catch(() => {});
      }}
      onNavigateToNew={() => navigate(NEW_PERSONA_URL)}
      onNavigateToPersona={(id) => navigate(personaUrl(id))}
    />
  );
}
