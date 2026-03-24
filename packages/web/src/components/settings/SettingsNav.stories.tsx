import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { SettingsNav } from "./SettingsNav.js";

const meta: Meta<typeof SettingsNav> = {
  component: SettingsNav,
};
export default meta;
type Story = StoryObj<typeof meta>;

/** All four tabs are rendered with correct labels. */
export const AllTabsRendered: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Credentials/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Personas/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Appearance/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /About/ })).toBeInTheDocument();
  },
};

/** First tab (Credentials) is selected by default. */
export const DefaultTabIsCredentials: Story = {
  play: async ({ canvas }) => {
    const credentialsTab = canvas.getByRole("tab", { name: /Credentials/ });
    await expect(credentialsTab).toHaveAttribute("aria-selected", "true");
  },
};

/** Keyboard navigation with ArrowDown moves focus to next tab. */
export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    const credentialsTab = canvas.getByRole("tab", { name: /Credentials/ });
    await credentialsTab.focus();

    // ArrowDown should move to Personas
    await userEvent.keyboard("{ArrowDown}");
    const personasTab = canvas.getByRole("tab", { name: /Personas/ });
    await expect(personasTab).toHaveFocus();

    // ArrowDown again to Appearance
    await userEvent.keyboard("{ArrowDown}");
    const appearanceTab = canvas.getByRole("tab", { name: /Appearance/ });
    await expect(appearanceTab).toHaveFocus();

    // Home goes to first tab
    await userEvent.keyboard("{Home}");
    await expect(credentialsTab).toHaveFocus();

    // End goes to last tab
    await userEvent.keyboard("{End}");
    const aboutTab = canvas.getByRole("tab", { name: /About/ });
    await expect(aboutTab).toHaveFocus();
  },
};

/** Tab list has proper ARIA orientation. */
export const AriaOrientation: Story = {
  play: async ({ canvas }) => {
    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    await expect(tablist).toHaveAttribute("aria-label", "Settings");
  },
};
