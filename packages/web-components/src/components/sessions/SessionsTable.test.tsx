// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { Environment, Session, TaskData } from "../../hooks/types.js";
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

const environments: Environment[] = [
  {
    id: "env-local",
    displayName: "Local Dev",
    adapterType: "local",
    adapterConfig: "{}",
    status: "connected",
    bootstrapped: true,
    githubAccountId: "",
  },
  {
    id: "env-docker",
    displayName: "Docker Sandbox",
    adapterType: "docker",
    adapterConfig: "{}",
    status: "disconnected",
    bootstrapped: true,
    githubAccountId: "",
  },
];

const tasks: TaskData[] = [
  {
    id: "task-001",
    workspaceId: "ws-1",
    title: "Implement JWT auth",
    description: "",
    status: "in_progress",
    branch: "",
    latestSessionId: "",
    dependsOn: [],
    sortOrder: 0,
    createdAt: "",
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

const sessions: Session[] = [
  session({
    id: "sess-adhoc",
    environmentId: "env-local",
    status: "running",
    prompt: "Poke at the flaky CI test",
    startedAt: "2026-02-27T09:30:00Z",
    inputTokens: 12_000,
    outputTokens: 3_400,
    costMillicents: 9_000,
  }),
  session({
    id: "sess-task",
    environmentId: "env-local",
    status: "stopped",
    endReason: "completed",
    prompt: "Refactor auth middleware",
    startedAt: "2026-02-27T08:00:00Z",
    taskId: "task-001",
  }),
  session({
    id: "sess-fail",
    environmentId: "env-docker",
    status: "failed",
    prompt: "Add rate limiting",
    startedAt: "2026-02-26T22:00:00Z",
  }),
  session({
    id: "sess-orphan",
    environmentId: "env-gone",
    status: "stopped",
    endReason: "interrupted",
    prompt: "Investigate orphan env",
    startedAt: "2026-02-25T10:00:00Z",
  }),
];

function renderTable(over: Partial<Parameters<typeof SessionsTable>[0]> = {}): {
  onOpenSession: ReturnType<typeof vi.fn>;
  onOpenTask: ReturnType<typeof vi.fn>;
} {
  const onOpenSession = vi.fn();
  const onOpenTask = vi.fn();
  render(
    <SessionsTable
      sessions={sessions}
      environments={environments}
      tasks={tasks}
      onOpenSession={onOpenSession}
      onOpenTask={onOpenTask}
      {...over}
    />,
  );
  return { onOpenSession, onOpenTask };
}

describe("SessionsTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("groups sessions by environment, including a missing environment", () => {
    renderTable();
    expect(screen.getByTestId("session-group-env-local")).toBeTruthy();
    expect(screen.getByTestId("session-group-env-docker")).toBeTruthy();
    expect(screen.getByTestId("session-group-env-gone")).toBeTruthy();
    expect(screen.getByText("missing")).toBeTruthy();
    // The active (running) group surfaces an active pill.
    expect(screen.getByTestId("session-group-active-env-local").textContent).toContain("active");
  });

  it("marks ad-hoc sessions and links task-bound ones", () => {
    renderTable();
    expect(screen.getByTestId("session-adhoc-sess-adhoc").textContent).toContain("ad-hoc");
    expect(screen.getByTestId("session-task-sess-task").textContent).toContain(
      "Implement JWT auth",
    );
  });

  it("falls back to the task id when the task title is unknown", () => {
    renderTable({ tasks: [] });
    expect(screen.getByTestId("session-task-sess-task").textContent).toContain("task-001");
  });

  it("opens a session when its row button is clicked", () => {
    const { onOpenSession } = renderTable();
    fireEvent.click(screen.getByTestId("session-open-sess-adhoc"));
    expect(onOpenSession).toHaveBeenCalledWith("sess-adhoc");
  });

  it("exposes the open control as a native button with no nested interactive (a11y)", () => {
    renderTable();
    const open = screen.getByTestId("session-open-sess-task");
    expect(open.tagName).toBe("BUTTON");
    // The task chip is a sibling button, not nested inside the open control,
    // so there is no invalid nested-interactive ARIA and no key-event hijack.
    expect(open.querySelector("button")).toBeNull();
  });

  it("opens the task without opening the session when the task chip is clicked", () => {
    const { onOpenSession, onOpenTask } = renderTable();
    fireEvent.click(screen.getByTestId("session-task-sess-task"));
    expect(onOpenTask).toHaveBeenCalledWith("task-001");
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("narrows the list with the status filter chips", () => {
    renderTable();
    expect(screen.getByTestId("session-row-sess-fail")).toBeTruthy();
    fireEvent.click(screen.getByTestId("session-filter-success"));
    expect(screen.queryByTestId("session-row-sess-fail")).toBeNull();
    expect(screen.getByTestId("session-row-sess-task")).toBeTruthy();
  });

  it("filters by free-text search across prompt and ids", () => {
    renderTable();
    fireEvent.change(screen.getByTestId("sessions-search"), {
      target: { value: "rate limiting" },
    });
    expect(screen.queryByTestId("session-row-sess-adhoc")).toBeNull();
    expect(screen.getByTestId("session-row-sess-fail")).toBeTruthy();
  });

  it("toggles a group's expanded state", () => {
    renderTable();
    const toggle = screen.getByTestId("session-group-toggle-env-docker");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders an empty state when there are no sessions", () => {
    renderTable({ sessions: [] });
    expect(screen.getByTestId("sessions-empty")).toBeTruthy();
    expect(screen.getByText("No sessions yet")).toBeTruthy();
  });

  it("renders a no-match empty state when filters exclude everything", () => {
    renderTable();
    fireEvent.change(screen.getByTestId("sessions-search"), {
      target: { value: "zzzznomatch" },
    });
    expect(screen.getByText("No matching sessions")).toBeTruthy();
  });
});
