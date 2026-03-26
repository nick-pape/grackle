import { useState, useEffect, type JSX, type FormEvent } from "react";
import { useParams, Navigate } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { Breadcrumbs, ConfirmDialog } from "../../components/display/index.js";
import { Button } from "../../components/display/Button.js";
import { EditableSelect, EditableTextArea, EditableTextField, type SelectOption } from "../../components/editable/index.js";
import { PERSONAS_URL, SETTINGS_URL, personaUrl, useAppNavigate } from "../../utils/navigation.js";
import type { BreadcrumbSegment } from "../../utils/breadcrumbs.js";
import type { PersonaData } from "../../hooks/types.js";
import { McpToolSelector } from "../../components/personas/McpToolSelector.js";
import styles from "../../components/personas/PersonaManager.module.scss";

const RUNTIME_OPTIONS: SelectOption[] = [
  { value: "claude-code", label: "claude-code" },
  { value: "codex", label: "codex" },
  { value: "copilot", label: "copilot" },
  { value: "goose", label: "goose" },
  { value: "stub", label: "stub" },
  { value: "claude-code-acp", label: "claude-code-acp (experimental)" },
  { value: "codex-acp", label: "codex-acp (experimental)" },
  { value: "copilot-acp", label: "copilot-acp (experimental)" },
];

const SCRIPT_RUNTIME_OPTIONS: SelectOption[] = [
  { value: "genaiscript", label: "genaiscript" },
];

const MAX_TURNS_PLACEHOLDER: string = "0";

