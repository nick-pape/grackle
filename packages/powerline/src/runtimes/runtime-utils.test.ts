import { describe, it, expect, vi, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));
vi.mock("../worktree.js", () => ({
  ensureWorktree: vi.fn(),
}));

import { buildFindingEvent, buildSubtaskCreateEvent, resolveWorkingDirectory, GRACKLE_MCP_SCRIPT } from "./runtime-utils.js";
import { AsyncQueue } from "../utils/async-queue.js";
import type { AgentEvent } from "./runtime.js";
import { existsSync, readdirSync } from "node:fs";
import { ensureWorktree } from "../worktree.js";

describe("GRACKLE_MCP_SCRIPT", () => {
  it("points to the expected path", () => {
    expect(GRACKLE_MCP_SCRIPT).toBe("/app/mcp-grackle/index.js");
  });
});

describe("buildFindingEvent", () => {
  it("builds a finding event with provided fields", () => {
    const args = { title: "Bug Found", content: "Details here", category: "bug", tags: ["critical"] };
    const raw = { some: "data" };
    const event = buildFindingEvent(args, raw);

    expect(event.type).toBe("finding");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.raw).toBe(raw);

    const finding = JSON.parse(event.content);
    expect(finding.title).toBe("Bug Found");
    expect(finding.content).toBe("Details here");
    expect(finding.category).toBe("bug");
    expect(finding.tags).toEqual(["critical"]);
  });

  it("applies defaults for missing fields", () => {
    const event = buildFindingEvent({}, { raw: true });
    const finding = JSON.parse(event.content);

    expect(finding.title).toBe("Untitled");
    expect(finding.content).toBe("");
    expect(finding.category).toBe("general");
    expect(finding.tags).toEqual([]);
  });
});

describe("buildSubtaskCreateEvent", () => {
  it("builds a subtask_create event with provided fields", () => {
    const args = {
      title: "Design API",
      description: "Design the REST API endpoints",
      local_id: "design",
      depends_on: ["research"],
      can_decompose: true,
    };
    const raw = { some: "data" };
    const event = buildSubtaskCreateEvent(args, raw);

    expect(event.type).toBe("subtask_create");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.raw).toBe(raw);

    const parsed = JSON.parse(event.content);
    expect(parsed.title).toBe("Design API");
    expect(parsed.description).toBe("Design the REST API endpoints");
    expect(parsed.local_id).toBe("design");
    expect(parsed.depends_on).toEqual(["research"]);
    expect(parsed.can_decompose).toBe(true);
  });

  it("applies defaults for missing fields (local_id left empty)", () => {
    const event = buildSubtaskCreateEvent({}, { raw: true });
    const parsed = JSON.parse(event.content);

    expect(parsed.title).toBe("");
    expect(parsed.description).toBe("");
    expect(parsed.local_id).toBe("");
    expect(parsed.depends_on).toEqual([]);
    expect(parsed.can_decompose).toBe(false);
  });

  it("defaults can_decompose to false (not undefined)", () => {
    const event = buildSubtaskCreateEvent({ title: "Task", description: "Do it" }, {});
    const parsed = JSON.parse(event.content);
    expect(parsed.can_decompose).toBe(false);
  });
});

describe("resolveWorkingDirectory", () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(ensureWorktree).mockReset();
  });

  it("returns worktree path when branch and basePath are provided", async () => {
    vi.mocked(ensureWorktree).mockResolvedValue({
      worktreePath: "/worktrees/my-branch",
      branch: "my-branch",
      created: true,
    });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      eventQueue: queue,
    });

    expect(result).toBe("/worktrees/my-branch");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Worktree ready");
    queue.close();
  });

  it("falls back to /workspace when worktree fails", async () => {
    vi.mocked(ensureWorktree).mockRejectedValue(new Error("git error"));
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      eventQueue: queue,
    });

    expect(result).toBe("/workspace");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Worktree setup skipped");
    queue.close();
  });

  it("returns undefined when worktree fails and /workspace does not exist", async () => {
    vi.mocked(ensureWorktree).mockRejectedValue(new Error("git error"));
    vi.mocked(existsSync).mockReturnValue(false);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      eventQueue: queue,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns /workspace when no branch is provided", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue(["file.txt"] as unknown as ReturnType<typeof readdirSync>);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({ eventQueue: queue });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("returns undefined when /workspace does not exist and no branch", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({ eventQueue: queue });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns undefined when requireNonEmpty is true and /workspace is empty", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue([]);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: true,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns /workspace when requireNonEmpty is true and /workspace has files", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue(["README.md"] as unknown as ReturnType<typeof readdirSync>);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: true,
    });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("returns /workspace without checking emptiness when requireNonEmpty is false", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue([]);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: false,
    });

    expect(result).toBe("/workspace");
    expect(readdirSync).not.toHaveBeenCalled();
    queue.close();
  });
});
