import { type JSX } from "react";
import styles from "../SetupWizard.module.scss";

/** Props for the {@link AboutStep} component. */
interface AboutStepProps {
  onNext: () => void;
  onBack: () => void;
}

/** About screen — explains what Grackle does in 5 bullet points. */
export function AboutStep({ onNext, onBack }: AboutStepProps): JSX.Element {
  return (
    <div className={styles.stepContent} data-testid="setup-about">
      <h2 className={styles.heading}>What is Grackle?</h2>
      <ul className={styles.featureList}>
        <li>Run Claude, Copilot, and Codex agents side by side</li>
        <li>Provision and control dev environments — SSH, Codespaces, or local</li>
        <li>Organize work into projects with agent-executable tasks</li>
        <li>Customize agent behavior with personas, tools, and MCP servers</li>
        <li>Live-stream agent sessions with full terminal replay</li>
      </ul>
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
          onClick={onNext}
          data-testid="setup-about-next"
        >
          Next
        </button>
      </div>
    </div>
  );
}
