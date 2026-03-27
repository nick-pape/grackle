import { type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { useToast } from "../context/ToastContext.js";
import { EnvironmentEditPanel } from "../components/panels/EnvironmentEditPanel.js";

/** Page shown when editing an existing environment. */
export function EnvironmentEditPage(): JSX.Element {
  const { environmentId } = useParams<{ environmentId: string }>();
  const {
    environments, addEnvironment, updateEnvironment, listCodespaces,
    codespaces, codespaceError, codespaceListError, codespaceCreating, createCodespace,
  } = useGrackle();
  const { showToast } = useToast();

  return (
    <EnvironmentEditPanel
      mode="edit"
      environmentId={environmentId!}
      environments={environments}
      onAddEnvironment={addEnvironment}
      onUpdateEnvironment={updateEnvironment}
      onListCodespaces={listCodespaces}
      codespaces={codespaces}
      codespaceError={codespaceError}
      codespaceListError={codespaceListError}
      codespaceCreating={codespaceCreating}
      onCreateCodespace={createCodespace}
      onShowToast={showToast}
    />
  );
}
