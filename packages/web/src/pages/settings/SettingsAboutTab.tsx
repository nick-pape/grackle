import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { AboutPanel } from "../../components/panels/AboutPanel.js";

/** Settings tab wrapping the about panel. */
export function SettingsAboutTab(): JSX.Element {
  const { connected, environments, sessions } = useGrackle();

  return <AboutPanel connected={connected} environments={environments} sessions={sessions} />;
}
