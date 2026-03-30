import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { TaskOverviewPanel } from "./TaskOverviewPanel.js";
import type { TaskData, Workspace, Environment, Session } from "../../hooks/types.js";
import { makeTask, makeEnvironment, makeSession, makeWorkspace } from "../../test-utils/storybook-helpers.js";

const defaultTask: TaskData = makeTask({
  id: "t-1",
  workspaceId: "ws-1",
  title: "Implement auth",
  description: "Add **OAuth2** login flow with refresh tokens.",
  status: "working",
  branch: "feat/auth",
});

const workspace: Workspace = makeWorkspace({
  id: "ws-1",
  name: "My Workspace",
  repoUrl: "https://github.com/example/repo",
});

const env: Environment = makeEnvironment({ id: "env-1", displayName: "Local Dev", status: "connected" });
const session: Session = makeSession({ id: "sess-1", environmentId: "env-1" });

const meta: Meta<typeof TaskOverviewPanel> = {
  title: "Grackle/Panels/TaskOverviewPanel",
  component: TaskOverviewPanel,
  tags: ["autodocs"],
  args: {
    task: defaultTask,
    tasksById: new Map([[defaultTask.id, defaultTask]]),
    environments: [env],
    workspaces: [workspace],
    taskSessions: [session],
    selectedEnvId: "env-1",
  },
};

export default meta;
type Story = StoryObj<typeof TaskOverviewPanel>;

/** Renders status badge, branch link (with repo URL), and markdown description. */
export const BasicOverview: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-overview-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-overview-status-badge")).toBeInTheDocument();
    // Branch pill should contain a link since workspace has repoUrl
    const branchPill = canvas.getByTestId("task-overview-branch");
    await expect(branchPill).toBeInTheDocument();
    const link = branchPill.querySelector("a");
    await expect(link).not.toBeNull();
    // Markdown bold renders
    await expect(canvas.getByText("OAuth2")).toBeInTheDocument();
  },
};

/** All four timeline timestamps render with delta labels. */
export const WithTimeline: Story = {
  args: {
    task: makeTask({
      id: "t-tl",
      status: "complete",
      createdAt: "2026-01-01T10:00:00Z",
      assignedAt: "2026-01-01T10:05:00Z",
      startedAt: "2026-01-01T10:06:00Z",
      completedAt: "2026-01-01T10:36:00Z",
    }),
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    const timeline = canvas.getByTestId("task-overview-timeline");
    await expect(timeline).toBeInTheDocument();
    await expect(canvas.getByText("Created")).toBeInTheDocument();
    await expect(canvas.getByText("Assigned")).toBeInTheDocument();
    await expect(canvas.getByText("Started")).toBeInTheDocument();
    await expect(canvas.getByText("Completed")).toBeInTheDocument();
  },
};

/** Only created and started timestamps render when others are missing. */
export const PartialTimeline: Story = {
  args: {
    task: makeTask({
      id: "t-pt",
      status: "working",
      createdAt: "2026-01-01T10:00:00Z",
      startedAt: "2026-01-01T10:10:00Z",
    }),
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Created")).toBeInTheDocument();
    await expect(canvas.getByText("Started")).toBeInTheDocument();
    await expect(canvas.queryByText("Assigned")).toBeNull();
    await expect(canvas.queryByText("Completed")).toBeNull();
  },
};

/** Shows "No timing data" when no timestamps are set. */
export const NoTimeline: Story = {
  args: {
    task: makeTask({
      id: "t-nt",
      status: "not_started",
      createdAt: "",
    }),
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No timing data")).toBeInTheDocument();
  },
};

/** Dependencies render with check/circle status indicators. */
export const WithDependencies: Story = {
  args: {
    task: makeTask({
      id: "t-dep",
      status: "not_started",
      dependsOn: ["dep-a", "dep-b"],
    }),
    tasksById: new Map([
      ["dep-a", makeTask({ id: "dep-a", title: "Setup DB", status: "complete" })],
      ["dep-b", makeTask({ id: "dep-b", title: "Deploy infra", status: "working" })],
    ]),
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    const deps = canvas.getByTestId("task-overview-dependencies");
    await expect(deps).toBeInTheDocument();
    await expect(canvas.getByText("Setup DB")).toBeInTheDocument();
    await expect(canvas.getByText("Deploy infra")).toBeInTheDocument();
  },
};

/** Empty dependencies show "None". */
export const NoDependencies: Story = {
  args: {
    task: makeTask({ id: "t-nd", dependsOn: [] }),
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("None")).toBeInTheDocument();
  },
};

/** Usage section renders when taskUsage has a positive cost. */
export const WithUsage: Story = {
  args: {
    taskUsage: { inputTokens: 1000, outputTokens: 500, costUsd: 0.15, sessionCount: 2 },
  },
  play: async ({ canvas }) => {
    const usage = canvas.getByTestId("task-overview-usage");
    await expect(usage).toBeInTheDocument();
    await expect(canvas.getByText("Cost")).toBeInTheDocument();
  },
};

/** Tree usage row appears when treeUsage cost exceeds taskUsage cost. */
export const WithTreeUsage: Story = {
  args: {
    task: makeTask({ id: "t-tu", childTaskIds: ["child-1"] }),
    taskUsage: { inputTokens: 1000, outputTokens: 500, costUsd: 0.15, sessionCount: 2 },
    treeUsage: { inputTokens: 5000, outputTokens: 2000, costUsd: 0.85, sessionCount: 6 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Cost")).toBeInTheDocument();
    await expect(canvas.getByText("Total (incl. subtasks)")).toBeInTheDocument();
  },
};

/** Review notes section renders when present. */
export const WithReviewNotes: Story = {
  args: {
    task: makeTask({ id: "t-rn", reviewNotes: "Needs refactoring before merge" }),
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    const notes = canvas.getByTestId("task-overview-review-notes");
    await expect(notes).toBeInTheDocument();
    await expect(canvas.getByText("Needs refactoring before merge")).toBeInTheDocument();
  },
};

/** Environment row shows the session's environment name and status. */
export const WithEnvironment: Story = {
  play: async ({ canvas }) => {
    const envRow = canvas.getByTestId("task-overview-environment");
    await expect(envRow).toBeInTheDocument();
    await expect(canvas.getByText("Local Dev")).toBeInTheDocument();
  },
};

/** Falls back to workspace default environment with label. */
export const FallbackToWorkspaceDefault: Story = {
  args: {
    taskSessions: [],
    selectedEnvId: "env-1",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Local Dev")).toBeInTheDocument();
    await expect(canvas.getByText("(workspace default)")).toBeInTheDocument();
  },
};

/** Branch renders as plain text when workspace has no repoUrl. */
export const BranchWithoutRepoUrl: Story = {
  args: {
    task: makeTask({ id: "t-br", branch: "fix/typo" }),
    workspaces: [makeWorkspace({ id: "ws-1", repoUrl: "" })],
    taskSessions: [],
  },
  play: async ({ canvas }) => {
    const branchPill = canvas.getByTestId("task-overview-branch");
    await expect(branchPill).toBeInTheDocument();
    const link = branchPill.querySelector("a");
    await expect(link).toBeNull();
  },
};
