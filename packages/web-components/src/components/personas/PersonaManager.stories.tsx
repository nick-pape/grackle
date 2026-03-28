import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { PersonaManager } from "./PersonaManager.js";
import { buildPersona } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof PersonaManager> = {
  title: "Grackle/Personas/PersonaManager",
  tags: ["autodocs"],
  component: PersonaManager,
  args: {
    personas: [],
    appDefaultPersonaId: "",
    onDeletePersona: fn(),
    onSetAppDefaultPersonaId: fn(),
    onNavigateToNew: fn(),
    onNavigateToPersona: fn(),
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

/** Clicking "+ New Persona" calls onNavigateToNew. */
export const ClickNewPersona: Story = {
  play: async ({ canvas, args }) => {
    const newButton = canvas.getByRole("button", { name: "+ New Persona" });
    await userEvent.click(newButton);

    await expect(args.onNavigateToNew).toHaveBeenCalled();
  },
};

/** Clicking a persona card calls onNavigateToPersona. */
export const ClickPersonaCard: Story = {
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
  play: async ({ canvas, args }) => {
    const card = canvas.getByTestId("persona-card-p-edit");
    await userEvent.click(card);

    await expect(args.onNavigateToPersona).toHaveBeenCalledWith("p-edit");
  },
};

/** Delete flow: clicking "Delete" shows a confirmation dialog. */
export const DeletePersonaFlow: Story = {
  args: {
    personas: [
      buildPersona({ id: "p-del", name: "Disposable Persona" }),
    ],
  },
  play: async ({ canvas, args }) => {
    // Click Delete within the card actions
    const deleteButton = canvas.getByTestId("persona-delete-p-del");
    await userEvent.click(deleteButton);

    // Confirmation dialog should appear
    await expect(canvas.getByText("Delete Persona?")).toBeInTheDocument();

    const dialog = canvas.getByRole("dialog", { name: "Delete Persona?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await expect(args.onDeletePersona).toHaveBeenCalledWith("p-del");
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
    await expect(canvas.queryByTestId("persona-set-default-p-default")).not.toBeInTheDocument();

    // The non-default persona should have a "Set Default" button
    await expect(canvas.getByTestId("persona-set-default-p-other")).toBeInTheDocument();
  },
};
