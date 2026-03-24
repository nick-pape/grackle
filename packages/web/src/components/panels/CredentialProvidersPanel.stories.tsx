import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { CredentialProvidersPanel } from "./CredentialProvidersPanel.js";
import { buildCredentialProviderConfig } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof CredentialProvidersPanel> = {
  title: "Panels/CredentialProvidersPanel",
  component: CredentialProvidersPanel,
  args: {
    credentialProviders: buildCredentialProviderConfig(),
    onUpdateCredentialProviders: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CredentialProvidersPanel>;

/** Default state with all providers set to "off". */
export const AllProvidersOff: Story = {
  play: async ({ canvas }) => {
    // All five provider labels should be visible
    await expect(canvas.getByText("Claude")).toBeInTheDocument();
    await expect(canvas.getByText("GitHub")).toBeInTheDocument();
    await expect(canvas.getByText("Copilot")).toBeInTheDocument();
    await expect(canvas.getByText("Codex")).toBeInTheDocument();
    await expect(canvas.getByText("Goose")).toBeInTheDocument();

    // Section title should be present
    await expect(canvas.getByText("Credential Providers")).toBeInTheDocument();
  },
};

/** Some providers enabled. */
export const SomeProvidersEnabled: Story = {
  args: {
    credentialProviders: buildCredentialProviderConfig({
      claude: "subscription",
      github: "on",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Claude")).toBeInTheDocument();
    await expect(canvas.getByText("GitHub")).toBeInTheDocument();
  },
};

/** Changing a provider selection fires the onUpdateCredentialProviders callback. */
export const ChangingProviderFiresCallback: Story = {
  args: {
    onUpdateCredentialProviders: fn(),
  },
  play: async ({ canvas, args }) => {
    // Find all select elements — one per provider (Claude, GitHub, Copilot, Codex, Goose)
    const selects = canvas.getAllByDisplayValue("Off");
    // The second select should be GitHub (Claude=0, GitHub=1, Copilot=2, Codex=3, Goose=4)
    const githubSelect = selects[1];

    await userEvent.selectOptions(githubSelect, "on");

    // The callback should have been called
    await expect(args.onUpdateCredentialProviders).toHaveBeenCalled();
  },
};
