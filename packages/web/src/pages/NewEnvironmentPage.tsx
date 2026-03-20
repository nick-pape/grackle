import { type JSX } from "react";
import { EnvironmentEditPanel } from "../components/panels/EnvironmentEditPanel.js";

/** Page shown when adding a new environment. */
export function NewEnvironmentPage(): JSX.Element {
  return <EnvironmentEditPanel mode="new" />;
}
