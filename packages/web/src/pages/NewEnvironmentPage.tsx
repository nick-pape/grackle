import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { EnvironmentEditPanel } from "../components/panels/EnvironmentEditPanel.js";

/** Page shown when adding a new environment. */
export function NewEnvironmentPage(): JSX.Element {
  const {
    environments, addEnvironment, updateEnvironment, listCodespaces,
    codespaces, codespaceError, codespaceListError, codespaceCreating, createCodespace,
  } = useGrackle();

  return (
    <EnvironmentEditPanel
      mode="new"
      environments={environments}
      onAddEnvironment={addEnvironment}
      onUpdateEnvironment={updateEnvironment}
      onListCodespaces={listCodespaces}
      codespaces={codespaces}
      codespaceError={codespaceError}
      codespaceListError={codespaceListError}
      codespaceCreating={codespaceCreating}
      onCreateCodespace={createCodespace}
    />
  );
}
