import { type JSX } from "react";
import styles from "../SetupWizard.module.scss";

/** Props for the {@link WelcomeStep} component. */
interface WelcomeStepProps {
  onNext: () => void;
}

/** Welcome screen — logo, tagline, and "Get Started" button. */
export function WelcomeStep({ onNext }: WelcomeStepProps): JSX.Element {
  return (
    <div className={styles.stepContent} data-testid="setup-welcome">
      <div className={styles.logoArea}>
        <img src="/grackle-logo.png" alt="Grackle" className={styles.logoImage} />
      </div>
      <h1 className={styles.heading}>Welcome to Grackle</h1>
      <p className={styles.tagline}>Multi-agent orchestration for software teams</p>
      <button
        type="button"
        className={styles.primaryButton}
        onClick={onNext}
        data-testid="setup-get-started"
      >
        Get Started
      </button>
    </div>
  );
}
