import { useState, useCallback, type JSX } from "react";
import type { ToastVariant } from "../../context/ToastContext.js";
import type { Codespace, DockerContainer, GitHubAccountData } from "../../hooks/types.js";
import { ENVIRONMENTS_URL, useAppNavigate } from "../../utils/navigation.js";
import { isPortValid, MIN_PORT, MAX_PORT } from "../../utils/environmentUtils.js";
import styles from "./EnvironmentEditPanel.module.scss";

/** Props for the EnvironmentEditPanel component. */
interface Props {
  /** All registered GitHub accounts for the account selector. */
  githubAccounts: GitHubAccountData[];
  /** Callback to add a new environment. */
  onAddEnvironment: (
    displayName: string,
    adapterType: string,
    adapterConfig?: Record<string, unknown>,
    githubAccountId?: string,
  ) => void;
  /** Callback to list available codespaces, optionally filtered by GitHub account. */
  onListCodespaces: (githubAccountId?: string) => void;
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
  /** Callback to list running Docker containers available to attach to. */
  onListDockerContainers: () => void;
  /** Running Docker containers available to attach to (docker attach mode). */
  dockerContainers: DockerContainer[];
  /** Non-fatal error from listing Docker containers (e.g. docker CLI unavailable). */
  dockerContainersError: string;
  /** Display a toast notification. */
  onShowToast?: (message: string, variant?: ToastVariant) => void;
}

// ─── Codespace Picker ─────────────────────────────────────────────────────────

interface CodespacePickerProps {
  codespaceName: string;
  onCodespaceNameChange: (name: string) => void;
  envName: string;
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

/** Codespace picker subcomponent — pick an existing or create a new codespace. */
function CodespacePicker({
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

// ─── Main component ───────────────────────────────────────────────────────────

/** Full-panel create form for new environments. */
export function EnvironmentEditPanel({
  githubAccounts,
  onAddEnvironment,
  onListCodespaces,
  codespaces,
  codespaceError,
  codespaceListError,
  codespaceCreating,
  onCreateCodespace,
  onListDockerContainers,
  dockerContainers,
  dockerContainersError,
  onShowToast,
}: Props): JSX.Element {
  const navigate = useAppNavigate();

  // ─── Create mode state ─────────────────────────────

  const [envName, setEnvName] = useState("");
  const [adapterType, setAdapterType] = useState("local");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [image, setImage] = useState("");
  const [repo, setRepo] = useState("");
  const [codespaceName, setCodespaceName] = useState("");
  const [githubAccountId, setGithubAccountId] = useState("");
  // Docker: "create" a new container vs "attach" to an existing one (issue #1223).
  const [dockerMode, setDockerMode] = useState<"create" | "attach">("create");
  const [attachContainer, setAttachContainer] = useState("");

  // ─── Helpers ───────────────────────────────────────

  /** Build adapter config object from create-mode form state. */
  const buildCreateConfig = useCallback((): Record<string, unknown> => {
    const config: Record<string, unknown> = {};
    if (adapterType === "local") {
      if (host.trim()) {
        config.host = host.trim();
      }
      if (port.trim()) {
        const n = Number(port);
        if (Number.isInteger(n)) {
          config.port = n;
        }
      }
    } else if (adapterType === "ssh") {
      config.host = host.trim();
      if (user.trim()) {
        config.user = user.trim();
      }
      if (port.trim()) {
        const n = Number(port);
        if (Number.isInteger(n)) {
          config.sshPort = n;
        }
      }
      if (identityFile.trim()) {
        config.identityFile = identityFile.trim();
      }
    } else if (adapterType === "docker") {
      if (dockerMode === "attach") {
        // Attach mode: target an existing container; image/repo are ignored.
        if (attachContainer.trim()) {
          config.attach = attachContainer.trim();
        }
      } else {
        if (image.trim()) {
          config.image = image.trim();
        }
        if (repo.trim()) {
          config.repo = repo.trim();
        }
      }
    } else if (adapterType === "codespace") {
      config.codespaceName = codespaceName.trim();
    }
    return config;
  }, [
    adapterType,
    host,
    port,
    user,
    identityFile,
    image,
    repo,
    codespaceName,
    dockerMode,
    attachContainer,
  ]);

  const isCreateValid = (): boolean => {
    if (!envName.trim()) {
      return false;
    }
    if (adapterType === "ssh" && !host.trim()) {
      return false;
    }
    if (adapterType === "codespace" && !codespaceName.trim()) {
      return false;
    }
    if (adapterType === "docker" && dockerMode === "attach" && !attachContainer.trim()) {
      return false;
    }
    if ((adapterType === "local" || adapterType === "ssh") && !isPortValid(port)) {
      return false;
    }
    return true;
  };

  const handleCreate = (): void => {
    if (!isCreateValid()) {
      return;
    }
    onAddEnvironment(
      envName.trim(),
      adapterType,
      buildCreateConfig(),
      githubAccountId || undefined,
    );
    onShowToast?.("Environment added successfully", "success");
    navigate(ENVIRONMENTS_URL, { replace: true });
  };

  const handleCancel = (): void => {
    navigate(ENVIRONMENTS_URL);
  };

  // ─── Create mode ───────────────────────────────────

  return (
    <div className={styles.container} data-testid="env-create-panel">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.badge}>new environment</span>
        </div>
        <div className={styles.headerActions}>
          <button
            onClick={handleCreate}
            disabled={!isCreateValid()}
            className={styles.btnPrimary}
            data-testid="env-create-submit"
          >
            Create
          </button>
          <button onClick={handleCancel} className={styles.btnGhost}>
            Cancel
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className={styles.body}>
        <div className={styles.formContent}>
          {/* Name */}
          <div className={styles.section}>
            <label className={styles.label} htmlFor="env-create-name">
              Name
            </label>
            <input
              id="env-create-name"
              type="text"
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder="Environment name..."
              autoFocus
              className={styles.nameInput}
              data-testid="env-create-name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && isCreateValid()) {
                  handleCreate();
                }
              }}
            />
          </div>

