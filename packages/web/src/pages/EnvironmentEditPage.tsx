import { type JSX } from "react";
import { useParams } from "react-router";
import { EnvironmentEditPanel } from "../components/panels/EnvironmentEditPanel.js";

/** Page shown when editing an existing environment. */
export function EnvironmentEditPage(): JSX.Element {
  const { environmentId } = useParams<{ environmentId: string }>();
  return <EnvironmentEditPanel mode="edit" environmentId={environmentId!} />;
}
