import type { JSX } from "react";
import { EnvironmentList } from "../../components/lists/EnvironmentList.js";

/** Settings tab wrapping the environment list. */
export function SettingsEnvironmentsTab(): JSX.Element {
  return <EnvironmentList />;
}
