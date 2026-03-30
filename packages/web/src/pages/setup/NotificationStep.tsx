import { useState, type JSX } from "react";
import styles from "../SetupWizard.module.scss";

/** Props for the {@link NotificationStep} component. */
interface NotificationStepProps {
  onFinish: () => void;
  onBack: () => void;
  /** Disable action buttons (e.g. while the wizard is completing). */
  finishDisabled?: boolean;
}

/** Whether the browser supports the Notification API. */
function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

/**
 * Notification permission step -- explains why browser notifications are useful
 * and requests permission via a real user gesture (button click).
 */
export function NotificationStep({ onFinish, onBack, finishDisabled }: NotificationStepProps): JSX.Element {
  const [requesting, setRequesting] = useState(false);

  const supported = notificationsSupported();
  const alreadyDecided = supported && Notification.permission !== "default";

  /** Request permission then advance. */
  async function handleEnable(): Promise<void> {
    if (!supported) {
      onFinish();
      return;
    }
    setRequesting(true);
    try {
      await Notification.requestPermission().catch(() => {
        // Swallow errors from the permission request; onFinish will still be called.
      });
      onFinish();
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className={styles.stepContent} data-testid="setup-notifications">
      <h2 className={styles.heading}>Stay in the Loop</h2>
      <p className={styles.subtitle}>
        Grackle can send you a browser notification when an agent needs your input,
        so you never miss an important moment.
      </p>

      {alreadyDecided ? (
        <p className={styles.subtitle}>
          {Notification.permission === "granted"
            ? "Notifications are already enabled."
            : "Notifications have been blocked. You can change this in your browser settings."}
        </p>
      ) : null}

      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={onBack}
          disabled={finishDisabled || requesting}
        >
          Back
        </button>

        {!alreadyDecided && supported ? (
          <>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={onFinish}
              disabled={finishDisabled || requesting}
              data-testid="setup-notifications-skip"
            >
              Skip
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => { handleEnable().catch(() => {}); }}
              disabled={finishDisabled || requesting}
              data-testid="setup-notifications-enable"
            >
              Enable Notifications
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onFinish}
            disabled={finishDisabled}
            data-testid="setup-finish"
          >
            Finish
          </button>
        )}
      </div>
    </div>
  );
}
