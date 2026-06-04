import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { EnvironmentEditPanel, useToast } from "@grackle-ai/web-components";

/** Page shown when adding a new environment. */
export function NewEnvironmentPage(): JSX.Element {
  const {
    environments: { addEnvironment },
    codespaces: {
      codespaces,
      codespaceError,
      codespaceListError,
      codespaceCreating,
      listCodespaces,
      createCodespace,
    },
    dockerContainers: { dockerContainers, dockerContainersError, listDockerContainers },
    githubAccounts: { githubAccounts },
  } = useGrackle();
  const { showToast } = useToast();

  return (
    <EnvironmentEditPanel
      githubAccounts={githubAccounts}
      onAddEnvironment={(name, type, cfg, accountId) => {
        addEnvironment(name, type, cfg, accountId).catch(() => {});
      }}
      onListCodespaces={(accountId) => {
        listCodespaces(accountId).catch(() => {});
      }}
      codespaces={codespaces}
      codespaceError={codespaceError}
      codespaceListError={codespaceListError}
      codespaceCreating={codespaceCreating}
      onCreateCodespace={(repo, machine) => {
        createCodespace(repo, machine).catch(() => {});
      }}
      onListDockerContainers={() => {
        listDockerContainers().catch(() => {});
      }}
      dockerContainers={dockerContainers}
      dockerContainersError={dockerContainersError}
      onShowToast={showToast}
    />
  );
}
