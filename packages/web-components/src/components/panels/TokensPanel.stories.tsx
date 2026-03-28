import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { MOCK_TOKENS } from "../../test-utils/storybook-helpers.js";
import { TokensPanel } from "./TokensPanel.js";

const meta: Meta<typeof TokensPanel> = {
  title: "App/Panels/TokensPanel",
  component: TokensPanel,
  args: {
    tokens: MOCK_TOKENS,
    onSetToken: fn(),
    onDeleteToken: fn(),
    onShowToast: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof TokensPanel>;

/** Displays the three mock tokens with their names and targets visible. */
export const MockTokensDisplayed: Story = {
  play: async ({ canvas }) => {
    // All three token names should be visible
    await expect(canvas.getByText("anthropic")).toBeInTheDocument();
    await expect(canvas.getByText("github")).toBeInTheDocument();
    await expect(canvas.getByText("gcp-service-account")).toBeInTheDocument();

    // Targets should be shown
    await expect(canvas.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    await expect(canvas.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    await expect(canvas.getByText("/home/user/.config/gcloud/credentials.json")).toBeInTheDocument();
  },
};

/** The add token form is present with name, value inputs and an Add Token button. */
export const AddFormPresent: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Token name")).toBeInTheDocument();
    await expect(canvas.getByPlaceholderText("Value")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Add Token" })).toBeInTheDocument();
  },
};

/** Filling in and submitting the form calls onSetToken with the correct args. */
export const AddFormFunctional: Story = {
  play: async ({ canvas, args }) => {
    const nameInput = canvas.getByPlaceholderText("Token name");
    const valueInput = canvas.getByPlaceholderText("Value");
    const envVarInput = canvas.getByPlaceholderText(/Env var name/);
    const addButton = canvas.getByRole("button", { name: "Add Token" });

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "new-mock-token");
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, "mock-value");
    await userEvent.clear(envVarInput);
    await userEvent.type(envVarInput, "NEW_MOCK_TOKEN");
    await userEvent.click(addButton);

    await expect(args.onSetToken).toHaveBeenCalledWith(
      "new-mock-token",
      "mock-value",
      "env_var",
      "NEW_MOCK_TOKEN",
      "",
    );
  },
};

/** Clicking the delete button on a token shows a confirm dialog, and confirming calls onDeleteToken. */
export const DeleteRemovesFromList: Story = {
  play: async ({ canvas, args }) => {
    // Click the delete button for the "anthropic" token
    const deleteButton = canvas.getByTitle("Delete anthropic");
    await userEvent.click(deleteButton);

    // Confirm dialog should appear (use findBy for async rendering after animation)
    await expect(await canvas.findByText("Delete Token?")).toBeInTheDocument();
    // "anthropic" appears in both the dialog description and the token list
    const anthropicElements = canvas.getAllByText(/anthropic/);
    await expect(anthropicElements.length).toBeGreaterThanOrEqual(1);

    // Confirm deletion — the ConfirmDialog button label defaults to "Delete"
    const confirmButton = await canvas.findByRole("button", { name: "Delete" });
    await userEvent.click(confirmButton);

    await expect(args.onDeleteToken).toHaveBeenCalledWith("anthropic");
  },
};

/** Switching the type selector from env_var to file changes the placeholder text. */
export const TypeSelectorSwitchesFields: Story = {
  play: async ({ canvas }) => {
    // Default type is env_var — placeholder should show env var
    await expect(canvas.getByPlaceholderText(/Env var name/)).toBeInTheDocument();

    // Switch to file type
    const select = canvas.getByDisplayValue("Environment Variable");
    await userEvent.selectOptions(select, "file");

    // Placeholder should change to file path
    await expect(canvas.getByPlaceholderText(/File path/)).toBeInTheDocument();
  },
};

/** The description text explaining token auto-push behavior is visible. */
export const DescriptionTextVisible: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/API tokens are auto-pushed to environments when set or updated/),
    ).toBeInTheDocument();
  },
};

/** After adding a token, the name and value fields are cleared. */
export const FormClearsAfterAdd: Story = {
  play: async ({ canvas }) => {
    const nameInput = canvas.getByPlaceholderText("Token name");
    const valueInput = canvas.getByPlaceholderText("Value");
    const addButton = canvas.getByRole("button", { name: "Add Token" });

    await userEvent.type(nameInput, "clear-test");
    await userEvent.type(valueInput, "clearval");
    await userEvent.click(addButton);

    // Fields should be cleared after submit
    await expect(nameInput).toHaveValue("");
    await expect(valueInput).toHaveValue("");
  },
};
