import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { GitHubAccountsPanel, useToast } from "@grackle-ai/web-components";

/** Settings tab for managing registered GitHub accounts. */
export function SettingsGitHubAccountsTab(): JSX.Element {
  const { githubAccounts: { githubAccounts, githubAccountsLoading, addGitHubAccount, updateGitHubAccount, removeGitHubAccount, importGitHubAccounts } } = useGrackle();
  const { showToast } = useToast();

  return (
    <GitHubAccountsPanel
      githubAccounts={githubAccounts}
      githubAccountsLoading={githubAccountsLoading}
      onAddGitHubAccount={addGitHubAccount}
      onUpdateGitHubAccount={updateGitHubAccount}
      onRemoveGitHubAccount={removeGitHubAccount}
      onImportGitHubAccounts={importGitHubAccounts}
      onShowToast={showToast}
    />
  );
}
