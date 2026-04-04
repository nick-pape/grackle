import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { EnvironmentEditPanel, useToast } from "@grackle-ai/web-components";

/** Page shown when adding a new environment. */
export function NewEnvironmentPage(): JSX.Element {
  const {
    environments: { environments, addEnvironment, updateEnvironment },
    codespaces: { codespaces, codespaceError, codespaceListError, codespaceCreating, listCodespaces, createCodespace },
    githubAccounts: { githubAccounts },
  } = useGrackle();
  const { showToast } = useToast();

  return (
    <EnvironmentEditPanel
      mode="new"
      environments={environments}
      githubAccounts={githubAccounts}
      onAddEnvironment={(name, type, cfg, accountId) => { addEnvironment(name, type, cfg, accountId).catch(() => {}); }}
      onUpdateEnvironment={(eid, fields) => { updateEnvironment(eid, fields).catch(() => {}); }}
      onListCodespaces={(accountId) => { listCodespaces(accountId).catch(() => {}); }}
      codespaces={codespaces}
      codespaceError={codespaceError}
      codespaceListError={codespaceListError}
      codespaceCreating={codespaceCreating}
      onCreateCodespace={(repo, machine) => { createCodespace(repo, machine).catch(() => {}); }}
      onShowToast={showToast}
    />
  );
}
