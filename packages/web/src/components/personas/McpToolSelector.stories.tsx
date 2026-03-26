import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { McpToolSelector } from "./McpToolSelector.js";
import {
  DEFAULT_SCOPED_MCP_TOOLS,
  WORKER_MCP_TOOLS,
  ALL_MCP_TOOL_NAMES,
} from "@grackle-ai/common";

const meta: Meta<typeof McpToolSelector> = {
  title: "Personas/McpToolSelector",
  component: McpToolSelector,
  args: {
    selectedTools: [],
    onChange: fn(),
    disabled: false,
  },
};

export default meta;
type Story = StoryObj<typeof McpToolSelector>;

export const EmptySelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Verify preset buttons are visible
    await expect(canvas.getByTestId("preset-default")).toBeInTheDocument();
    await expect(canvas.getByTestId("preset-worker")).toBeInTheDocument();
    await expect(canvas.getByTestId("preset-orchestrator")).toBeInTheDocument();
    await expect(canvas.getByTestId("preset-admin")).toBeInTheDocument();
    // Verify filter input is visible
    await expect(canvas.getByTestId("mcp-tool-filter")).toBeInTheDocument();
    // Verify "Using default" text
    await expect(canvas.getByText("Using default (18 tools)")).toBeInTheDocument();
  },
};

export const WithPresetDefault: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("preset-default"));
    await expect(args.onChange).toHaveBeenCalledWith(
      expect.arrayContaining([...DEFAULT_SCOPED_MCP_TOOLS]),
    );
  },
};

export const WithPresetWorker: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("preset-worker"));
    await expect(args.onChange).toHaveBeenCalledWith(
      expect.arrayContaining([...WORKER_MCP_TOOLS]),
    );
  },
};

export const CustomSelection: Story = {
  args: {
    selectedTools: ["finding_post", "task_list", "workpad_read"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Verify selected tools are checked
    const findingPost = canvas.getByTestId("tool-finding_post") as HTMLInputElement;
    await expect(findingPost.checked).toBe(true);
    const taskList = canvas.getByTestId("tool-task_list") as HTMLInputElement;
    await expect(taskList.checked).toBe(true);
    // Verify unselected tool is not checked
    const envList = canvas.getByTestId("tool-env_list") as HTMLInputElement;
    await expect(envList.checked).toBe(false);
    // Verify count display
    await expect(canvas.getByText(`3 of ${ALL_MCP_TOOL_NAMES.size} tools selected`)).toBeInTheDocument();
  },
};

export const ToggleIndividualTool: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("tool-finding_post"));
    await expect(args.onChange).toHaveBeenCalledWith(["finding_post"]);
  },
};

export const SearchFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filterInput = canvas.getByTestId("mcp-tool-filter");
    await userEvent.type(filterInput, "finding");
    // finding group should be visible with its tools
    await expect(canvas.getByTestId("tool-group-finding")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-finding_post")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-finding_list")).toBeInTheDocument();
    // env group should be hidden (no match)
    await expect(canvas.queryByTestId("tool-group-env")).not.toBeInTheDocument();
  },
};

export const GroupSelectAll: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Click the "task" group toggle to select all task tools
    await userEvent.click(canvas.getByTestId("group-toggle-task"));
    const called = (args.onChange as ReturnType<typeof fn>).mock.calls[0][0] as string[];
    // Should include all task tools
    await expect(called).toContain("task_list");
    await expect(called).toContain("task_create");
    await expect(called).toContain("task_show");
    await expect(called).toContain("task_start");
    await expect(called).toContain("task_complete");
  },
};

export const DisabledState: Story = {
  args: {
    disabled: true,
    selectedTools: ["finding_post"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Preset buttons should be disabled
    await expect(canvas.getByTestId("preset-default")).toBeDisabled();
    // Filter input should be disabled
    await expect(canvas.getByTestId("mcp-tool-filter")).toBeDisabled();
    // Tool checkboxes should be disabled
    await expect(canvas.getByTestId("tool-finding_post")).toBeDisabled();
  },
};
