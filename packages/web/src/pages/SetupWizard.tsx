import { useState, useCallback, type JSX } from "react";
import { Navigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useGrackle } from "../context/GrackleContext.js";
import { useAppNavigate } from "../utils/navigation.js";
import { WelcomeStep } from "./setup/WelcomeStep.js";
import { AboutStep } from "./setup/AboutStep.js";
import { RuntimeStep } from "./setup/RuntimeStep.js";
import styles from "./SetupWizard.module.scss";

/** Total number of steps in the wizard. */
const TOTAL_STEPS: number = 3;

/** Default model for each runtime. resolvePersona() requires a non-empty model. */
const DEFAULT_MODELS: Record<string, string> = {
  "claude-code": "sonnet",
  "copilot": "gpt-4o",
  "codex": "o3",
};

/** First-run experience wizard — guides new users through initial setup. */
export function SetupWizard(): JSX.Element {
  const { personas, updatePersona, completeOnboarding, onboardingCompleted } = useGrackle();
  const navigate = useAppNavigate();
  const [step, setStep] = useState(0);

  const seedPersona = personas.find((p) => p.id === "claude-code");

  const handleFinish = useCallback(
    (runtime: string) => {
      // Update the seed persona's runtime if the user picked something different
      if (seedPersona && runtime !== seedPersona.runtime) {
        // Set the model to a valid default for the chosen runtime
        const model = DEFAULT_MODELS[runtime] ?? "sonnet";
        updatePersona(seedPersona.id, undefined, undefined, undefined, runtime, model);
      }
      completeOnboarding();
      navigate("/", { replace: true });
    },
    [seedPersona, updatePersona, completeOnboarding, navigate],
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
                onFinish={handleFinish}
                onBack={() => setStep(1)}
                finishDisabled={!seedPersona}
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
