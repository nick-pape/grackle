import type { JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import {
  Breadcrumbs,
  buildPersonaLibraryBreadcrumbs,
  NEW_PERSONA_URL,
  PersonaManager,
  personaUrl,
  useAppNavigate,
  useToast,
} from "@grackle-ai/web-components";
import styles from "./PersonaLibraryPage.module.scss";

/** Top-level Persona Library page — list view with breadcrumbs. */
export function PersonaLibraryPage(): JSX.Element {
  const {
    personas: { personas, deletePersona },
    appDefaultPersonaId,
    setAppDefaultPersonaId,
  } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  return (
    <div className={styles.layout}>
      <Breadcrumbs segments={buildPersonaLibraryBreadcrumbs()} />
      <div className={styles.content}>
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
      </div>
    </div>
  );
}
