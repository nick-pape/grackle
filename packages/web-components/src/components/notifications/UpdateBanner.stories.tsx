import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { UpdateBanner } from "./UpdateBanner.js";

const meta: Meta<typeof UpdateBanner> = {
  title: "App/Notifications/UpdateBanner",
  component: UpdateBanner,
};

export default meta;
type Story = StoryObj<typeof UpdateBanner>;

/** npm user sees an update available with install instructions. */
export const NpmUpdate: Story = {
  args: {
    currentVersion: "0.76.0",
    latestVersion: "0.77.0",
    updateAvailable: true,
    isDocker: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("update-banner")).toBeInTheDocument();
    await expect(canvas.getByText(/npm install/)).toBeInTheDocument();
  },
};

/** Docker user sees an update available with pull instructions. */
export const DockerUpdate: Story = {
  args: {
    currentVersion: "0.76.0",
    latestVersion: "0.77.0",
    updateAvailable: true,
    isDocker: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("update-banner")).toBeInTheDocument();
    await expect(canvas.getByText(/docker pull/)).toBeInTheDocument();
  },
};

/** No update available — banner is hidden. */
export const NoUpdate: Story = {
  args: {
    currentVersion: "0.76.0",
    latestVersion: "0.76.0",
    updateAvailable: false,
    isDocker: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("update-banner")).not.toBeInTheDocument();
  },
};

/** User dismisses the banner — Callout hides its content after clicking the close button. */
export const Dismissed: Story = {
  args: {
    currentVersion: "0.76.0",
    latestVersion: "0.77.0",
    updateAvailable: true,
    isDocker: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByTestId("update-banner");
    await expect(banner).toBeInTheDocument();

    // Click dismiss — Callout hides its content via internal state
    const dismissButton = canvas.getByLabelText("Dismiss");
    await userEvent.click(dismissButton);

    // After dismiss, the Callout renders empty — verify the info text is gone
    await expect(canvas.queryByText(/0\.77\.0/)).toBeNull();
  },
};
