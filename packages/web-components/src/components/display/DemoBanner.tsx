import styles from "./DemoBanner.module.scss";
import type { JSX } from "react";

/** Persistent banner indicating the app is running in demo/mock mode. */
export function DemoBanner(): JSX.Element {
  return (
    <div className={styles.banner} data-testid="demo-banner">
      <span className={styles.label}>DEMO</span>
      <span className={styles.text}>
        This is an interactive demo with mock data.{" "}
        <a
          href="https://github.com/nick-pape/grackle"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          Install Grackle
        </a>{" "}
        to use it for real.
      </span>
    </div>
  );
}
