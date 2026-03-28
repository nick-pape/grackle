import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { WorkspaceFormFields, defaultFormValues } from "./WorkspaceFormFields.js";
import type { Environment, PersonaData } from "../../hooks/types.js";
import { makeEnvironment, makePersona } from "../../test-utils/storybook-helpers.js";

const envLocal: Environment = makeEnvironment({
  id: "env-1",
  displayName: "Local Machine",
  status: "connected",
});

const envSSH: Environment = makeEnvironment({
  id: "env-2",
  displayName: "Dev Server",
  adapterType: "ssh",
  status: "ready",
});

const personaDefault: PersonaData = makePersona({
  id: "persona-1",
  name: "Code Reviewer",
  description: "Reviews pull requests",
});

const personaWriter: PersonaData = makePersona({
  id: "persona-2",
  name: "Tech Writer",
  description: "Writes documentation",
});

const meta: Meta<typeof WorkspaceFormFields> = {
  component: WorkspaceFormFields,
  title: "Workspace/WorkspaceFormFields",
  args: {
    values: defaultFormValues(),
    onChange: fn(),
    environments: [envLocal, envSSH],
    personas: [personaDefault, personaWriter],
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Empty form with default values. */
export const EmptyForm: Story = {
  play: async ({ canvas }) => {
    const nameInput = canvas.getByTestId("workspace-form-name");
    await expect(nameInput).toBeInTheDocument();
    await expect(nameInput).toHaveValue("");

    const descInput = canvas.getByTestId("workspace-form-description");
    await expect(descInput).toBeInTheDocument();
    await expect(descInput).toHaveValue("");

    const repoInput = canvas.getByTestId("workspace-form-repo");
    await expect(repoInput).toBeInTheDocument();
    await expect(repoInput).toHaveValue("");

    // Environment select should list environments
    const envSelect = canvas.getByTestId("workspace-form-environment");
    await expect(envSelect).toBeInTheDocument();

    // Persona select should be present
    const personaSelect = canvas.getByTestId("workspace-form-persona");
    await expect(personaSelect).toBeInTheDocument();

    // Worktree checkbox should be checked by default
    const worktreeCheckbox = canvas.getByTestId("workspace-form-worktrees");
    await expect(worktreeCheckbox).toBeChecked();
  },
};

/** Form displaying validation errors. */
export const WithErrors: Story = {
  args: {
    values: defaultFormValues(),
    errors: {
      name: "Name is required",
      environmentId: "Environment is required",
      repoUrl: "Invalid URL",
    },
  },
  play: async ({ canvas }) => {
    const nameError = canvas.getByTestId("workspace-form-error-name");
    await expect(nameError).toBeInTheDocument();
    await expect(nameError).toHaveTextContent("Name is required");

    const envError = canvas.getByTestId("workspace-form-error-environmentId");
    await expect(envError).toBeInTheDocument();
    await expect(envError).toHaveTextContent("Environment is required");

    const repoError = canvas.getByTestId("workspace-form-error-repoUrl");
    await expect(repoError).toBeInTheDocument();
    await expect(repoError).toHaveTextContent("Invalid URL");
  },
};

/** Disabled form prevents all interactions. */
export const Disabled: Story = {
  args: {
    values: {
      ...defaultFormValues(),
      name: "My Workspace",
      environmentId: "env-1",
    },
    disabled: true,
  },
  play: async ({ canvas }) => {
    const nameInput = canvas.getByTestId("workspace-form-name");
    await expect(nameInput).toBeDisabled();
    await expect(nameInput).toHaveValue("My Workspace");

    const descInput = canvas.getByTestId("workspace-form-description");
    await expect(descInput).toBeDisabled();

    const repoInput = canvas.getByTestId("workspace-form-repo");
    await expect(repoInput).toBeDisabled();

    const envSelect = canvas.getByTestId("workspace-form-environment");
    await expect(envSelect).toBeDisabled();

    const personaSelect = canvas.getByTestId("workspace-form-persona");
    await expect(personaSelect).toBeDisabled();

    const worktreeCheckbox = canvas.getByTestId("workspace-form-worktrees");
    await expect(worktreeCheckbox).toBeDisabled();

    const workdirInput = canvas.getByTestId("workspace-form-workdir");
    await expect(workdirInput).toBeDisabled();
  },
};
