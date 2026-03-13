import { useState, type JSX, type FormEvent } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { ConfirmDialog } from "../display/index.js";
import { EnvironmentList } from "../lists/EnvironmentList.js";
import type { ViewMode } from "../../App.js";
import styles from "./SettingsPanel.module.scss";

/** Token type options for the add form. */
const TOKEN_TYPES: Array<{ value: string; label: string }> = [
  { value: "env_var", label: "Environment Variable" },
  { value: "file", label: "File" },
];

/** Props for the SettingsPanel component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

/** Settings page with environment management, token management, and other configuration. */
export function SettingsPanel({ viewMode, setViewMode }: Props): JSX.Element {
  const { tokens, setToken, deleteToken } = useGrackle();

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
    setToken(name, value, tokenType, envVar, filePath);
    setName("");
    setValue("");
    setTarget("");
  };

  const handleDelete = (tokenName: string): void => {
    setConfirmDeleteToken(tokenName);
  };

  const handleConfirmDelete = (): void => {
    if (confirmDeleteToken) {
      deleteToken(confirmDeleteToken);
    }
    setConfirmDeleteToken(null);
  };

  return (
    <div className={styles.container}>
      <ConfirmDialog
        isOpen={confirmDeleteToken !== null}
        title="Delete Token?"
        description={confirmDeleteToken ? `"${confirmDeleteToken}" will be permanently removed.` : undefined}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteToken(null)}
      />
      <h2 className={styles.heading}>Settings</h2>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Environments</h3>
        <p className={styles.sectionDescription}>
          Environments are compute workspaces where agents run. Configure once, reuse across projects.
        </p>
        <EnvironmentList viewMode={viewMode} setViewMode={setViewMode} />
      </section>

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
    </div>
  );
}
