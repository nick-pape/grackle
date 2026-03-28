import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { EnvironmentSelect } from "./EnvironmentSelect.js";
import type { Environment } from "../../hooks/types.js";
import { makeEnvironment } from "../../test-utils/storybook-helpers.js";

const localEnv: Environment = makeEnvironment({
  id: "env-local",
  displayName: "Local Machine",
  adapterType: "local",
  status: "connected",
});

const sshEnv: Environment = makeEnvironment({
  id: "env-ssh",
  displayName: "Dev Server (SSH)",
  adapterType: "ssh",
  status: "ready",
});

const failedEnv: Environment = makeEnvironment({
  id: "env-fail",
  displayName: "Broken Host",
  adapterType: "ssh",
  status: "error",
});

const meta: Meta<typeof EnvironmentSelect> = {
  component: EnvironmentSelect,
  title: "Editable/EnvironmentSelect",
  args: {
    onSave: fn(),
    environments: [localEnv, sshEnv],
    value: localEnv.id,
    "data-testid": "env-select",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default state showing the selected environment with status dot. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("env-select-button");
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveTextContent("Local Machine");
  },
};

/** Multiple environments including various statuses. */
export const WithMultipleEnvironments: Story = {
  args: {
    environments: [localEnv, sshEnv, failedEnv],
    value: sshEnv.id,
  },
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("env-select-button");
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveTextContent("Dev Server (SSH)");
  },
};
