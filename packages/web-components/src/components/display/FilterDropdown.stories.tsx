import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "@storybook/test";
import { FilterDropdown, type FilterDropdownOption } from "./FilterDropdown.js";

const OPTIONS: FilterDropdownOption[] = [
  { key: "connected", label: "Connected" },
  { key: "disconnected", label: "Disconnected" },
  { key: "sleeping", label: "Sleeping" },
  { key: "error", label: "Error" },
];

/** Wrapper that manages open/selected state for interactive stories. */
function FilterDropdownWrapper({
  onToggle,
  onClear,
  onClose,
  initialSelected = [],
}: {
  onToggle?: (key: string) => void;
  onClear?: () => void;
  onClose?: () => void;
  initialSelected?: string[];
}): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <FilterDropdown
        options={OPTIONS}
        selected={selected}
        onToggle={(key) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
              next.delete(key);
            } else {
              next.add(key);
            }
            return next;
          });
          onToggle?.(key);
        }}
        onClear={() => {
          setSelected(new Set());
          onClear?.();
        }}
        onClose={() => onClose?.()}
        data-testid="filter-dropdown"
      />
    </div>
  );
}

const meta: Meta<typeof FilterDropdownWrapper> = {
  component: FilterDropdownWrapper,
  title: "Primitives/Display/FilterDropdown",
  tags: ["autodocs"],
  args: {
    onToggle: fn(),
    onClear: fn(),
    onClose: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** All options visible, none selected. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-dropdown")).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-dropdown-option-connected")).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-dropdown-option-disconnected")).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-dropdown-option-sleeping")).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-dropdown-option-error")).toBeInTheDocument();
    await expect(canvas.queryByTestId("filter-dropdown-clear")).not.toBeInTheDocument();
  },
};

/** Clicking an option fires onToggle and shows check mark. */
export const SelectOption: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-dropdown-option-connected"));
    await expect(args.onToggle).toHaveBeenCalledWith("connected");
    await waitFor(async () => {
      await expect(canvas.getByTestId("filter-dropdown-clear")).toBeInTheDocument();
    });
  },
};

/** Multi-select: two options can be selected simultaneously. */
export const MultiSelect: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-dropdown-option-connected"));
    await userEvent.click(canvas.getByTestId("filter-dropdown-option-error"));
    await expect(args.onToggle).toHaveBeenCalledTimes(2);
    await waitFor(async () => {
      await expect(canvas.getByTestId("filter-dropdown-clear")).toBeInTheDocument();
    });
  },
};

/** Escape key fires onClose. */
export const EscapeCloses: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-dropdown")).toBeInTheDocument();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** Clear button fires onClear and hides itself. */
export const ClearAll: Story = {
  args: {
    initialSelected: ["connected", "error"],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-dropdown-clear")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("filter-dropdown-clear"));
    await expect(args.onClear).toHaveBeenCalledOnce();
    await waitFor(async () => {
      await expect(canvas.queryByTestId("filter-dropdown-clear")).not.toBeInTheDocument();
    });
  },
};
