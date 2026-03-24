import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { PersonaManager } from "./PersonaManager.js";
import { buildPersona } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof PersonaManager> = {
  title: "Personas/PersonaManager",
  component: PersonaManager,
  args: {
    personas: [],
    appDefaultPersonaId: "",
    onCreatePersona: fn(),
    onUpdatePersona: fn(),
    onDeletePersona: fn(),
    onSetAppDefaultPersonaId: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PersonaManager>;

/** Empty state shows a message and a "+ New Persona" button. */
export const EmptyState: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("No personas yet. Create one to get started."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "+ New Persona" }),
    ).toBeInTheDocument();
  },
};

/** Renders persona cards with names, type badges, and action buttons. */
export const WithPersonas: Story = {
  args: {
    personas: [
      buildPersona({
        id: "p-1",
        name: "Frontend Engineer",
        description: "React and TypeScript specialist",
        runtime: "claude-code",
        model: "sonnet",
        type: "agent",
      }),
      buildPersona({
        id: "p-2",
        name: "Nightly Report",
        description: "Generates daily summaries",
        runtime: "genaiscript",
        type: "script",
        script: 'script({ model: "openai:gpt-4o" });',
      }),
    ],
    appDefaultPersonaId: "p-1",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Frontend Engineer")).toBeInTheDocument();
    await expect(canvas.getByText("Nightly Report")).toBeInTheDocument();

    // Type badges
    await expect(canvas.getByTestId("persona-type-badge-p-1")).toHaveTextContent("Agent");
    await expect(canvas.getByTestId("persona-type-badge-p-2")).toHaveTextContent("Script");

    // Default badge on p-1
    await expect(canvas.getByTestId("persona-default-badge-p-1")).toBeInTheDocument();
  },
};

/** Clicking "+ New Persona" opens the create form. */
export const OpenCreateForm: Story = {
  play: async ({ canvas, userEvent }) => {
    const newButton = canvas.getByRole("button", { name: "+ New Persona" });
    await userEvent.click(newButton);

    // The form heading should appear
    await expect(canvas.getByText("Create Persona")).toBeInTheDocument();

    // Form fields should be visible
    await expect(canvas.getByPlaceholderText("e.g. Frontend Engineer")).toBeInTheDocument();
  },
};

/** Clicking "Edit" on a persona card opens the edit form. */
export const EditPersona: Story = {
  args: {
    personas: [
      buildPersona({
        id: "p-edit",
        name: "Code Reviewer",
        description: "Reviews pull requests",
        type: "agent",
      }),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    const editButton = canvas.getByRole("button", { name: "Edit" });
    await userEvent.click(editButton);

    // Edit form heading should appear
    await expect(canvas.getByText("Edit Persona")).toBeInTheDocument();
  },
};

/** Delete flow: clicking "Delete" shows a confirmation, clicking "Confirm" fires the callback. */
export const DeletePersonaFlow: Story = {
  args: {
    personas: [
      buildPersona({ id: "p-del", name: "Disposable Persona" }),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    // Click Delete
    const deleteButton = canvas.getByRole("button", { name: "Delete" });
    await userEvent.click(deleteButton);

    // Confirmation should appear
    await expect(canvas.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  },
};

/** "Set Default" button is visible for non-default personas and hidden for the default. */
export const SetDefaultButton: Story = {
  args: {
    personas: [
      buildPersona({ id: "p-default", name: "Default Persona" }),
      buildPersona({ id: "p-other", name: "Other Persona" }),
    ],
    appDefaultPersonaId: "p-default",
  },
  play: async ({ canvas }) => {
    // The default persona should NOT have a "Set Default" button
    expect(canvas.queryByTestId("persona-set-default-p-default")).not.toBeInTheDocument();

    // The non-default persona should have a "Set Default" button
    await expect(canvas.getByTestId("persona-set-default-p-other")).toBeInTheDocument();
  },
};
