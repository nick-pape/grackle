import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { Tooltip } from "./Tooltip.js";

/** Find the portaled tooltip element in document.body by data-testid. */
function getTooltip(testId: string = "tooltip"): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) {
    throw new Error(`Tooltip with data-testid="${testId}" not found`);
  }
  return el;
}

const meta: Meta<typeof Tooltip> = {
  component: Tooltip,
  title: "Primitives/Display/Tooltip",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ padding: 80, display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default tooltip renders with role="tooltip" and starts hidden. */
export const Default: Story = {
  args: {
    text: "Hello tooltip",
    children: <button type="button">Hover me</button>,
  },
  play: async () => {
    const tooltip = getTooltip();
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Hello tooltip");
    // Starts hidden (opacity 0 via CSS class)
    await expect(tooltip.className).not.toContain("visible");
  },
};

/** Tooltip appears on hover and hides on unhover. */
export const ShowsOnHover: Story = {
  args: {
    text: "Hover tooltip",
    delayMs: 0,
    children: <button type="button">Hover me</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Hover me" });
    const tooltip = getTooltip();

    // Hover shows the tooltip
    await userEvent.hover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });

    // Unhover hides it
    await userEvent.unhover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).not.toContain("visible");
    });
  },
};

/** Tooltip appears when child receives keyboard focus. */
export const ShowsOnFocus: Story = {
  args: {
    text: "Focus tooltip",
    delayMs: 0,
    children: <button type="button">Focus me</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Focus me" });
    const tooltip = getTooltip();

    // Tab into the button
    trigger.focus();
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });

    // Blur hides it
    trigger.blur();
    await waitFor(async () => {
      await expect(tooltip.className).not.toContain("visible");
    });
  },
};

/** Escape key dismisses a visible tooltip. */
export const DismissOnEscape: Story = {
  args: {
    text: "Escape me",
    delayMs: 0,
    children: <button type="button">Hover me</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Hover me" });
    const tooltip = getTooltip();

    // Show via hover
    await userEvent.hover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });

    // Escape dismisses
    await userEvent.keyboard("{Escape}");
    await waitFor(async () => {
      await expect(tooltip.className).not.toContain("visible");
    });
  },
};

/** Bottom placement applies the correct CSS class. */
export const PlacementBottom: Story = {
  args: {
    text: "Bottom tooltip",
    placement: "bottom",
    delayMs: 0,
    children: <button type="button">Below me</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tooltip = getTooltip();
    const trigger = canvas.getByRole("button", { name: "Below me" });

    await userEvent.hover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });
    await expect(tooltip.className).toContain("bottom");
  },
};

/** Left placement applies the correct CSS class. */
export const PlacementLeft: Story = {
  args: {
    text: "Left tooltip",
    placement: "left",
    delayMs: 0,
    children: <button type="button">Left of me</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tooltip = getTooltip();
    const trigger = canvas.getByRole("button", { name: "Left of me" });

    await userEvent.hover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });
    await expect(tooltip.className).toContain("left");
  },
};

/** Right placement applies the correct CSS class. */
export const PlacementRight: Story = {
  args: {
    text: "Right tooltip",
    placement: "right",
    delayMs: 0,
    children: <button type="button">Right of me</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tooltip = getTooltip();
    const trigger = canvas.getByRole("button", { name: "Right of me" });

    await userEvent.hover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });
    await expect(tooltip.className).toContain("right");
  },
};

/** Accessibility: aria-describedby links trigger wrapper to tooltip id. */
export const AccessibilityAttributes: Story = {
  args: {
    text: "Accessible tooltip",
    delayMs: 0,
    children: <button type="button">Accessible</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tooltip = getTooltip();
    const trigger = canvas.getByRole("button", { name: "Accessible" });

    // Tooltip has an id and role="tooltip"
    const tooltipId = tooltip.getAttribute("id");
    await expect(tooltipId).toBeTruthy();
    await expect(tooltip).toHaveAttribute("role", "tooltip");

    // Show tooltip so aria-describedby is set
    await userEvent.hover(trigger);
    await waitFor(async () => {
      await expect(tooltip.className).toContain("visible");
    });

    // The wrapper (parent of the button) links to the tooltip
    const wrapper = trigger.closest("[aria-describedby]");
    await expect(wrapper).toBeTruthy();
    await expect(wrapper!.getAttribute("aria-describedby")).toBe(tooltipId);
  },
};

/** inline={false} renders a div wrapper instead of span. */
export const BlockWrapper: Story = {
  args: {
    text: "Block tooltip",
    inline: false,
    children: <button type="button">Block child</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Block child" });
    const wrapper = trigger.parentElement;
    await expect(wrapper).toBeTruthy();
    await expect(wrapper!.tagName).toBe("DIV");
  },
};

/** Custom data-testid is applied to the tooltip element. */
export const CustomTestId: Story = {
  args: {
    text: "Custom id",
    "data-testid": "my-tooltip",
    children: <button type="button">Custom</button>,
  },
  play: async () => {
    const tooltip = getTooltip("my-tooltip");
    await expect(tooltip).toBeInTheDocument();
  },
};
