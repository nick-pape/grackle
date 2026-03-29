import { type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { EnvironmentEditPanel, useToast } from "@grackle-ai/web-components";

/** Page shown when editing an existing environment. */
export function EnvironmentEditPage(): JSX.Element {
  const { environmentId } = useParams<{ environmentId: string }>();
  const {
    environments: { environments, addEnvironment, updateEnvironment },
    codespaces: { codespaces, codespaceError, codespaceListError, codespaceCreating, listCodespaces, createCodespace },
  } = useGrackle();
  const { showToast } = useToast();

  return (
    <EnvironmentEditPanel
      mode="edit"
      environmentId={environmentId!}
      environments={environments}
      onAddEnvironment={(name, type, cfg) => { addEnvironment(name, type, cfg).catch(() => {}); }}
      onUpdateEnvironment={(eid, fields) => { updateEnvironment(eid, fields).catch(() => {}); }}
      onListCodespaces={() => { listCodespaces().catch(() => {}); }}
      codespaces={codespaces}
      codespaceError={codespaceError}
      codespaceListError={codespaceListError}
      codespaceCreating={codespaceCreating}
      onCreateCodespace={(repo, machine) => { createCodespace(repo, machine).catch(() => {}); }}
      onShowToast={showToast}
    />
  );
}
