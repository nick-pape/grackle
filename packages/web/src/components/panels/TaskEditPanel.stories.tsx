import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "../../context/ToastContext.js";
import { buildWorkspace, buildPersona } from "../../test-utils/storybook-helpers.js";
import { TaskEditPanel } from "./TaskEditPanel.js";

const defaultWorkspace = buildWorkspace({ id: "ws-001", name: "Test Workspace" });

const meta: Meta<typeof TaskEditPanel> = {
  title: "Panels/TaskEditPanel",
  component: TaskEditPanel,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    mode: "new",
    workspaceId: "ws-001",
    tasks: [],
    workspaces: [defaultWorkspace],
    personas: [buildPersona({ id: "p-1", name: "Coder" })],
    onCreateTask: fn(),
    onUpdateTask: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof TaskEditPanel>;

/** New task form shows title and description fields plus a disabled Create button. */
export const FormFieldsVisible: Story = {
  play: async ({ canvas }) => {
    // Title input
    const titleInput = canvas.getByTestId("task-edit-title");
    await expect(titleInput).toBeInTheDocument();

    // Description textarea
    const descriptionInput = canvas.getByTestId("task-edit-description");
    await expect(descriptionInput).toBeInTheDocument();

    // Save/Create button present and disabled (no title entered)
    const saveButton = canvas.getByTestId("task-edit-save");
    await expect(saveButton).toBeInTheDocument();
    await expect(saveButton).toBeDisabled();
  },
};

/** The Cancel button is visible in the new task form. */
export const CancelButtonVisible: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-edit-title")).toBeInTheDocument();

    const cancelButton = canvas.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeInTheDocument();
  },
};

/**
 * The task creation form has no environment dropdown -- environment is
 * assigned at start time, not creation time.
 */
export const NoEnvironmentDropdown: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-edit-title")).toBeInTheDocument();

    // There should be no element mentioning "Default env" or "test-local"
    // as environment options in the form.
    const allSelects = canvas.getAllByRole("combobox");
    for (const select of allSelects) {
      // None of the selects should contain environment-like options
      const options = select.querySelectorAll("option");
      for (const option of options) {
        await expect(option.textContent).not.toMatch(/Default env|test-local/);
      }
    }
  },
};
