import { useState, type JSX, type FormEvent } from "react";
import type { ToastVariant } from "../../context/ToastContext.js";
import type { TokenInfo } from "../../hooks/types.js";
import { ConfirmDialog } from "../display/index.js";
import styles from "./SettingsPanel.module.scss";

/** Token type options for the add form. */
const TOKEN_TYPES: Array<{ value: string; label: string }> = [
  { value: "env_var", label: "Environment Variable" },
  { value: "file", label: "File" },
];

/** Props for the TokensPanel component. */
interface TokensPanelProps {
  /** List of stored token metadata. */
  tokens: TokenInfo[];
  /** Stores or updates a token. */
  onSetToken: (name: string, value: string, tokenType: string, envVar: string, filePath: string) => void;
  /** Deletes a token by name. */
  onDeleteToken: (name: string) => void;
  /** Display a toast notification. */
  onShowToast: (message: string, variant?: ToastVariant) => void;
}

/** Token management panel with list, add form, and delete confirmation. */
export function TokensPanel({ tokens, onSetToken, onDeleteToken, onShowToast }: TokensPanelProps): JSX.Element {

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [tokenType, setTokenType] = useState("env_var");
  const [target, setTarget] = useState("");
  const [confirmDeleteToken, setConfirmDeleteToken] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name || !value) {
      return;
    }
    const envVar = tokenType === "env_var" ? (target || name.toUpperCase() + "_TOKEN") : "";
    const filePath = tokenType === "file" ? target : "";
    onSetToken(name, value, tokenType, envVar, filePath);
    onShowToast("Token saved successfully", "success");
    setName("");
    setValue("");
    setTarget("");
  };

  const handleDelete = (tokenName: string): void => {
    setConfirmDeleteToken(tokenName);
  };

  const handleConfirmDelete = (): void => {
    if (confirmDeleteToken) {
      onDeleteToken(confirmDeleteToken);
      onShowToast("Token deleted", "info");
    }
    setConfirmDeleteToken(null);
  };

  return (
    <>
      <ConfirmDialog
        isOpen={confirmDeleteToken !== null}
        title="Delete Token?"
        description={confirmDeleteToken ? `"${confirmDeleteToken}" will be permanently removed.` : undefined}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteToken(null)}
      />
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Tokens</h3>
        <p className={styles.sectionDescription}>
          API tokens are auto-pushed to environments when set or updated. Values are write-only.
        </p>

        {tokens.length === 0 ? (
          <div className={styles.emptyStateInfo}>Add your first API token to enable service integrations.</div>
        ) : (
          <div className={styles.tokenList}>
            {tokens.map((t) => (
              <div key={t.name} className={styles.tokenRow}>
                <span className={styles.tokenBadge}>{t.tokenType}</span>
                <span className={styles.tokenName}>{t.name}</span>
                <span className={styles.tokenTarget}>
                  {t.tokenType === "env_var" ? t.envVar : t.filePath}
                </span>
                <button
                  className={styles.deleteButton}
                  onClick={() => handleDelete(t.name)}
                  title={`Delete ${t.name}`}
                >
                  {"\u00D7"}
                </button>
              </div>
            ))}
          </div>
        )}

        <form className={styles.addForm} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <input
              className={styles.input}
              type="text"
              placeholder="Token name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <select
              className={styles.select}
              value={tokenType}
              onChange={(e) => setTokenType(e.target.value)}
            >
              {TOKEN_TYPES.map((tt) => (
                <option key={tt.value} value={tt.value}>{tt.label}</option>
              ))}
            </select>
            <input
              className={styles.input}
              type="text"
              placeholder={tokenType === "env_var" ? "Env var name (e.g. API_TOKEN)" : "File path (e.g. /home/user/.token)"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <button className={styles.addButton} type="submit">
              Add Token
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
