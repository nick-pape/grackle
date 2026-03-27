import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, fn, waitFor } from "@storybook/test";
import { CopyButton } from "./CopyButton.js";

/** Captured writeText mock — set by the decorator, read by play functions. */
let mockWriteText: ReturnType<typeof fn>;

const meta: Meta<typeof CopyButton> = {
  component: CopyButton,
  title: "Display/CopyButton",
  decorators: [
    (Story) => {
      // Mock the clipboard API for Storybook/test environments.
      // navigator.clipboard is a read-only getter in Chromium, so
      // Object.assign fails; use defineProperty to override it.
      mockWriteText = fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });
      return <Story />;
    },
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: "Hello, world!",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("copy-button");
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveTextContent("\uD83D\uDCCB");
  },
};

export const CopiesCorrectText: Story = {
  name: "Click copies text and shows checkmark",
  args: {
    text: "# Hello\n\nSome **bold** markdown",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("copy-button");
    await userEvent.click(button);
    // Verify checkmark appears
    await expect(button).toHaveTextContent("\u2713");
    // Verify correct text was copied
    await expect(mockWriteText).toHaveBeenCalledWith("# Hello\n\nSome **bold** markdown");
  },
};

export const CheckmarkReverts: Story = {
  name: "Checkmark reverts after 2 seconds",
  args: {
    text: "revert test",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("copy-button");
    await userEvent.click(button);
    await expect(button).toHaveTextContent("\u2713");
    // Wait for the checkmark to revert after COPIED_FEEDBACK_DURATION (2s)
    await waitFor(() => expect(button).toHaveTextContent("\uD83D\uDCCB"), { timeout: 3000 });
  },
};

export const CustomTestId: Story = {
  name: "Custom data-testid",
  args: {
    text: "test",
    "data-testid": "my-custom-copy",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("my-custom-copy")).toBeInTheDocument();
  },
};
