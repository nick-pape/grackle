import type { JSX } from "react";
import { Spinner } from "./Spinner.js";
import { assetUrl } from "../../utils/assetUrl.js";
import styles from "./SplashScreen.module.scss";

/**
 * Full-viewport splash screen displayed while waiting for the server's initial
 * state (e.g. onboarding status). Shows the Grackle logo and a spinner.
 */
export function SplashScreen(): JSX.Element {
  return (
    <div className={styles.splash} data-testid="splash-screen">
      <img src={assetUrl("grackle-logo.png")} alt="Grackle" className={styles.logo} />
      <Spinner size="xl" label="Loading Grackle" liveRegion />
    </div>
  );
}
