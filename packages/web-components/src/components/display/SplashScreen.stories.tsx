import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { SplashScreen } from "./SplashScreen.js";

const meta: Meta<typeof SplashScreen> = {
  component: SplashScreen,
  title: "Primitives/Display/SplashScreen",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default splash screen with logo and spinner. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const splash = canvas.getByTestId("splash-screen");
    await expect(splash).toBeInTheDocument();
    // Should contain the logo image
    const logo = canvas.getByAltText("Grackle");
    await expect(logo).toBeInTheDocument();
    // Should contain a spinner with live region
    const spinner = canvas.getByRole("status");
    await expect(spinner).toBeInTheDocument();
    await expect(spinner).toHaveAttribute("aria-label", "Loading Grackle");
  },
};
