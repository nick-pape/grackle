import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { PersonaManager } from "../../components/personas/PersonaManager.js";
import { NEW_PERSONA_URL, personaUrl, useAppNavigate } from "../../utils/navigation.js";

/** Settings tab wrapping the persona list. */
export function SettingsPersonasTab(): JSX.Element {
  const { personas, deletePersona, appDefaultPersonaId, setAppDefaultPersonaId } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  return (
    <PersonaManager
      personas={personas}
      appDefaultPersonaId={appDefaultPersonaId}
      onDeletePersona={async (personaId) => {
        try {
          await deletePersona(personaId);
        } catch (error) {
          console.error("Failed to delete persona", { personaId, error });
          showToast("Failed to delete persona", "error");
          throw error;
        }
      }}
      onSetAppDefaultPersonaId={async (personaId) => {
        try {
          await setAppDefaultPersonaId(personaId);
        } catch (error) {
          console.error("Failed to set app default persona ID", { personaId, error });
          showToast("Failed to set app default persona", "error");
        }
      }}
      onNavigateToNew={() => navigate(NEW_PERSONA_URL)}
      onNavigateToPersona={(id) => navigate(personaUrl(id))}
    />
  );
}
