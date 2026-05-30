import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "@storybook/test";
import type { Environment, PersonaData, Session, TaskData } from "../../hooks/types.js";
import { SessionsTable } from "./SessionsTable.js";

function session(over: Partial<Session> & { id: string }): Session {
  return {
    environmentId: "env-local",
    runtime: "claude-code",
    status: "running",
    prompt: "Do the thing",
    startedAt: "2026-02-27T08:00:00Z",
    ...over,
  };
}

function env(id: string, displayName: string, status: string = "connected"): Environment {
  return {
    id,
    displayName,
    adapterType: "local",
    adapterConfig: "{}",
    status,
    bootstrapped: true,
    githubAccountId: "",
  };
}

const environments: Environment[] = [
  env("env-local", "Local Dev"),
  env("env-docker", "Docker Sandbox"),
];

const tasks: TaskData[] = [
  {
    id: "task-001",
    workspaceId: "ws-1",
    title: "Implement JWT auth",
    description: "",
    status: "in_progress",
    branch: "",
    latestSessionId: "sess-task",
    dependsOn: [],
    sortOrder: 0,
    createdAt: "2026-02-27T07:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    injectKnowledge: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
];

const personas: PersonaData[] = [
  {
    id: "persona-be",
    name: "Backend Eng",
    description: "",
    systemPrompt: "",
    toolConfig: "",
    runtime: "claude-code",
    model: "",
    maxTurns: 0,
    mcpServers: "",
    createdAt: "",
    updatedAt: "",
    type: "",
    script: "",
    allowedMcpTools: [],
  },
];

const sessions: Session[] = [
  // Ad-hoc, running, on the local env (most recent activity -> first group).
  session({
    id: "sess-adhoc",
    environmentId: "env-local",
    status: "running",
    prompt: "Poke at the failing flaky test in CI",
    startedAt: "2026-02-27T09:30:00Z",
    personaId: "persona-be",
    inputTokens: 12_000,
    outputTokens: 3_400,
    costMillicents: 9_000,
  }),
  // Task-bound, completed, local env.
  session({
    id: "sess-task",
    environmentId: "env-local",
    status: "stopped",
    endReason: "completed",
    prompt: "Refactor the authentication middleware to use JWT tokens",
    startedAt: "2026-02-27T08:00:00Z",
    taskId: "task-001",
    inputTokens: 42_000,
    outputTokens: 8_000,
    costMillicents: 22_000,
  }),
  // Failed, docker env.
  session({
    id: "sess-fail",
    environmentId: "env-docker",
    status: "failed",
    prompt: "Add rate limiting to the public API",
    startedAt: "2026-02-26T22:00:00Z",
    inputTokens: 5_000,
    outputTokens: 900,
  }),
  // Belongs to an environment that no longer exists.
  session({
    id: "sess-orphan",
    environmentId: "env-gone",
    status: "stopped",
    endReason: "interrupted",
    prompt: "Investigate the orphaned environment",
    startedAt: "2026-02-25T10:00:00Z",
  }),
];

const meta: Meta<typeof SessionsTable> = {
  title: "Grackle/Sessions/SessionsTable",
  component: SessionsTable,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "600px", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    sessions,
    environments,
    tasks,
    personas,
    onOpenSession: fn(),
    onOpenTask: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Sessions grouped by environment, ad-hoc and task-bound shown as peers. */
export const Grouped: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("sessions-table")).toBeInTheDocument();
    // Both real environments and the gone one each get a group.
    await expect(canvas.getByTestId("session-group-env-local")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-group-env-docker")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-group-env-gone")).toBeInTheDocument();
    // The gone environment is flagged as missing.
    await expect(canvas.getByText("missing")).toBeInTheDocument();
    // The active (running) group sorts first and shows an active pill.
    await expect(canvas.getByTestId("session-group-active-env-local")).toHaveTextContent("active");
  },
};

/** Ad-hoc sessions get an "ad-hoc" marker; task-bound sessions link to the task. */
export const AdHocAndTaskChips: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByTestId("session-adhoc-sess-adhoc")).toHaveTextContent("ad-hoc");
    const taskChip = canvas.getByTestId("session-task-sess-task");
    await expect(taskChip).toHaveTextContent("Implement JWT auth");
    await userEvent.click(taskChip);
    await expect(args.onOpenTask).toHaveBeenCalledWith("task-001");
    // Clicking the task chip must not also open the session.
    await expect(args.onOpenSession).not.toHaveBeenCalled();
  },
};

/** Clicking a row's open control opens that session. */
export const OpenSession: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId("session-open-sess-adhoc"));
    await expect(args.onOpenSession).toHaveBeenCalledWith("sess-adhoc");
  },
};

/** Status filter chips narrow the visible sessions. */
export const StatusFilter: Story = {
  play: async ({ canvas }) => {
    // All four sessions visible initially.
    await expect(canvas.getByTestId("session-row-sess-fail")).toBeInTheDocument();
    // Filter to Completed -> only the completed task session remains.
    await userEvent.click(canvas.getByTestId("session-filter-success"));
    await waitFor(async () => {
      await expect(canvas.queryByTestId("session-row-sess-fail")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("session-row-sess-task")).toBeInTheDocument();
  },
};

/** Searching filters across prompt, runtime, env, and ids. */
export const Search: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId("sessions-search"), "rate limiting");
    await waitFor(async () => {
      await expect(canvas.queryByTestId("session-row-sess-adhoc")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("session-row-sess-fail")).toBeInTheDocument();
  },
};

/** Collapsing a group hides its rows. */
export const CollapseGroup: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("session-row-sess-fail")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("session-group-toggle-env-docker"));
    await waitFor(async () => {
      await expect(canvas.queryByTestId("session-row-sess-fail")).not.toBeInTheDocument();
    });
  },
};

/** Empty state when there are no sessions at all. */
export const EmptyState: Story = {
  args: { sessions: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("sessions-empty")).toBeInTheDocument();
    await expect(canvas.getByText("No sessions yet")).toBeInTheDocument();
  },
};
