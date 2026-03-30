import { useState, useCallback, type JSX } from "react";
import { Navigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { SYSTEM_PERSONA_ID } from "@grackle-ai/common";
import { useGrackle } from "../context/GrackleContext.js";
import { useAppNavigate, useToast } from "@grackle-ai/web-components";
import { WelcomeStep } from "./setup/WelcomeStep.js";
import { AboutStep } from "./setup/AboutStep.js";
import { RuntimeStep } from "./setup/RuntimeStep.js";
import { NotificationStep } from "./setup/NotificationStep.js";
import styles from "./SetupWizard.module.scss";

/** Total number of steps in the wizard. */
const TOTAL_STEPS: number = 4;

/** Default model for each runtime. resolvePersona() requires a non-empty model. */
const DEFAULT_MODELS: Record<string, string> = {
  "claude-code": "sonnet",
  "copilot": "gpt-4o",
  "codex": "o3",
  "goose": "",
};

/** First-run experience wizard — guides new users through initial setup. */
export function SetupWizard(): JSX.Element {
  const { personas: { personas, updatePersona }, completeOnboarding, onboardingCompleted } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();
  const [step, setStep] = useState(0);
  const [selectedRuntime, setSelectedRuntime] = useState("claude-code");
  const [isFinishing, setIsFinishing] = useState(false);

  const seedPersona = personas.find((p) => p.id === "claude-code");

  /** Save runtime choice and advance to notification permission step. */
  const handleRuntimeNext = useCallback(
    (runtime: string) => {
      setSelectedRuntime(runtime);
      setStep(3);
    },
    [],
  );

  const handleFinish = useCallback(
    () => {
      const runtime = selectedRuntime;
      setIsFinishing(true);

      const updates: Promise<unknown>[] = [];

      // Update the seed persona's runtime if the user picked something different
      if (seedPersona && runtime !== seedPersona.runtime) {
        const model = DEFAULT_MODELS[runtime] ?? "sonnet";
        updates.push(updatePersona(seedPersona.id, undefined, undefined, undefined, runtime, model));
      }
      // Sync System persona runtime to match
      const systemPersona = personas.find((p) => p.id === SYSTEM_PERSONA_ID);
      if (systemPersona && runtime !== systemPersona.runtime) {
        const model = DEFAULT_MODELS[runtime] ?? "sonnet";
        updates.push(updatePersona(SYSTEM_PERSONA_ID, undefined, undefined, undefined, runtime, model));
      }

      Promise.all(updates)
        .then(() => completeOnboarding())
        .then(
          () => {
            navigate("/", { replace: true });
          },
          () => {
            showToast("Failed to update runtime -- please try again", "error");
            setIsFinishing(false);
          },
        );
    },
    [selectedRuntime, seedPersona, personas, updatePersona, completeOnboarding, navigate, showToast],
  );

  // If onboarding is already complete, redirect to home
  if (onboardingCompleted === true) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.wizard} data-testid="setup-wizard">
      <div className={styles.container}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
            {step === 1 && (
              <AboutStep onNext={() => setStep(2)} onBack={() => setStep(0)} />
            )}
            {step === 2 && (
              <RuntimeStep
                currentRuntime={seedPersona?.runtime ?? "claude-code"}
                onFinish={handleRuntimeNext}
                onBack={() => setStep(1)}
                finishDisabled={!seedPersona}
              />
            )}
            {step === 3 && (
              <NotificationStep
                onFinish={handleFinish}
                onBack={() => setStep(2)}
                finishDisabled={isFinishing}
              />
            )}
          </motion.div>
        </AnimatePresence>
        <div className={styles.dots}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={styles.dot}
              data-active={i === step}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