          {/* Adapter Type */}
          <div className={styles.section}>
            <label className={styles.label} htmlFor="env-create-adapter">
              Adapter Type
            </label>
            <select
              id="env-create-adapter"
              value={adapterType}
              onChange={(e) => {
                setAdapterType(e.target.value);
                if (e.target.value === "codespace") {
                  onListCodespaces(githubAccountId || undefined);
                }
              }}
              className={styles.adapterSelect}
              data-testid="env-create-adapter"
            >
              <option value="local">local</option>
              <option value="ssh">ssh</option>
              <option value="docker">docker</option>
              <option value="codespace">codespace</option>
            </select>
          </div>

          {/* GitHub Account (codespace and docker only) */}
          {(adapterType === "codespace" || adapterType === "docker") &&
            githubAccounts.length > 0 && (
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-github-account">
                  GitHub Account
                </label>
                <select
                  id="env-create-github-account"
                  value={githubAccountId}
                  onChange={(e) => {
                    setGithubAccountId(e.target.value);
                    if (adapterType === "codespace") {
                      onListCodespaces(e.target.value || undefined);
                    }
                  }}
                  className={styles.adapterSelect}
                  data-testid="env-create-github-account"
                >
                  <option value="">(Default)</option>
                  {githubAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} (@{a.username}){a.isDefault ? " — default" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

          {/* Adapter-specific fields */}
          {adapterType === "local" && (
            <>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-host">
                  Host
                </label>
                <input
                  id="env-create-host"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="Host (optional)..."
                  className={styles.fieldInput}
                  data-testid="env-create-host"
                />
              </div>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-port">
                  Port
                </label>
                <input
                  id="env-create-port"
                  type="number"
                  min={MIN_PORT}
                  max={MAX_PORT}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="Port (optional)..."
                  className={styles.fieldInput}
                  data-testid="env-create-port"
                />
              </div>
            </>
          )}

          {adapterType === "ssh" && (
            <>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-host">
                  Host
                </label>
                <input
                  id="env-create-host"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="Host (required)..."
                  className={styles.fieldInput}
                  data-testid="env-create-host"
                />
              </div>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-user">
                  User
                </label>
                <input
                  id="env-create-user"
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="User (optional)..."
                  className={styles.fieldInput}
                  data-testid="env-create-user"
                />
              </div>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-port">
                  SSH Port
                </label>
                <input
                  id="env-create-port"
                  type="number"
                  min={MIN_PORT}
                  max={MAX_PORT}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="SSH port (optional)..."
                  className={styles.fieldInput}
                  data-testid="env-create-port"
                />
              </div>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-create-identity">
                  Identity File
                </label>
                <input
                  id="env-create-identity"
                  type="text"
                  value={identityFile}
                  onChange={(e) => setIdentityFile(e.target.value)}
                  placeholder="Identity file (optional)..."
                  className={styles.fieldInput}
                  data-testid="env-create-identity"
                />
              </div>
            </>
          )}

          {adapterType === "docker" && (
            <>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="env-docker-mode">
                  Source
                </label>
                <select
                  id="env-docker-mode"
                  value={dockerMode}
                  onChange={(e) => {
                    const next = e.target.value as "create" | "attach";
                    setDockerMode(next);
                    if (next === "attach") {
                      onListDockerContainers();
                    }
                  }}
                  className={styles.adapterSelect}
                  data-testid="env-docker-mode"
                >
                  <option value="create">Create new container</option>
                  <option value="attach">Attach to existing container</option>
                </select>
              </div>

              {dockerMode === "create" ? (
                <>
                  <div className={styles.section}>
                    <label className={styles.label} htmlFor="env-create-image">
                      Image
                    </label>
                    <input
                      id="env-create-image"
                      type="text"
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      placeholder="Image (optional)..."
                      className={styles.fieldInput}
                      data-testid="env-create-image"
                    />
                  </div>
                  <div className={styles.section}>
                    <label className={styles.label} htmlFor="env-create-repo">
                      Repo
                    </label>
                    <input
                      id="env-create-repo"
                      type="text"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      placeholder="Repo (optional)..."
                      className={styles.fieldInput}
                      data-testid="env-create-repo"
                    />
                  </div>
                </>
              ) : (
                <div className={styles.section}>
                  <label className={styles.label}>Container</label>
                  {!dockerContainersError && dockerContainers.length > 0 && (
                    <select
                      value={attachContainer}
                      onChange={(e) => {
                        setAttachContainer(e.target.value);
                        if (e.target.value && !envName.trim()) {
                          setEnvName(e.target.value);
                        }
                      }}
                      className={styles.adapterSelect}
                      data-testid="env-docker-container-select"
                    >
                      <option value="">Select a container...</option>
                      {dockerContainers.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name} ({c.image}) {c.status}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Manual entry fallback: shown on listing error OR when no running
                      containers were found, so the user is never stuck with an empty picker. */}
                  {(dockerContainersError || dockerContainers.length === 0) && (
                    <>
                      {dockerContainersError ? (
                        <span className={styles.errorHint}>{dockerContainersError}</span>
                      ) : (
                        <span className={styles.creatingHint}>No running containers found.</span>
                      )}
                      <input
                        type="text"
                        value={attachContainer}
                        onChange={(e) => {
                          setAttachContainer(e.target.value);
                          if (e.target.value && !envName.trim()) {
                            setEnvName(e.target.value);
                          }
                        }}
                        placeholder="Enter container name/ID..."
                        className={styles.fieldInput}
                        data-testid="env-docker-container-manual"
                      />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {adapterType === "codespace" && (
            <CodespacePicker
              codespaceName={codespaceName}
              onCodespaceNameChange={setCodespaceName}
              envName={envName}
              onEnvNameChange={setEnvName}
              codespaces={codespaces}
              codespaceError={codespaceError}
              codespaceListError={codespaceListError}
              codespaceCreating={codespaceCreating}
              onCreateCodespace={onCreateCodespace}
            />
          )}
        </div>
      </div>
    </div>
  );
}
