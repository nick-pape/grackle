/**
 * AgentSettingsTab — full config hub for per-agent ("Claw") settings (#1419).
 * Editable fields: name, avatar, persona, environment, heartbeat.
 * Follows the {@link PersonaDetailPage} inline editing pattern.
 *
 * @module
 */

import { useState, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import {
  EditableTextField,
  EditableTextArea,
  EditableSelect,
  EditableCheckbox,
  Button,
  ConfirmDialog,
  useAppNavigate,
  useToast,
  type SelectOption,
} from "@grackle-ai/web-components";
import { orchestrationClient } from "../../hooks/useGrackleClient.js";
import { useAgentContext } from "../AgentLayout.js";
import styles from "./AgentSettingsTab.module.scss";

/** Validate that a string value is not empty after trimming. */
function validateRequired(value: string, label: string): string | undefined {
  if (value.trim().length === 0) return `${label} is required`;
  return undefined;
}

export function AgentSettingsTab(): JSX.Element {
  const { agent } = useAgentContext();
  const navigate = useAppNavigate();
  const { showToast } = useToast();
  const {
    agents: { updateAgent, deleteAgent },
    personas: { personas },
    environments: { environments },
  } = useGrackle();

  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const personaOptions: SelectOption[] = [
    { value: "", label: "(none)" },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ];

  const handleSaveName = (value: string): void => {
    updateAgent(agent.id, { name: value }).then(
      () => showToast("Name updated", "success"),
      () => showToast("Failed to update name", "error"),
    );
  };

  const handleSaveAvatar = (value: string): void => {
    updateAgent(agent.id, { avatar: value }).then(
      () => showToast("Avatar updated", "success"),
      () => showToast("Failed to update avatar", "error"),
    );
  };

  const handleSavePersona = (value: string): void => {
    updateAgent(agent.id, { primaryPersonaId: value }).then(
      () => showToast("Persona updated", "success"),
      () => showToast("Failed to update persona", "error"),
    );
  };

  const handleSaveHeartbeatCadence = (value: string): void => {
    const cadence = value.trim();
    orchestrationClient.setAgentHeartbeat({ agentId: agent.id, cadence: cadence || "" }).then(
      () => showToast(cadence ? "Heartbeat updated" : "Heartbeat cleared", "success"),
      () => showToast("Failed to update heartbeat", "error"),
    );
  };

  const handleSaveHeartbeatRules = (value: string): void => {
    orchestrationClient.setAgentHeartbeat({ agentId: agent.id, rules: value }).then(
      () => showToast("Heartbeat rules updated", "success"),
      () => showToast("Failed to update rules", "error"),
    );
  };

  const handleToggleHeartbeat = (enabled: boolean): void => {
    orchestrationClient.setAgentHeartbeat({ agentId: agent.id, enabled }).then(
      () => showToast(enabled ? "Heartbeat resumed" : "Heartbeat paused", "success"),
      () => showToast("Failed to toggle heartbeat", "error"),
    );
  };

  const handleDelete = (): void => {
    deleteAgent(agent.id).then(
      () => {
        showToast("Agent deleted", "success");
        navigate("/");
      },
      () => showToast("Failed to delete agent", "error"),
    );
  };

  return (
    <div className={styles.container} data-testid="agent-settings-tab">
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Identity</h2>
        <div className={styles.field}>
          <label className={styles.label}>Name</label>
          <EditableTextField
            value={agent.name}
            onSave={handleSaveName}
            validate={(v) => validateRequired(v, "Name")}
            fieldId="agent-name"
            activeFieldId={activeFieldId}
            onActivate={setActiveFieldId}
            ariaLabel="Agent name"
            data-testid="agent-settings-name"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Avatar</label>
          <EditableTextField
            value={agent.avatar}
            onSave={handleSaveAvatar}
            fieldId="agent-avatar"
            activeFieldId={activeFieldId}
            onActivate={setActiveFieldId}
            placeholder="emoji, URL, or data URI"
            ariaLabel="Agent avatar"
            data-testid="agent-settings-avatar"
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Configuration</h2>
        <div className={styles.field}>
          <label className={styles.label}>Primary Persona</label>
          <EditableSelect
            value={agent.primaryPersonaId}
            onSave={handleSavePersona}
            options={personaOptions}
            fieldId="agent-persona"
            activeFieldId={activeFieldId}
            onActivate={setActiveFieldId}
            ariaLabel="Primary persona"
            data-testid="agent-settings-persona"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Environment</label>
          <div className={styles.readOnly} data-testid="agent-settings-environment">
            {environments.find((e) => e.id === agent.environmentId)?.displayName ||
              agent.environmentId}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Heartbeat</h2>
        {agent.heartbeat ? (
          <>
            <div className={styles.field}>
              <label className={styles.label}>Cadence</label>
              <EditableTextField
                value={agent.heartbeat.scheduleExpression}
                onSave={handleSaveHeartbeatCadence}
                fieldId="agent-heartbeat-cadence"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder='e.g. "5m", "0 9 * * MON"'
                ariaLabel="Heartbeat cadence"
                data-testid="agent-settings-heartbeat-cadence"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Enabled</label>
              <EditableCheckbox
                checked={agent.heartbeat.enabled}
                onChange={handleToggleHeartbeat}
                label={agent.heartbeat.enabled ? "Active" : "Paused"}
                ariaLabel="Heartbeat enabled"
                data-testid="agent-settings-heartbeat-enabled"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Rules</label>
              <EditableTextArea
                value={agent.heartbeat.description}
                onSave={handleSaveHeartbeatRules}
                fieldId="agent-heartbeat-rules"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="Instructions piped to the agent on each wake..."
                ariaLabel="Heartbeat rules"
                data-testid="agent-settings-heartbeat-rules"
              />
            </div>
          </>
        ) : (
          <div className={styles.field}>
            <p className={styles.hint}>
              No heartbeat configured. Set a cadence to activate periodic waking.
            </p>
            <div className={styles.field}>
              <label className={styles.label}>Cadence</label>
              <EditableTextField
                value=""
                onSave={handleSaveHeartbeatCadence}
                fieldId="agent-heartbeat-cadence"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder='e.g. "5m", "0 9 * * MON"'
                ariaLabel="Heartbeat cadence"
                data-testid="agent-settings-heartbeat-cadence"
              />
            </div>
          </div>
        )}
      </section>

      <section className={styles.dangerZone}>
        <h2 className={styles.sectionTitle}>Danger Zone</h2>
        <Button
          variant="danger"
          onClick={() => setShowDeleteConfirm(true)}
          data-testid="agent-settings-delete"
        >
          Delete Agent
        </Button>
      </section>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Agent"
        description={`Are you sure you want to delete "${agent.name}"? This will also delete all tasks and sessions owned by this agent.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
