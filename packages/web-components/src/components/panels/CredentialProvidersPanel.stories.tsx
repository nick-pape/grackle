import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { CredentialProvidersPanel } from "./CredentialProvidersPanel.js";
import { buildCredentialProviderConfig } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof CredentialProvidersPanel> = {
  title: "App/Panels/CredentialProvidersPanel",
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
    // Find the GitHub provider row by its label, then get its select element
    const githubLabel: HTMLElement = canvas.getByText("GitHub");
    const githubRow: HTMLElement = githubLabel.closest("div")!;
    const githubSelect: HTMLSelectElement = githubRow.querySelector("select")!;

    await userEvent.selectOptions(githubSelect, "on");

    await expect(args.onUpdateCredentialProviders).toHaveBeenCalled();
  },
};
