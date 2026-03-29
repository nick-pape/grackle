import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton.js";

// ─── Skeleton (base) ─────────────────────────────────────────────────────────

const skeletonMeta: Meta<typeof Skeleton> = {
  component: Skeleton,
  title: "Primitives/Display/Skeleton",
  tags: ["autodocs"],
};
export default skeletonMeta;
type Story = StoryObj<typeof skeletonMeta>;

/** Default full-width skeleton block. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const el = canvas.getByTestId("skeleton");
    await expect(el).toBeInTheDocument();
    await expect(el).toHaveAttribute("aria-hidden", "true");
    await expect(el.className).toContain("skeleton");
  },
};

/** Circular skeleton (avatar placeholder). */
export const Circular: Story = {
  args: { variant: "circular", width: "48px", height: "48px" },
  play: async ({ canvas }) => {
    const el = canvas.getByTestId("skeleton");
    await expect(el.className).toContain("circular");
  },
};

/** Custom width and height. */
export const CustomSize: Story = {
  args: { width: "200px", height: "2rem" },
  play: async ({ canvas }) => {
    const el = canvas.getByTestId("skeleton");
    await expect(el.style.width).toBe("200px");
    await expect(el.style.height).toBe("2rem");
  },
};

// ─── SkeletonText ────────────────────────────────────────────────────────────

/** Multi-line text placeholder (3 lines, last line shorter). */
export const Text: Story = {
  render: (args) => <SkeletonText {...args} />,
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("skeleton-text");
    await expect(container).toBeInTheDocument();
    const lines = container.querySelectorAll("[data-testid='skeleton']");
    await expect(lines.length).toBe(3);
  },
};

/** Single-line text placeholder. */
export const TextSingleLine: Story = {
  render: () => <SkeletonText lines={1} />,
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("skeleton-text");
    const lines = container.querySelectorAll("[data-testid='skeleton']");
    await expect(lines.length).toBe(1);
  },
};

// ─── SkeletonCard ────────────────────────────────────────────────────────────

/** Card-shaped skeleton with title and body text. */
export const Card: Story = {
  render: (args) => <SkeletonCard {...args} />,
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("skeleton-card");
    await expect(card).toBeInTheDocument();
    // Title skeleton + text container with 2 lines = 3 skeleton elements total
    const skeletons = card.querySelectorAll("[data-testid='skeleton']");
    await expect(skeletons.length).toBe(3);
  },
};

/** Grid of skeleton cards (composition demo). */
export const CardGrid: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-lg)" }}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  ),
  play: async ({ canvas }) => {
    const cards = canvas.getAllByTestId("skeleton-card");
    await expect(cards.length).toBe(3);
  },
};
