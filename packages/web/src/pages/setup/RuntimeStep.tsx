import { useState, type JSX } from "react";
import styles from "../SetupWizard.module.scss";

/** Runtime option definition. */
interface RuntimeOption {
  id: string;
  name: string;
  description: string;
}

/** Available runtime choices. */
const RUNTIMES: RuntimeOption[] = [
  { id: "claude-code", name: "Claude Code", description: "Anthropic's agentic coding tool" },
  { id: "copilot", name: "Copilot Coding Agent", description: "GitHub's AI pair programmer" },
  { id: "codex", name: "Codex CLI", description: "OpenAI's coding agent" },
];

/** Props for the {@link RuntimeStep} component. */
interface RuntimeStepProps {
  currentRuntime: string;
  onFinish: (runtime: string) => void;
  onBack: () => void;
}

/** Runtime selection screen — three cards for choosing the primary agent runtime. */
export function RuntimeStep({ currentRuntime, onFinish, onBack }: RuntimeStepProps): JSX.Element {
  const [selected, setSelected] = useState(currentRuntime || "claude-code");

  return (
    <div className={styles.stepContent} data-testid="setup-runtime">
      <h2 className={styles.heading}>Choose Your Runtime</h2>
      <p className={styles.subtitle}>Select the primary agent runtime for your workspace. You can change this later.</p>
      <div className={styles.runtimeGrid}>
        {RUNTIMES.map((rt) => (
          <button
            key={rt.id}
            type="button"
            className={styles.runtimeCard}
            data-selected={selected === rt.id}
            data-testid={`runtime-card-${rt.id}`}
            onClick={() => setSelected(rt.id)}
          >
            <span className={styles.runtimeName}>{rt.name}</span>
            <span className={styles.runtimeDescription}>{rt.description}</span>
          </button>
        ))}
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => onFinish(selected)}
          data-testid="setup-finish"
        >
          Finish
        </button>
      </div>
    </div>
  );
}
