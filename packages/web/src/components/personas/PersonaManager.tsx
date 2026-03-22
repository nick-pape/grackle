import { useState, type JSX, type FormEvent } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import type { PersonaData } from "../../hooks/useGrackleSocket.js";
import styles from "./PersonaManager.module.scss";

/** Full CRUD management view for personas. */
export function PersonaManager(): JSX.Element {
  const { personas, createPersona, updatePersona, deletePersona, appDefaultPersonaId, setAppDefaultPersonaId } = useGrackle();
  const [editing, setEditing] = useState<PersonaData | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // --- Form state ---
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [runtime, setRuntime] = useState("claude-code");
  const [model, setModel] = useState("sonnet");
  const [maxTurns, setMaxTurns] = useState(0);
  const [personaType, setPersonaType] = useState<"agent" | "script">("agent");
  const [script, setScript] = useState("");

  const resetForm = (): void => {
    setName("");
    setDescription("");
    setSystemPrompt("");
    setRuntime("claude-code");
    setModel("sonnet");
    setMaxTurns(0);
    setPersonaType("agent");
    setScript("");
  };

  const startCreate = (): void => {
    resetForm();
    setEditing(null);
    setCreating(true);
  };

  const startEdit = (p: PersonaData): void => {
    setName(p.name);
    setDescription(p.description);
    setSystemPrompt(p.systemPrompt);
    const editType = p.type === "script" ? "script" : "agent";
    setRuntime(editType === "script" ? (p.runtime || "genaiscript") : p.runtime);
    setModel(p.model);
    setMaxTurns(p.maxTurns);
    setPersonaType(editType as "agent" | "script");
    setScript(p.script || "");
    setEditing(p);
    setCreating(false);
  };

  /** When switching to "script" type, auto-set runtime to genaiscript. */
  const handleTypeChange = (newType: "agent" | "script"): void => {
    setPersonaType(newType);
    if (newType === "script") {
      setRuntime("genaiscript");
    } else if (runtime === "genaiscript") {
      setRuntime("claude-code");
    }
  };

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) {
      return;
    }
    if (personaType === "script") {
      if (!script.trim()) {
        return;
      }
    } else {
      if (!systemPrompt.trim() || !runtime || !model) {
        return;
      }
    }
    if (editing) {
      updatePersona(editing.id, name, description, systemPrompt, runtime, model, maxTurns, personaType, script);
      setEditing(null);
    } else {
      createPersona(name, description, systemPrompt, runtime, model, maxTurns, personaType, script);
      setCreating(false);
    }
    resetForm();
  };

  const handleDelete = (id: string): void => {
    deletePersona(id);
    setConfirmDelete(null);
    if (editing?.id === id) {
      setEditing(null);
      resetForm();
    }
  };

  const handleCancel = (): void => {
    setEditing(null);
    setCreating(false);
    resetForm();
  };

  // --- Form component ---
  const renderForm = (): JSX.Element => (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h3>{editing ? "Edit Persona" : "Create Persona"}</h3>
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
        />
      </label>
      <label>
        Description
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description..."
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
        <button type="submit" className={styles.btnPrimary}>
          {editing ? "Save" : "Create"}
        </button>
        <button type="button" onClick={handleCancel} className={styles.btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Personas</h2>
        <button onClick={startCreate} className={styles.btnPrimary}>
          + New Persona
        </button>
      </div>

      {(creating || editing) && renderForm()}

      {personas.length === 0 && !creating ? (
        <p className={styles.empty}>No personas yet. Create one to get started.</p>
      ) : (
        <div className={styles.list}>
          {personas.map((p) => {
            const isAppDefault = appDefaultPersonaId === p.id;
            const isScript = p.type === "script";
            return (
            <div key={p.id} className={`${styles.card} ${editing?.id === p.id ? styles.active : ""}`} data-testid={`persona-card-${p.id}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>
                  <strong>{p.name}</strong>
                  <span className={styles.typeBadge} data-testid={`persona-type-badge-${p.id}`}>
                    {isScript ? "Script" : "Agent"}
                  </span>
                  {isAppDefault && (
                    <span className={styles.defaultBadge} data-testid={`persona-default-badge-${p.id}`}>App Default</span>
                  )}
                </span>
                <div className={styles.cardActions}>
                  {!isAppDefault && (
                    <button
                      onClick={() => setAppDefaultPersonaId(p.id)}
                      className={styles.btnSmall}
                      data-testid={`persona-set-default-${p.id}`}
                      title="Set as app default persona"
                    >
                      Set Default
                    </button>
                  )}
                  <button onClick={() => startEdit(p)} className={styles.btnSmall}>Edit</button>
                  {confirmDelete === p.id ? (
                    <>
                      <button onClick={() => handleDelete(p.id)} className={styles.btnDanger}>Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className={styles.btnSmall}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(p.id)} className={styles.btnSmall}>Delete</button>
                  )}
                </div>
              </div>
              {p.description && <p className={styles.description}>{p.description}</p>}
              <div className={styles.meta}>
                {p.runtime && <span>Runtime: {p.runtime}</span>}
                {p.model && <span>Model: {p.model}</span>}
                {p.maxTurns > 0 && <span>Max turns: {p.maxTurns}</span>}
              </div>
              {isScript ? (
                <details className={styles.promptDetails}>
                  <summary>Script</summary>
                  <pre className={styles.promptText}>{p.script}</pre>
                </details>
              ) : (
                <details className={styles.promptDetails}>
                  <summary>System Prompt</summary>
                  <pre className={styles.promptText}>{p.systemPrompt}</pre>
                </details>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