/** PersonaDetailPage handles both create (/settings/personas/new) and edit (/settings/personas/:personaId). */
export function PersonaDetailPage(): JSX.Element {
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useAppNavigate();
  const { showToast } = useToast();
  const {
    personas, createPersona, updatePersona, deletePersona,
    appDefaultPersonaId, setAppDefaultPersonaId,
  } = useGrackle();

  const isNew = personaId === undefined;
  const existing: PersonaData | undefined = isNew ? undefined : personas.find((p) => p.id === personaId);

  // Redirect to list if persona not found (and personas have loaded)
  if (!isNew && personas.length > 0 && !existing) {
    return <Navigate to={PERSONAS_URL} replace />;
  }

  const breadcrumbs: BreadcrumbSegment[] = [
    { label: "Settings", url: SETTINGS_URL },
    { label: "Personas", url: PERSONAS_URL },
    { label: isNew ? "New Persona" : (existing?.name ?? "Persona"), url: undefined },
  ];

  return (
    <div className={styles.container}>
      <Breadcrumbs segments={breadcrumbs} />
      <PersonaForm
        existing={existing}
        isNew={isNew}
        appDefaultPersonaId={appDefaultPersonaId}
        onCreatePersona={createPersona}
        onUpdatePersona={updatePersona}
        onDeletePersona={deletePersona}
        onSetAppDefaultPersonaId={setAppDefaultPersonaId}
        onDone={() => {
          navigate(PERSONAS_URL);
        }}
        showToast={showToast}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal form component
// ---------------------------------------------------------------------------

interface PersonaFormProps {
  existing: PersonaData | undefined;
  isNew: boolean;
  appDefaultPersonaId: string;
  onCreatePersona: (name: string, description: string, systemPrompt: string,
    runtime?: string, model?: string, maxTurns?: number, type?: string, script?: string,
    allowedMcpTools?: string[]) => Promise<PersonaData>;
  onUpdatePersona: (personaId: string, name?: string, description?: string,
    systemPrompt?: string, runtime?: string, model?: string, maxTurns?: number,
    type?: string, script?: string, allowedMcpTools?: string[]) => Promise<PersonaData>;
  onDeletePersona: (personaId: string) => Promise<void>;
  onSetAppDefaultPersonaId: (personaId: string) => Promise<void>;
  onDone: () => void;
  showToast: (message: string, type: "success" | "error") => void;
}

function PersonaForm({
  existing, isNew, appDefaultPersonaId,
  onCreatePersona, onUpdatePersona, onDeletePersona,
  onSetAppDefaultPersonaId, onDone, showToast,
}: PersonaFormProps): JSX.Element {
  const navigate = useAppNavigate();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? "");
  const [runtime, setRuntime] = useState(existing?.runtime ?? "claude-code");
  const [model, setModel] = useState(existing?.model ?? "sonnet");
  const [maxTurns, setMaxTurns] = useState(existing?.maxTurns ?? 0);
  const [personaType, setPersonaType] = useState<"agent" | "script">(
    existing?.type === "script" ? "script" : "agent",
  );
  const [script, setScript] = useState(existing?.script ?? "");
  const [allowedMcpTools, setAllowedMcpTools] = useState<string[]>(existing?.allowedMcpTools ?? []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Hydrate form when existing persona loads asynchronously
  const [hydrated, setHydrated] = useState(!!isNew);
  useEffect(() => {
    if (!isNew && existing && !hydrated) {
      setHydrated(true);
      setName(existing.name);
      setDescription(existing.description);
      setSystemPrompt(existing.systemPrompt);
      const editType = existing.type === "script" ? "script" : "agent";
      setRuntime(editType === "script" ? (existing.runtime || "genaiscript") : existing.runtime);
      setModel(existing.model);
      setMaxTurns(existing.maxTurns);
      setPersonaType(editType);
      setScript(existing.script || "");
      setAllowedMcpTools(existing.allowedMcpTools);
    }
  }, [isNew, existing, hydrated]);

  const handleTypeChange = (newType: "agent" | "script"): void => {
    setPersonaType(newType);
    if (newType === "script") {
      setRuntime("genaiscript");
    } else if (runtime === "genaiscript") {
      setRuntime("claude-code");
    }
  };

  const isLoadingExisting = !isNew && existing === undefined;

  const canSubmit = name.trim().length > 0
    && !isLoadingExisting
    && systemPrompt.trim().length > 0
    && (personaType === "script" ? script.trim().length > 0 : (!!runtime && !!model));
  const canCreate = isNew && canSubmit;

  const isAppDefault = !isNew && appDefaultPersonaId === existing?.id;

  /** Whether this persona is eligible to be set as app default. */
  const canSetDefault = !isNew && existing && !isAppDefault
    && personaType === "agent" && !!runtime && !!model;

  const validateRequired = (value: string, fieldName: string): string | undefined => {
    if (!value.trim()) {
      return `${fieldName} is required`;
    }
    return undefined;
  };

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (isLoadingExisting || !canSubmit) {
      return;
    }
    if (existing) {
      onUpdatePersona(existing.id, name, description, systemPrompt, runtime, model, maxTurns, personaType, script).then(
        () => {
          showToast("Persona updated", "success");
          onDone();
        },
        () => {
          showToast("Failed to save persona", "error");
        },
      );
      return;
    }
    onCreatePersona(name, description, systemPrompt, runtime, model, maxTurns, personaType, script, allowedMcpTools).then(
      (createdPersona) => {
        showToast("Persona created", "success");
        navigate(personaUrl(createdPersona.id), { replace: true });
      },
      () => {
        showToast("Failed to save persona", "error");
      },
    );
  };

  const handleDelete = (): void => {
    if (existing) {
      onDeletePersona(existing.id).then(
        () => {
          showToast("Persona deleted", "success");
          onDone();
        },
        () => {
          showToast("Failed to delete persona", "error");
        },
      );
    }
  };

  const saveField = async (
    saveAction: () => Promise<unknown>,
    onSuccess: () => void,
    successMessage: string,
    errorMessage: string,
  ): Promise<void> => {
    return saveAction().then(
      () => {
        onSuccess();
        showToast(successMessage, "success");
      },
      () => {
        showToast(errorMessage, "error");
      },
    );
  };

  const handleFieldSave = (field: "name" | "description" | "systemPrompt" | "runtime" | "model" | "maxTurns" | "type" | "script", value: string | number): void => {
    if (!existing) {
      return;
    }
    const nextType = field === "type" ? String(value) : personaType;
    const nextRuntime = field === "runtime"
      ? String(value)
      : field === "type"
        ? (String(value) === "script" ? "genaiscript" : runtime === "genaiscript" ? "claude-code" : runtime)
        : runtime;
    const nextModel = field === "model" ? String(value) : model;
    const nextMaxTurns = field === "maxTurns" ? Number(value) : maxTurns;
    const nextSystemPrompt = field === "systemPrompt" ? String(value) : systemPrompt;
    const nextScript = field === "script" ? String(value) : script;

    saveField(
      () => onUpdatePersona(
        existing.id,
        field === "name" ? String(value) : name,
        field === "description" ? String(value) : description,
        nextSystemPrompt,
        nextRuntime,
        nextModel,
        nextMaxTurns,
        nextType,
        nextScript,
      ),
      () => {
        if (field === "type") {
          const newType = String(value) === "script" ? "script" : "agent";
          setPersonaType(newType);
          setRuntime(nextRuntime);
        }
        if (field === "runtime") {
          setRuntime(String(value));
        }
        if (field === "name") {
          setName(String(value));
        }
        if (field === "description") {
          setDescription(String(value));
        }
        if (field === "systemPrompt") {
          setSystemPrompt(String(value));
        }
        if (field === "model") {
          setModel(String(value));
        }
        if (field === "maxTurns") {
          setMaxTurns(Number(value));
        }
        if (field === "script") {
          setScript(String(value));
        }
      },
      "Persona updated",
      "Failed to update persona",
    ).catch(() => {});
  };

  const handleCreateSubmit = (event: FormEvent): void => {
    handleSubmit(event);
  };

  const handleSetDefault = (): void => {
    if (!existing) {
      return;
    }
    onSetAppDefaultPersonaId(existing.id).then(
      () => {
        showToast("Set as app default", "success");
      },
      () => {
        showToast("Failed to set app default", "error");
      },
    );
  };

  return (
    <>
      {isLoadingExisting ? (
        <div className={styles.form}>
          <h3>Edit Persona</h3>
          <p>Loading persona...</p>
        </div>
      ) : isNew ? (
        <form onSubmit={handleCreateSubmit} className={styles.form}>
          <h3>Create Persona</h3>
          <div className={styles.typeToggle} data-testid="persona-type-toggle">
            <label>
              <input
                type="radio"
                name="personaType"
                value="agent"
                checked={personaType === "agent"}
                onChange={() => handleTypeChange("agent")}
              />
              Agent
            </label>
            <label>
              <input
                type="radio"
                name="personaType"
                value="script"
                checked={personaType === "script"}
                onChange={() => handleTypeChange("script")}
              />
              Script
            </label>
          </div>
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={personaType === "script" ? "e.g. Nightly Report" : "e.g. Frontend Engineer"}
              required
              data-testid="persona-detail-name"
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              data-testid="persona-detail-description"
            />
          </label>
          <label>
            Runtime
            <select value={runtime} onChange={(e) => setRuntime(e.target.value)} data-testid="persona-runtime-select">
              {(personaType === "script" ? SCRIPT_RUNTIME_OPTIONS : RUNTIME_OPTIONS).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {personaType === "agent" && (
            <>
              <label>
                Model
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. sonnet"
                  data-testid="persona-detail-model"
                />
              </label>
              <label>
                Max Turns
                <input
                  type="number"
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 0)}
                  min={0}
                  data-testid="persona-detail-max-turns"
                />
              </label>
              <label>
                System Prompt
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a senior frontend engineer..."
                  rows={10}
                  required
                  data-testid="persona-detail-prompt"
                />
              </label>
            </>
          )}
          {personaType === "script" && (
            <>
              <label>
                Model <span className={styles.optional}>(optional)</span>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. sonnet (leave empty for script-only)"
                  data-testid="persona-detail-model"
                />
              </label>
              <label>
                System Prompt
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Context for the script..."
                  rows={4}
                  required
                  data-testid="persona-detail-prompt"
                />
              </label>
              <label>
                Script
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder={'script({ model: "openai:gpt-4o" });\n\nconst grackle = await host.mcpServer({\n  id: "grackle",\n  url: env.vars.GRACKLE_MCP_URL,\n});\n\n$`Summarize the current tasks.`;'}
                  rows={20}
                  className={styles.scriptEditor}
                  required
                  data-testid="persona-script-editor"
                />
              </label>
            </>
          )}
          {personaType === "agent" && (
            <div>
              <label>Allowed MCP Tools</label>
              <McpToolSelector
                selectedTools={allowedMcpTools}
                onChange={setAllowedMcpTools}
              />
            </div>
          )}
          <div className={styles.formActions}>
            <Button type="submit" variant="primary" size="md" disabled={!canCreate} data-testid="persona-detail-save">
              Create
            </Button>
            <Button type="button" variant="outline" size="md" onClick={onDone} data-testid="persona-detail-cancel">
              Cancel
            </Button>
          </div>
        </form>
      ) : existing ? (
        <div className={styles.form}>
          <h3>Edit Persona</h3>
          <div className={styles.formActions}>
            <Button type="button" variant="outline" size="md" onClick={onDone} data-testid="persona-detail-cancel">
              Back to Personas
            </Button>
            {canSetDefault && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={handleSetDefault}
                data-testid="persona-detail-set-default"
              >
                Set as App Default
              </Button>
            )}
            {isAppDefault && (
              <span className={styles.defaultBadge}>App Default</span>
            )}
            <Button
              type="button"
              variant="danger"
              size="md"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="persona-detail-delete"
            >
              Delete
            </Button>
          </div>

          <div className={styles.editableSection}>
            <label>
              Name
              <EditableTextField
                value={name}
                onSave={(value) => { handleFieldSave("name", value); }}
                validate={(value) => validateRequired(value, "Name")}
                fieldId="persona-name"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                ariaLabel="Persona name"
                data-testid="persona-detail-name"
              />
            </label>
            <label>
              Description
              <EditableTextField
                value={description}
                onSave={(value) => { handleFieldSave("description", value); }}
                fieldId="persona-description"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="Brief description..."
                ariaLabel="Persona description"
                data-testid="persona-detail-description"
              />
            </label>
            <label>
              Type
              <EditableSelect
                value={personaType}
                onSave={(value) => { handleFieldSave("type", value); }}
                options={[
                  { value: "agent", label: "Agent" },
                  { value: "script", label: "Script" },
                ]}
                fieldId="persona-type"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                ariaLabel="Persona type"
                data-testid="persona-type-toggle"
              />
            </label>
            <label>
              Runtime
              <EditableSelect
                value={runtime}
                onSave={(value) => { handleFieldSave("runtime", value); }}
                options={personaType === "script" ? SCRIPT_RUNTIME_OPTIONS : RUNTIME_OPTIONS}
                fieldId="persona-runtime"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                ariaLabel="Persona runtime"
                data-testid="persona-runtime"
              />
            </label>
            <label>
              Model{personaType === "script" ? ` (${"optional"})` : ""}
              <EditableTextField
                value={model}
                onSave={(value) => { handleFieldSave("model", value); }}
                validate={personaType === "agent" ? (value) => validateRequired(value, "Model") : undefined}
                fieldId="persona-model"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder={personaType === "script" ? "e.g. sonnet (leave empty for script-only)" : "e.g. sonnet"}
                ariaLabel="Persona model"
                data-testid="persona-detail-model"
              />
            </label>
            <label>
              Max Turns
              <EditableTextField
                value={String(maxTurns)}
                onSave={(value) => { handleFieldSave("maxTurns", parseInt(value, 10) || 0); }}
                validate={(value) => (/^\d+$/.test(value.trim()) ? undefined : "Max Turns must be a non-negative integer")}
                fieldId="persona-max-turns"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder={MAX_TURNS_PLACEHOLDER}
                ariaLabel="Persona max turns"
                data-testid="persona-detail-max-turns"
              />
            </label>
            <label>
              System Prompt
              <EditableTextArea
                value={systemPrompt}
                onSave={(value) => { handleFieldSave("systemPrompt", value); }}
                validate={(value) => validateRequired(value, "System Prompt")}
                fieldId="persona-system-prompt"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder={personaType === "script" ? "Context for the script..." : "You are a senior frontend engineer..."}
                ariaLabel="Persona system prompt"
                data-testid="persona-detail-prompt"
              />
            </label>
            {personaType === "script" && (
              <label>
                Script
                <EditableTextArea
                  value={script}
                  onSave={(value) => { handleFieldSave("script", value); }}
                  validate={(value) => validateRequired(value, "Script")}
                  fieldId="persona-script"
                  activeFieldId={activeFieldId}
                  onActivate={setActiveFieldId}
                  placeholder={'script({ model: "openai:gpt-4o" });\n\nconst grackle = await host.mcpServer({\n  id: "grackle",\n  url: env.vars.GRACKLE_MCP_URL,\n});\n\n$`Summarize the current tasks.`;'}
                  ariaLabel="Persona script"
                  data-testid="persona-script-editor"
                />
              </label>
            )}
            {personaType === "agent" && (
              <div>
                <label>Allowed MCP Tools</label>
                <McpToolSelector
                  selectedTools={allowedMcpTools}
                  onChange={(tools) => {
                    setAllowedMcpTools(tools);
                    // Send "__clear__" sentinel when clearing to distinguish from "not provided"
                    const toSend = tools.length === 0 ? ["__clear__"] : tools;
                    saveField(
                      () => onUpdatePersona(
                        existing!.id,
                        undefined, undefined, undefined, undefined, undefined,
                        undefined, undefined, undefined, toSend,
                      ),
                      () => {},
                      "MCP tools updated",
                      "Failed to update MCP tools",
                    ).catch(() => {});
                  }}
                />
              </div>
            )}
          </div>

          {!canSetDefault && !isAppDefault && (
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", marginTop: "var(--space-xs)" }}>
              Only agent personas with a runtime and model can be set as app default.
            </p>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Persona?"
        description={`"${existing?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
