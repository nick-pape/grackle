import { useState, type JSX } from "react";
import type { Codespace } from "../../hooks/types.js";
import styles from "./EnvironmentEditPanel.module.scss";

/** Props for the CodespacePicker component. */
export interface CodespacePickerProps {
  /** Currently selected codespace name. */
  codespaceName: string;
  /** Called when the codespace name changes. */
  onCodespaceNameChange: (name: string) => void;
  /** Current environment name (used for auto-fill). */
  envName: string;
  /** Called when the environment name should be auto-filled from the codespace. */
  onEnvNameChange: (name: string) => void;
  /** Available codespaces. */
  codespaces: Codespace[];
  /** Error from codespace operations. */
  codespaceError: string;
  /** Error from listing codespaces. */
  codespaceListError: string;
  /** Whether a codespace is being created. */
  codespaceCreating: boolean;
  /** Callback to create a new codespace. */
  onCreateCodespace: (repo: string, machine?: string) => void;
}

/** Pick an existing codespace or create a new one from a repository. */
export function CodespacePicker({
  codespaceName,
  onCodespaceNameChange,
  envName,
  onEnvNameChange,
  codespaces,
  codespaceError,
  codespaceListError,
  codespaceCreating,
  onCreateCodespace,
}: CodespacePickerProps): JSX.Element {
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [createRepo, setCreateRepo] = useState("");
  const [createMachine, setCreateMachine] = useState("");

  if (mode === "create") {
    return (
      <div className={styles.codespaceSection}>
        <div className={styles.section}>
          <label className={styles.label}>Repository</label>
          <input
            type="text"
            value={createRepo}
            onChange={(e) => setCreateRepo(e.target.value)}
            placeholder="owner/repo"
            className={styles.fieldInput}
            data-testid="env-codespace-repo"
          />
        </div>
        <div className={styles.section}>
          <label className={styles.label}>Machine Type</label>
          <input
            type="text"
            value={createMachine}
            onChange={(e) => setCreateMachine(e.target.value)}
            placeholder="Machine type (optional)..."
            className={styles.fieldInput}
            data-testid="env-codespace-machine"
          />
        </div>
        <div className={styles.codespaceActions}>
          <button
            onClick={() => {
              if (createRepo.trim()) {
                onCreateCodespace(createRepo.trim(), createMachine.trim() || undefined);
                setMode("pick");
                setCreateRepo("");
                setCreateMachine("");
              }
            }}
            disabled={!createRepo.trim()}
            className={styles.btnPrimary}
          >
            Create
          </button>
          <button
            onClick={() => {
              setMode("pick");
              setCreateRepo("");
              setCreateMachine("");
            }}
            className={styles.btnGhost}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.codespaceSection}>
      <div className={styles.section}>
        <label className={styles.label}>Codespace</label>
        {!codespaceListError && (
          <select
            value={codespaceName}
            onChange={(e) => {
              if (e.target.value === "__create__") {
                setMode("create");
                onCodespaceNameChange("");
              } else {
                onCodespaceNameChange(e.target.value);
                if (e.target.value && !envName.trim()) {
                  onEnvNameChange(e.target.value);
                }
              }
            }}
            disabled={codespaceCreating}
            className={styles.adapterSelect}
            data-testid="env-codespace-select"
          >
            <option value="">Select a codespace...</option>
            {codespaces.map((cs) => (
              <option key={cs.name} value={cs.name}>
                {cs.name} ({cs.repository}) — {cs.state}
              </option>
            ))}
            <option value="__create__">Create new from repo...</option>
          </select>
        )}
        {codespaceCreating && <span className={styles.creatingHint}>Creating codespace...</span>}
        {codespaceListError && (
          <>
            <span className={styles.errorHint}>{codespaceListError}</span>
            <input
              type="text"
              value={codespaceName}
              onChange={(e) => onCodespaceNameChange(e.target.value)}
              placeholder="Or enter codespace name manually..."
              className={styles.fieldInput}
              data-testid="env-codespace-manual"
            />
          </>
        )}
        {codespaceError && !codespaceListError && (
          <span className={styles.errorHint}>{codespaceError}</span>
        )}
      </div>
    </div>
  );
}
