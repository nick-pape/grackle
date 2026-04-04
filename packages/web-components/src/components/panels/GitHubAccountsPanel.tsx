import { useState, type JSX, type FormEvent } from "react";
import { X, Star } from "lucide-react";
import type { ToastVariant } from "../../context/ToastContext.js";
import type { GitHubAccountData } from "../../hooks/types.js";
import { ICON_MD } from "../../utils/iconSize.js";
import { ConfirmDialog } from "../display/index.js";
import styles from "./SettingsPanel.module.scss";

/** Props for the GitHubAccountsPanel component. */
export interface GitHubAccountsPanelProps {
  /** All registered GitHub accounts. */
  githubAccounts: GitHubAccountData[];
  /** Whether the account list is loading. */
  githubAccountsLoading: boolean;
  /** Register a new GitHub account. Username will be resolved server-side if empty. */
  onAddGitHubAccount: (label: string, token: string, username: string, isDefault: boolean) => Promise<void>;
  /** Update an existing GitHub account. */
  onUpdateGitHubAccount: (id: string, fields: { label?: string; token?: string; isDefault?: boolean }) => Promise<void>;
  /** Remove a GitHub account by ID. */
  onRemoveGitHubAccount: (id: string) => Promise<void>;
  /** Import accounts from the local gh CLI authentication state. */
  onImportGitHubAccounts: () => Promise<{ imported: number; usernames: string[] }>;
  /** Display a toast notification. */
  onShowToast?: (message: string, variant?: ToastVariant) => void;
}

/** Settings panel for managing registered GitHub accounts. */
export function GitHubAccountsPanel({
  githubAccounts,
  githubAccountsLoading,
  onAddGitHubAccount,
  onUpdateGitHubAccount,
  onRemoveGitHubAccount,
  onImportGitHubAccounts,
  onShowToast,
}: GitHubAccountsPanelProps): JSX.Element {

  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const confirmRemoveAccount = githubAccounts.find((a) => a.id === confirmRemoveId);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!label.trim() || !token.trim()) {
      return;
    }
    setAdding(true);
    try {
      await onAddGitHubAccount(label.trim(), token.trim(), "", isDefault);
      onShowToast?.("GitHub account added", "success");
      setLabel("");
      setToken("");
      setIsDefault(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add account";
      onShowToast?.(msg, "error");
    } finally {
      setAdding(false);
    }
  };

  const handleSetDefault = async (id: string): Promise<void> => {
    try {
      await onUpdateGitHubAccount(id, { isDefault: true });
      onShowToast?.("Default account updated", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update account";
      onShowToast?.(msg, "error");
    }
  };

  const handleConfirmRemove = async (): Promise<void> => {
    if (!confirmRemoveId) {
      return;
    }
    try {
      await onRemoveGitHubAccount(confirmRemoveId);
      onShowToast?.("GitHub account removed", "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove account";
      onShowToast?.(msg, "error");
    } finally {
      setConfirmRemoveId(null);
    }
  };

  const handleImport = async (): Promise<void> => {
    setImporting(true);
    try {
      const result = await onImportGitHubAccounts();
      if (result.imported > 0) {
        onShowToast?.(`Imported ${result.imported} account(s): ${result.usernames.join(", ")}`, "success");
      } else {
        onShowToast?.("No new accounts to import", "info");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      onShowToast?.(msg, "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <ConfirmDialog
        isOpen={confirmRemoveId !== null}
        title="Remove GitHub Account?"
        description={
          confirmRemoveAccount
            ? `"${confirmRemoveAccount.label}" (@${confirmRemoveAccount.username}) will be permanently removed.`
            : undefined
        }
        onConfirm={() => { handleConfirmRemove().catch(() => {}); }}
        onCancel={() => setConfirmRemoveId(null)}
      />

      <section className={styles.section} data-testid="github-accounts-panel">
        <h3 className={styles.sectionTitle}>GitHub Accounts</h3>
        <p className={styles.sectionDescription}>
          Register multiple GitHub accounts to use different identities per environment.
          The default account is used when no specific account is assigned.
        </p>

        {githubAccountsLoading && githubAccounts.length === 0 ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : githubAccounts.length === 0 ? (
          <div className={styles.emptyStateInfo}>
            No GitHub accounts registered. Add one below or import from the gh CLI.
          </div>
        ) : (
          <div className={styles.tokenList}>
            {githubAccounts.map((account) => (
              <div key={account.id} className={styles.tokenRow} data-testid={`github-account-row-${account.id}`}>
                {account.isDefault && (
                  <span className={styles.tokenBadge} title="Default account">default</span>
                )}
                <span className={styles.tokenName}>{account.label}</span>
                <span className={styles.tokenTarget}>@{account.username}</span>
                {!account.isDefault && (
                  <button
                    className={styles.deleteButton}
                    onClick={() => { handleSetDefault(account.id).catch(() => {}); }}
                    title="Set as default"
                    aria-label={`Set ${account.label} as default`}
                    data-testid={`github-account-set-default-${account.id}`}
                  >
                    <Star size={ICON_MD} aria-hidden="true" />
                  </button>
                )}
                <button
                  className={styles.deleteButton}
                  onClick={() => setConfirmRemoveId(account.id)}
                  title={`Remove ${account.label}`}
                  aria-label={`Remove ${account.label}`}
                  data-testid={`github-account-remove-${account.id}`}
                >
                  <X size={ICON_MD} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form className={styles.addForm} onSubmit={(e) => { handleSubmit(e).catch(() => {}); }}>
          <div className={styles.formRow}>
            <input
              className={styles.input}
              type="text"
              placeholder="Label (e.g. personal, work)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="github-account-label-input"
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Personal access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="github-account-token-input"
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.tokenTarget} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                data-testid="github-account-default-checkbox"
              />
              Set as default
            </label>
            <button
              className={styles.addButton}
              type="submit"
              disabled={!label.trim() || !token.trim() || adding}
              data-testid="github-account-add-button"
            >
              {adding ? "Adding..." : "Add Account"}
            </button>
            <button
              className={styles.addButton}
              type="button"
              onClick={() => { handleImport().catch(() => {}); }}
              disabled={importing}
              data-testid="github-account-import-button"
            >
              {importing ? "Importing..." : "Import from gh CLI"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
