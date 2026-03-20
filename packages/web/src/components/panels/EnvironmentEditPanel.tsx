import { useState, useCallback, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { SETTINGS_ENVIRONMENTS_URL, useAppNavigate } from "../../utils/navigation.js";
import { EditableTextField } from "../editable/EditableTextField.js";
import styles from "./EnvironmentEditPanel.module.scss";

/** Minimum valid network port. */
const MIN_PORT: number = 1;
/** Maximum valid network port. */
const MAX_PORT: number = 65535;

/** Props for the EnvironmentEditPanel component. */
interface Props {
  mode: "new" | "edit";
  /** Environment ID — required in edit mode. */
  environmentId?: string;
}

/** Returns true if portStr is empty (optional) or a valid integer in [1, 65535]. */
function isPortValid(portStr: string): boolean {
  if (!portStr.trim()) {
    return true;
  }
  const n = Number(portStr);
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT;
}

/** Parse adapter config JSON string into a record, defaulting to empty object. */
function parseAdapterConfig(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

// ─── Codespace Picker ─────────────────────────────────────────────────────────

interface CodespacePickerProps {
  codespaceName: string;
  onCodespaceNameChange: (name: string) => void;
  envName: string;
  onEnvNameChange: (name: string) => void;
}

/** Codespace picker subcomponent — pick an existing or create a new codespace. */
function CodespacePicker({ codespaceName, onCodespaceNameChange, envName, onEnvNameChange }: CodespacePickerProps): JSX.Element {
  const {
    codespaces, codespaceError, codespaceListError, codespaceCreating,
    createCodespace,
  } = useGrackle();

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
                createCodespace(createRepo.trim(), createMachine.trim() || undefined);
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
            onClick={() => { setMode("pick"); setCreateRepo(""); setCreateMachine(""); }}
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
        {codespaceCreating && (
          <span className={styles.creatingHint}>Creating codespace...</span>
        )}
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

/**
 * Full-panel create/edit form for environments.
 *
 * - new: blank form; calls addEnvironment on save, then navigates to settings.
 * - edit: pre-populated form; uses click-to-edit fields that auto-save via
 *         updateEnvironment.
 */
export function EnvironmentEditPanel({ mode, environmentId }: Props): JSX.Element {
  const {
    environments, addEnvironment, updateEnvironment, listCodespaces,
  } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  const isEdit = mode === "edit";
  const existingEnv = isEdit && environmentId
    ? environments.find((e) => e.id === environmentId)
    : undefined;

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

  // ─── Edit mode state ───────────────────────────────

  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

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
      if (image.trim()) {
        config.image = image.trim();
      }
      if (repo.trim()) {
        config.repo = repo.trim();
      }
    } else if (adapterType === "codespace") {
      config.codespaceName = codespaceName.trim();
    }
    return config;
  }, [adapterType, host, port, user, identityFile, image, repo, codespaceName]);

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
    if ((adapterType === "local" || adapterType === "ssh") && !isPortValid(port)) {
      return false;
    }
    return true;
  };

  const handleCreate = (): void => {
    if (!isCreateValid()) {
      return;
    }
    addEnvironment(envName.trim(), adapterType, buildCreateConfig());
    showToast("Environment added successfully", "success");
    navigate(SETTINGS_ENVIRONMENTS_URL, { replace: true });
  };

  const handleCancel = (): void => {
    navigate(SETTINGS_ENVIRONMENTS_URL);
  };

  /** Save a single config field in edit mode by merging into existing adapterConfig. */
  const saveConfigField = useCallback(
    (fieldName: string, value: string) => {
      if (!existingEnv || !environmentId) {
        return;
      }
      const current = parseAdapterConfig(existingEnv.adapterConfig);
      const trimmed = value.trim();
      if (trimmed) {
        current[fieldName] = trimmed;
      } else {
        delete current[fieldName];
      }
      updateEnvironment(environmentId, { adapterConfig: current });
    },
    [existingEnv, environmentId, updateEnvironment],
  );

  /** Save a numeric config field in edit mode. */
  const saveConfigNumberField = useCallback(
    (fieldName: string, value: string) => {
      if (!existingEnv || !environmentId) {
        return;
      }
      const current = parseAdapterConfig(existingEnv.adapterConfig);
      if (value.trim()) {
        const n = Number(value);
        if (Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT) {
          current[fieldName] = n;
        }
      } else {
        delete current[fieldName];
      }
      updateEnvironment(environmentId, { adapterConfig: current });
    },
    [existingEnv, environmentId, updateEnvironment],
  );

  // ─── Edit mode ─────────────────────────────────────

  if (isEdit) {
    if (!existingEnv) {
      return (
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.headerTitle}>
              <span className={styles.badge}>edit environment</span>
            </div>
            <div className={styles.headerActions}>
              <button onClick={handleCancel} className={styles.btnGhost}>Back</button>
            </div>
          </div>
          <div className={styles.body}>
            <div className={styles.formContent}>
              <span className={styles.readOnlyValue}>Environment not found</span>
            </div>
          </div>
        </div>
      );
    }

    const config = parseAdapterConfig(existingEnv.adapterConfig);

    return (
      <div className={styles.container} data-testid="env-edit-panel">
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.badge}>edit environment</span>
          </div>
          <div className={styles.headerActions}>
            <button onClick={handleCancel} className={styles.btnGhost} data-testid="env-edit-back">Back</button>
          </div>
        </div>

        {/* Form body */}
        <div className={styles.body}>
          <div className={styles.formContent}>
            {/* Name */}
            <div className={styles.section}>
              <label className={styles.label}>Name</label>
              <EditableTextField
                value={existingEnv.displayName}
                onSave={(value) => {
                  if (environmentId) {
                    updateEnvironment(environmentId, { displayName: value });
                  }
                }}
                validate={(v) => v.trim() === "" ? "Name cannot be empty" : undefined}
                mode="edit"
                fieldId="name"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="Environment name"
                ariaLabel="Environment name"
                data-testid="env-edit-name"
              />
            </div>

            {/* Adapter Type (read-only) */}
            <div className={styles.section}>
              <label className={styles.label}>Adapter Type</label>
              <span className={styles.readOnlyValue} data-testid="env-edit-adapter-type">
                {existingEnv.adapterType}
              </span>
            </div>

            {/* Adapter-specific editable fields */}
            {existingEnv.adapterType === "local" && (
              <>
                <div className={styles.section}>
                  <label className={styles.label}>Host</label>
                  <EditableTextField
                    value={String(config.host ?? "")}
                    onSave={(v) => saveConfigField("host", v)}
                    mode="edit"
                    fieldId="host"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="(default)"
                    ariaLabel="Host"
                    data-testid="env-edit-host"
                  />
                </div>
                <div className={styles.section}>
                  <label className={styles.label}>Port</label>
                  <EditableTextField
                    value={String(config.port ?? "")}
                    onSave={(v) => saveConfigNumberField("port", v)}
                    validate={(v) => !isPortValid(v) ? "Port must be 1-65535" : undefined}
                    mode="edit"
                    fieldId="port"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="(default)"
                    ariaLabel="Port"
                    data-testid="env-edit-port"
                  />
                </div>
              </>
            )}

            {existingEnv.adapterType === "ssh" && (
              <>
                <div className={styles.section}>
                  <label className={styles.label}>Host</label>
                  <EditableTextField
                    value={String(config.host ?? "")}
                    onSave={(v) => saveConfigField("host", v)}
                    validate={(v) => v.trim() === "" ? "Host is required" : undefined}
                    mode="edit"
                    fieldId="host"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="hostname or IP"
                    ariaLabel="Host"
                    data-testid="env-edit-host"
                  />
                </div>
                <div className={styles.section}>
                  <label className={styles.label}>User</label>
                  <EditableTextField
                    value={String(config.user ?? "")}
                    onSave={(v) => saveConfigField("user", v)}
                    mode="edit"
                    fieldId="user"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="(default)"
                    ariaLabel="User"
                    data-testid="env-edit-user"
                  />
                </div>
                <div className={styles.section}>
                  <label className={styles.label}>SSH Port</label>
                  <EditableTextField
                    value={String(config.sshPort ?? "")}
                    onSave={(v) => saveConfigNumberField("sshPort", v)}
                    validate={(v) => !isPortValid(v) ? "Port must be 1-65535" : undefined}
                    mode="edit"
                    fieldId="sshPort"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="22"
                    ariaLabel="SSH Port"
                    data-testid="env-edit-ssh-port"
                  />
                </div>
                <div className={styles.section}>
                  <label className={styles.label}>Identity File</label>
                  <EditableTextField
                    value={String(config.identityFile ?? "")}
                    onSave={(v) => saveConfigField("identityFile", v)}
                    mode="edit"
                    fieldId="identityFile"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="~/.ssh/id_rsa"
                    ariaLabel="Identity File"
                    data-testid="env-edit-identity-file"
                  />
                </div>
              </>
            )}

            {existingEnv.adapterType === "docker" && (
              <>
                <div className={styles.section}>
                  <label className={styles.label}>Image</label>
                  <EditableTextField
                    value={String(config.image ?? "")}
                    onSave={(v) => saveConfigField("image", v)}
                    mode="edit"
                    fieldId="image"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="(default)"
                    ariaLabel="Image"
                    data-testid="env-edit-image"
                  />
                </div>
                <div className={styles.section}>
                  <label className={styles.label}>Repo</label>
                  <EditableTextField
                    value={String(config.repo ?? "")}
                    onSave={(v) => saveConfigField("repo", v)}
                    mode="edit"
                    fieldId="repo"
                    activeFieldId={activeFieldId}
                    onActivate={setActiveFieldId}
                    placeholder="(none)"
                    ariaLabel="Repo"
                    data-testid="env-edit-repo"
                  />
                </div>
              </>
            )}

            {existingEnv.adapterType === "codespace" && (
              <div className={styles.section}>
                <label className={styles.label}>Codespace Name</label>
                <EditableTextField
                  value={String(config.codespaceName ?? "")}
                  onSave={(v) => saveConfigField("codespaceName", v)}
                  validate={(v) => v.trim() === "" ? "Codespace name is required" : undefined}
                  mode="edit"
                  fieldId="codespaceName"
                  activeFieldId={activeFieldId}
                  onActivate={setActiveFieldId}
                  placeholder="codespace-name"
                  ariaLabel="Codespace Name"
                  data-testid="env-edit-codespace-name"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
                  listCodespaces();
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
          )}

          {adapterType === "codespace" && (
            <CodespacePicker
              codespaceName={codespaceName}
              onCodespaceNameChange={setCodespaceName}
              envName={envName}
              onEnvNameChange={setEnvName}
            />
          )}
        </div>
      </div>
    </div>
  );
}
