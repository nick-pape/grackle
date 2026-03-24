import { useState, useEffect, type JSX, type FormEvent } from "react";
import { useParams, Navigate } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { Breadcrumbs, ConfirmDialog } from "../../components/display/index.js";
import { Button } from "../../components/display/Button.js";
import { PERSONAS_URL, useAppNavigate } from "../../utils/navigation.js";
import type { BreadcrumbSegment } from "../../utils/breadcrumbs.js";
import type { PersonaData } from "../../hooks/types.js";
import styles from "../../components/personas/PersonaManager.module.scss";

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
    { label: "Settings", url: "/settings" },
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
    runtime?: string, model?: string, maxTurns?: number, type?: string, script?: string) => void;
  onUpdatePersona: (personaId: string, name?: string, description?: string,
    systemPrompt?: string, runtime?: string, model?: string, maxTurns?: number,
    type?: string, script?: string) => void;
  onDeletePersona: (personaId: string) => void;
  onSetAppDefaultPersonaId: (personaId: string) => void;
  onDone: () => void;
  showToast: (message: string, type: "success" | "error") => void;
}

function PersonaForm({
  existing, isNew, appDefaultPersonaId,
  onCreatePersona, onUpdatePersona, onDeletePersona,
  onSetAppDefaultPersonaId, onDone, showToast,
}: PersonaFormProps): JSX.Element {
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const canSubmit = name.trim().length > 0
    && (personaType === "script" ? script.trim().length > 0 : (systemPrompt.trim().length > 0 && !!runtime && !!model));

  const isAppDefault = !isNew && appDefaultPersonaId === existing?.id;

  /** Whether this persona is eligible to be set as app default. */
  const canSetDefault = !isNew && existing && !isAppDefault
    && personaType === "agent" && !!runtime && !!model;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    if (existing) {
      onUpdatePersona(existing.id, name, description, systemPrompt, runtime, model, maxTurns, personaType, script);
      showToast("Persona updated", "success");
    } else {
      onCreatePersona(name, description, systemPrompt, runtime, model, maxTurns, personaType, script);
      showToast("Persona created", "success");
    }
    onDone();
  };

  const handleDelete = (): void => {
    if (existing) {
      onDeletePersona(existing.id);
      showToast("Persona deleted", "success");
      onDone();
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h3>{isNew ? "Create Persona" : "Edit Persona"}</h3>
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
            {personaType === "script" ? (
              <option value="genaiscript">genaiscript</option>
            ) : (
              <>
                <option value="claude-code">claude-code</option>
                <option value="codex">codex</option>
                <option value="copilot">copilot</option>
                <option value="goose">goose</option>
                <option value="stub">stub</option>
                <option value="claude-code-acp">claude-code-acp (experimental)</option>
                <option value="codex-acp">codex-acp (experimental)</option>
                <option value="copilot-acp">copilot-acp (experimental)</option>
              </>
            )}
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
              />
            </label>
            <label>
              System Prompt <span className={styles.optional}>(optional)</span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Optional context for the script..."
                rows={4}
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
        <div className={styles.formActions}>
          <Button type="submit" variant="primary" size="md" disabled={!canSubmit} data-testid="persona-detail-save">
            {existing ? "Save" : "Create"}
          </Button>
          <Button type="button" variant="outline" size="md" onClick={onDone} data-testid="persona-detail-cancel">
            Cancel
          </Button>
          {!isNew && existing && (
            <>
              {canSetDefault && (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => { onSetAppDefaultPersonaId(existing.id); showToast("Set as app default", "success"); }}
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
            </>
          )}
        </div>
        {!isNew && !canSetDefault && !isAppDefault && existing && (
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", marginTop: "var(--space-xs)" }}>
            Only agent personas with a runtime and model can be set as app default.
          </p>
        )}
      </form>

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
