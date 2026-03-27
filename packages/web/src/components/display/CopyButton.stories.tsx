import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, fn } from "@storybook/test";
import { CopyButton } from "./CopyButton.js";

const meta: Meta<typeof CopyButton> = {
  component: CopyButton,
  title: "Display/CopyButton",
  decorators: [
    (Story) => {
      // Mock the clipboard API for Storybook/test environments.
      // navigator.clipboard is a read-only getter in Chromium, so
      // Object.assign fails; use defineProperty to override it.
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: fn().mockResolvedValue(undefined),
          write: fn().mockResolvedValue(undefined),
        },
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

export const ClickShowsCheckmark: Story = {
  name: "Click toggles to checkmark",
  args: {
    text: "Some text to copy",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("copy-button");
    await userEvent.click(button);
    await expect(button).toHaveTextContent("\u2713");
  },
};

export const WithHtml: Story = {
  name: "Rich copy (HTML + plain text)",
  args: {
    text: "# Hello\n\nSome **bold** text",
    html: "<h1>Hello</h1><p>Some <strong>bold</strong> text</p>",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("copy-button");
    await userEvent.click(button);
    await expect(button).toHaveTextContent("\u2713");
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
