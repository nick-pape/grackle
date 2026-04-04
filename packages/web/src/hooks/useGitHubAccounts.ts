/**
 * Domain hook for GitHub account management.
 *
 * Uses ConnectRPC for CRUD operations on registered GitHub accounts.
 * Domain events (github_account.changed) from the event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { GitHubAccountData, UseGitHubAccountsResult, GrackleEvent } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseGitHubAccountsResult } from "@grackle-ai/web-components";

/**
 * Hook that manages GitHub account state and CRUD actions via ConnectRPC.
 *
 * @returns GitHub account state, actions, and the domain hook lifecycle object.
 */
export function useGitHubAccounts(): UseGitHubAccountsResult {
  const [githubAccounts, setGitHubAccounts] = useState<GitHubAccountData[]>([]);
  const { loading: githubAccountsLoading, track: trackAccounts } = useLoadingState();

  const loadGitHubAccounts = useCallback(async () => {
    try {
      const resp = await trackAccounts(grackleClient.listGitHubAccounts({}));
      setGitHubAccounts(
        resp.accounts.map((a) => ({
          id: a.id,
          label: a.label,
          username: a.username,
          isDefault: a.isDefault,
          createdAt: a.createdAt,
        })),
      );
    } catch {
      // empty
    }
  }, [trackAccounts]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "github_account.changed") {
      loadGitHubAccounts().catch(() => {});
      return true;
    }
    return false;
  }, [loadGitHubAccounts]);

  const addGitHubAccount = useCallback(async (
    label: string,
    token: string,
    username: string,
    isDefault: boolean,
  ): Promise<void> => {
    const resp = await grackleClient.addGitHubAccount({ label, token, username, isDefault });
    setGitHubAccounts((prev) => {
      const cleared = resp.isDefault ? prev.map((a) => ({ ...a, isDefault: false })) : prev;
      return [...cleared, { id: resp.id, label: resp.label, username: resp.username, isDefault: resp.isDefault, createdAt: resp.createdAt }];
    });
  }, []);

  const updateGitHubAccount = useCallback(async (
    id: string,
    fields: { label?: string; token?: string; isDefault?: boolean },
  ): Promise<void> => {
    const resp = await grackleClient.updateGitHubAccount({ id, ...fields });
    setGitHubAccounts((prev) =>
      prev.map((a) =>
        a.id === resp.id
          ? { ...a, label: resp.label, username: resp.username, isDefault: resp.isDefault }
          : fields.isDefault ? { ...a, isDefault: false } : a,
      ),
    );
  }, []);

  const removeGitHubAccount = useCallback(async (id: string): Promise<void> => {
    await grackleClient.removeGitHubAccount({ id });
    setGitHubAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const importGitHubAccounts = useCallback(async (): Promise<{ imported: number; usernames: string[] }> => {
    const resp = await grackleClient.importGitHubAccounts({});
    if (resp.imported > 0) {
      await loadGitHubAccounts();
    }
    return { imported: resp.imported, usernames: resp.usernames };
  }, [loadGitHubAccounts]);

  const domainHook: DomainHook = {
    onConnect: () => loadGitHubAccounts(),
    onDisconnect: () => {},
    handleEvent,
  };

  return {
    githubAccounts,
    githubAccountsLoading,
    loadGitHubAccounts,
    addGitHubAccount,
    updateGitHubAccount,
    removeGitHubAccount,
    importGitHubAccounts,
    domainHook,
  };
}
