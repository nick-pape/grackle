import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// ── Mock ws-broadcast to avoid WebSocket dependency in tests ─────
vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

// ── Mock logger to suppress output during tests ─────────────────
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Mock child_process for gh CLI calls ─────────────────────────
// execFile is callback-based; we mock it to call the callback immediately.
// vi.hoisted ensures the variable is available when the hoisted vi.mock runs.
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// Import modules AFTER mocks are set up
import {
  topologicalSortIssues,
  fetchGitHubIssues,
  importGitHubIssues,
  buildDescriptionWithComments,
} from "./github-import.js";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import { sqlite } from "./test-db.js";
import { emit } from "./event-bus.js";

/** Helper to build a minimal issue-like object for topological sort tests. */
function issue(
  number: number,
  parentNumber?: number,
): { number: number; parentNumber: number | undefined } {
  return { number, parentNumber };
}

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      default_env_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      worktree_base_path TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      branch        TEXT NOT NULL DEFAULT '',
      depends_on    TEXT NOT NULL DEFAULT '[]',
      assigned_at   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      review_notes  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      parent_task_id TEXT NOT NULL DEFAULT '',
      depth         INTEGER NOT NULL DEFAULT 0,
      can_decompose INTEGER NOT NULL DEFAULT 0,
      default_persona_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

/**
 * Configure mockExecFile to invoke the callback with the given stdout JSON.
 * Supports chaining multiple responses for pagination tests.
 */
function mockGhResponse(json: unknown): void {
  const stdout = JSON.stringify(json);
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, stdout, "");
    },
  );
}

// ── buildDescriptionWithComments tests ──────────────────────────

describe("buildDescriptionWithComments", () => {
  it("returns the body unchanged when there are no comments", () => {
    const result = buildDescriptionWithComments("Issue body", []);
    expect(result).toBe("Issue body");
  });

  it("appends a single comment with author and timestamp", () => {
    const result = buildDescriptionWithComments("Body", [
      { author: "alice", createdAt: "2026-03-13T10:00:00Z", body: "A comment" },
    ]);
    expect(result).toContain("Body");
    expect(result).toContain("---");
    expect(result).toContain("**@alice**");
    expect(result).toContain("2026-03-13T10:00:00Z");
    expect(result).toContain("A comment");
  });

  it("appends multiple comments separated by --- dividers", () => {
    const result = buildDescriptionWithComments("Body", [
      { author: "alice", createdAt: "2026-03-13T10:00:00Z", body: "First" },
      { author: "bob", createdAt: "2026-03-13T11:00:00Z", body: "Second" },
    ]);
    const dividerCount = (result.match(/---/g) ?? []).length;
    expect(dividerCount).toBe(2);
    expect(result.indexOf("**@alice**")).toBeLessThan(result.indexOf("**@bob**"));
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("preserves markdown in the comment body", () => {
    const md = "## Heading\n\n- item 1\n- item 2";
    const result = buildDescriptionWithComments("Body", [
      { author: "alice", createdAt: "2026-01-01T00:00:00Z", body: md },
    ]);
    expect(result).toContain(md);
  });

  it("handles an empty issue body with comments", () => {
    const result = buildDescriptionWithComments("", [
      { author: "alice", createdAt: "2026-01-01T00:00:00Z", body: "Comment" },
    ]);
    expect(result).toContain("---");
    expect(result).toContain("**@alice**");
    expect(result).toContain("Comment");
  });

  it("appends a truncation notice when hasMoreComments is true", () => {
    const result = buildDescriptionWithComments(
      "Body",
      [{ author: "alice", createdAt: "2026-01-01T00:00:00Z", body: "Comment" }],
      true,
    );
    expect(result).toContain("additional comments");
    expect(result).toContain("GitHub");
  });

  it("does not append a truncation notice when hasMoreComments is false", () => {
    const result = buildDescriptionWithComments(
      "Body",
      [{ author: "alice", createdAt: "2026-01-01T00:00:00Z", body: "Comment" }],
      false,
    );
    expect(result).not.toContain("additional comments");
  });
});

// ── topologicalSortIssues tests ─────────────────────────────────

describe("topologicalSortIssues", () => {
  describe("basic ordering", () => {
    it("returns issues unchanged when there are no parent relationships", () => {
      const issues = [issue(1), issue(2), issue(3)];
      const issueSet = new Set([1, 2, 3]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted.map((i) => i.number)).toEqual([1, 2, 3]);
    });

    it("places a parent before its child", () => {
      const issues = [issue(2, 1), issue(1)];
      const issueSet = new Set([1, 2]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted.map((i) => i.number)).toEqual([1, 2]);
    });

    it("handles a chain of three levels (grandparent → parent → child)", () => {
      const issues = [issue(3, 2), issue(2, 1), issue(1)];
      const issueSet = new Set([1, 2, 3]);
      const sorted = topologicalSortIssues(issues, issueSet);
      const order = sorted.map((i) => i.number);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
    });

    it("handles multiple children of the same parent", () => {
      const issues = [issue(3, 1), issue(2, 1), issue(1)];
      const issueSet = new Set([1, 2, 3]);
      const sorted = topologicalSortIssues(issues, issueSet);
      const order = sorted.map((i) => i.number);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
    });
  });

  describe("external parents", () => {
    it("treats issues with a parent outside the import set as roots", () => {
      const issues = [issue(10, 99), issue(11)];
      const issueSet = new Set([10, 11]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted.map((i) => i.number)).toEqual([10, 11]);
    });

    it("still orders children correctly when only the parent is external", () => {
      const issues = [issue(21, 20), issue(20, 99)];
      const issueSet = new Set([20, 21]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted.map((i) => i.number)).toEqual([20, 21]);
    });
  });

  describe("mixed forest", () => {
    it("handles a mix of root issues and parent-child trees", () => {
      const issues = [issue(5, 3), issue(4), issue(3, 1), issue(2), issue(1)];
      const issueSet = new Set([1, 2, 3, 4, 5]);
      const sorted = topologicalSortIssues(issues, issueSet);
      const order = sorted.map((i) => i.number);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
      expect(order.indexOf(3)).toBeLessThan(order.indexOf(5));
      expect(sorted).toHaveLength(5);
    });
  });

  describe("edge cases", () => {
    it("handles an empty list", () => {
      const sorted = topologicalSortIssues([], new Set());
      expect(sorted).toEqual([]);
    });

    it("handles a single issue with no parent", () => {
      const sorted = topologicalSortIssues([issue(42)], new Set([42]));
      expect(sorted).toHaveLength(1);
      expect(sorted[0].number).toBe(42);
    });

    it("handles a single issue with an external parent", () => {
      const sorted = topologicalSortIssues([issue(42, 99)], new Set([42]));
      expect(sorted).toHaveLength(1);
      expect(sorted[0].number).toBe(42);
    });

    it("preserves additional properties on issue objects", () => {
      const issues = [
        { number: 2, parentNumber: 1 as number | undefined, title: "Child" },
        { number: 1, parentNumber: undefined, title: "Parent" },
      ];
      const sorted = topologicalSortIssues(issues, new Set([1, 2]));
      expect(sorted[0].title).toBe("Parent");
      expect(sorted[1].title).toBe("Child");
    });

    it("handles duplicate visits gracefully (shared ancestor)", () => {
      const issues = [issue(3, 1), issue(2, 1), issue(1)];
      const issueSet = new Set([1, 2, 3]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted).toHaveLength(3);
      const numbers = sorted.map((i) => i.number);
      expect(new Set(numbers).size).toBe(3);
    });

    it("handles a cycle gracefully (does not infinite loop)", () => {
      const issues = [issue(1, 2), issue(2, 1)];
      const issueSet = new Set([1, 2]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted).toHaveLength(2);
    });
  });

  describe("ordering stability", () => {
    it("preserves original order among unrelated issues", () => {
      const issues = [issue(10), issue(5), issue(20), issue(1)];
      const issueSet = new Set([10, 5, 20, 1]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted.map((i) => i.number)).toEqual([10, 5, 20, 1]);
    });

    it("preserves sibling order for children of the same parent", () => {
      const issues = [issue(1), issue(30, 1), issue(20, 1), issue(10, 1)];
      const issueSet = new Set([1, 30, 20, 10]);
      const sorted = topologicalSortIssues(issues, issueSet);
      const order = sorted.map((i) => i.number);
      expect(order[0]).toBe(1);
      expect(order.indexOf(30)).toBeLessThan(order.indexOf(20));
      expect(order.indexOf(20)).toBeLessThan(order.indexOf(10));
    });
  });

  describe("large input", () => {
    it("handles a deep chain of 100 issues", () => {
      const issues = [];
      for (let i = 100; i >= 1; i--) {
        issues.push(issue(i, i > 1 ? i - 1 : undefined));
      }
      const issueSet = new Set(issues.map((i) => i.number));
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted).toHaveLength(100);
      for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        if (current.parentNumber !== undefined) {
          const parentIdx = sorted.findIndex(
            (s) => s.number === current.parentNumber,
          );
          expect(parentIdx).toBeLessThan(i);
        }
      }
    });

    it("handles a wide tree with 50 children of one parent", () => {
      const issues = [issue(1)];
      for (let i = 2; i <= 51; i++) {
        issues.push(issue(i, 1));
      }
      const issueSet = new Set(issues.map((i) => i.number));
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted).toHaveLength(51);
      expect(sorted[0].number).toBe(1);
    });
  });
});

// ── fetchGitHubIssues tests ─────────────────────────────────────

describe("fetchGitHubIssues", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("throws on invalid repo format", async () => {
    await expect(fetchGitHubIssues("badrepo", "open")).rejects.toThrow(
      'repo must be in "owner/repo" format',
    );
  });

  it("throws on extra path segments in repo format", async () => {
    await expect(fetchGitHubIssues("owner/repo/extra", "open")).rejects.toThrow(
      'repo must be in "owner/repo" format',
    );
  });

  it("throws when gh CLI execution fails", async () => {
    const ghError = new Error("Command failed: gh api graphql");
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(ghError, "", "gh: not found");
      },
    );
    await expect(fetchGitHubIssues("owner/repo", "open")).rejects.toThrow(
      "Command failed",
    );
  });

  it("throws when gh returns invalid JSON", async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(null, "not valid json {{{", "");
      },
    );
    await expect(fetchGitHubIssues("owner/repo", "open")).rejects.toThrow(
      "Failed to parse GraphQL response",
    );
  });

  it("throws when GraphQL response contains errors", async () => {
    mockGhResponse({
      errors: [{ message: "Could not resolve to a Repository" }],
    });
    await expect(fetchGitHubIssues("owner/repo", "open")).rejects.toThrow(
      "GraphQL errors",
    );
  });

  it("throws when repository is not found", async () => {
    mockGhResponse({
      data: { repository: null },
    });
    await expect(fetchGitHubIssues("owner/repo", "open")).rejects.toThrow(
      "Repository not found or inaccessible",
    );
  });

  it("parses a single page of issues", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "First issue",
                body: "body1",
                parent: null,
                labels: { nodes: [{ name: "bug" }] },
                blockedBy: { nodes: [] },
              },
              {
                number: 2,
                title: "Child issue",
                body: "body2",
                parent: { number: 1 },
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues).toHaveLength(2);
    expect(issues[0].number).toBe(1);
    expect(issues[0].title).toBe("First issue");
    expect(issues[0].parentNumber).toBeUndefined();
    expect(issues[0].labels).toEqual(["bug"]);
    expect(issues[0].blockedByNumbers).toEqual([]);
    expect(issues[1].number).toBe(2);
    expect(issues[1].parentNumber).toBe(1);
  });

  it("paginates across multiple pages", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            nodes: [
              {
                number: 1,
                title: "Issue 1",
                body: "",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
              },
            ],
          },
        },
      },
    });
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 2,
                title: "Issue 2",
                body: "",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues).toHaveLength(2);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("fetches comments when includeComments is true (default)", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue with comments",
                body: "body",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
                comments: {
                  nodes: [
                    {
                      author: { login: "alice" },
                      createdAt: "2026-03-13T10:00:00Z",
                      body: "Nice issue",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues[0].comments).toHaveLength(1);
    expect(issues[0].comments[0].author).toBe("alice");
    expect(issues[0].comments[0].body).toBe("Nice issue");
    expect(issues[0].comments[0].createdAt).toBe("2026-03-13T10:00:00Z");
  });

  it("returns empty comments array when includeComments is false", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue",
                body: "body",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open", undefined, false);
    expect(issues[0].comments).toEqual([]);
  });

  it("uses 'ghost' as author when comment author is null", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue",
                body: "body",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
                comments: {
                  nodes: [
                    {
                      author: null,
                      createdAt: "2026-03-13T10:00:00Z",
                      body: "Deleted user comment",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues[0].comments[0].author).toBe("ghost");
  });

  it("sets commentsHasNextPage=true when comments pageInfo.hasNextPage is true", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue with many comments",
                body: "body",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
                comments: {
                  pageInfo: { hasNextPage: true },
                  nodes: [
                    {
                      author: { login: "alice" },
                      createdAt: "2026-03-13T10:00:00Z",
                      body: "Comment",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues[0].commentsHasNextPage).toBe(true);
  });

  it("filters by label", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Bug",
                body: "",
                parent: null,
                labels: { nodes: [{ name: "bug" }] },
                blockedBy: { nodes: [] },
              },
              {
                number: 2,
                title: "Feature",
                body: "",
                parent: null,
                labels: { nodes: [{ name: "feature" }] },
                blockedBy: { nodes: [] },
              },
              {
                number: 3,
                title: "Another Bug",
                body: "",
                parent: null,
                labels: { nodes: [{ name: "bug" }] },
                blockedBy: { nodes: [] },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open", "bug");
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.labels.includes("bug"))).toBe(true);
  });
});

// ── importGitHubIssues integration tests ────────────────────────

describe("importGitHubIssues", () => {
  const mockedEmit = vi.mocked(emit);

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    projectStore.createProject("test-proj", "Test Project", "desc", "", "");
    mockExecFile.mockReset();
    mockedEmit.mockReset();
  });

  /** Helper to set up mock gh output with given issues. */
  function mockGhOutput(
    issues: {
      number: number;
      title: string;
      body?: string;
      parent?: { number: number } | null;
      labels?: string[];
      blockedBy?: number[];
    }[],
  ): void {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: issues.map((i) => ({
              number: i.number,
              title: i.title,
              body: i.body ?? "",
              parent: i.parent ?? null,
              labels: { nodes: (i.labels ?? []).map((l) => ({ name: l })) },
              blockedBy: { nodes: (i.blockedBy ?? []).map((n) => ({ number: n })) },
            })),
          },
        },
      },
    });
  }

  it("imports issues and creates tasks", async () => {
    mockGhOutput([
      { number: 1, title: "Issue one" },
      { number: 2, title: "Issue two" },
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.linked).toBe(0);

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("#1: Issue one");
    expect(tasks[1].title).toBe("#2: Issue two");
  });

  it("creates parent-child links", async () => {
    mockGhOutput([
      { number: 1, title: "Parent issue" },
      { number: 2, title: "Child issue", parent: { number: 1 } },
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.imported).toBe(2);
    expect(result.linked).toBe(1);

    const tasks = taskStore.listTasks("test-proj");
    const parent = tasks.find((t) => t.title.startsWith("#1:"));
    const child = tasks.find((t) => t.title.startsWith("#2:"));
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parentTaskId).toBe(parent!.id);
  });

  it("skips already-imported issues", async () => {
    // First import
    mockGhOutput([{ number: 1, title: "Issue one" }]);
    await importGitHubIssues("test-proj", "owner/repo", "open");

    // Second import with same issue
    mockGhOutput([
      { number: 1, title: "Issue one" },
      { number: 2, title: "Issue two" },
    ]);
    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks).toHaveLength(2);
  });

  it("re-import creates 0 new tasks", async () => {
    mockGhOutput([
      { number: 1, title: "Issue one" },
      { number: 2, title: "Issue two" },
    ]);
    await importGitHubIssues("test-proj", "owner/repo", "open");

    mockGhOutput([
      { number: 1, title: "Issue one" },
      { number: 2, title: "Issue two" },
    ]);
    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it("broadcasts task_created for each imported task", async () => {
    mockGhOutput([
      { number: 1, title: "Issue one" },
      { number: 2, title: "Issue two" },
    ]);

    await importGitHubIssues("test-proj", "owner/repo", "open");
    const taskCreatedCalls = mockedEmit.mock.calls.filter(
      (call) => call[0] === "task.created",
    );
    expect(taskCreatedCalls).toHaveLength(2);
  });

  it("throws when project does not exist", async () => {
    await expect(
      importGitHubIssues("nonexistent", "owner/repo", "open"),
    ).rejects.toThrow("Project not found");
  });

  it("handles child-before-parent ordering in GitHub response", async () => {
    mockGhOutput([
      { number: 2, title: "Child", parent: { number: 1 } },
      { number: 1, title: "Parent" },
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.imported).toBe(2);
    expect(result.linked).toBe(1);

    const tasks = taskStore.listTasks("test-proj");
    const parent = tasks.find((t) => t.title.startsWith("#1:"));
    const child = tasks.find((t) => t.title.startsWith("#2:"));
    expect(child!.parentTaskId).toBe(parent!.id);
  });

  it("generates branch names from parent branch for child tasks", async () => {
    mockGhOutput([
      { number: 1, title: "Parent" },
      { number: 2, title: "Child", parent: { number: 1 } },
    ]);

    await importGitHubIssues("test-proj", "owner/repo", "open");

    const tasks = taskStore.listTasks("test-proj");
    const parent = tasks.find((t) => t.title.startsWith("#1:"));
    const child = tasks.find((t) => t.title.startsWith("#2:"));
    expect(child!.branch).toBe(`${parent!.branch}/2-child`);
  });

  it("sets canDecompose=true on imported tasks", async () => {
    mockGhOutput([{ number: 1, title: "Issue one" }]);

    await importGitHubIssues("test-proj", "owner/repo", "open");

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks[0].canDecompose).toBe(true);
  });

  // ── blockedBy / dependency tests (UT-1 through UT-7) ──────────

  it("UT-1: fetchGitHubIssues returns blockedByNumbers populated from GraphQL response", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 10,
                title: "Blocker",
                body: "",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
              },
              {
                number: 11,
                title: "Blocked",
                body: "",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [{ number: 10 }] },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues[0].blockedByNumbers).toEqual([]);
    expect(issues[1].blockedByNumbers).toEqual([10]);
  });

  it("UT-2: fetchGitHubIssues returns empty blockedByNumbers when no blocking relationships", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Solo issue",
                body: "",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
              },
            ],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues[0].blockedByNumbers).toEqual([]);
  });

  it("appends comments to task description by default", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue with comments",
                body: "Issue body",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
                comments: {
                  nodes: [
                    {
                      author: { login: "alice" },
                      createdAt: "2026-03-13T10:00:00Z",
                      body: "First comment",
                    },
                    {
                      author: { login: "bob" },
                      createdAt: "2026-03-13T11:00:00Z",
                      body: "Second comment",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    await importGitHubIssues("test-proj", "owner/repo", "open");

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks[0].description).toContain("Issue body");
    expect(tasks[0].description).toContain("**@alice**");
    expect(tasks[0].description).toContain("First comment");
    expect(tasks[0].description).toContain("**@bob**");
    expect(tasks[0].description).toContain("Second comment");
    expect(tasks[0].description).toContain("---");
  });

  it("appends a truncation notice when comments.pageInfo.hasNextPage is true", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue with many comments",
                body: "Issue body",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
                comments: {
                  pageInfo: { hasNextPage: true },
                  nodes: [
                    {
                      author: { login: "alice" },
                      createdAt: "2026-03-13T10:00:00Z",
                      body: "Only fetched comment",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    await importGitHubIssues("test-proj", "owner/repo", "open");

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks[0].description).toContain("Only fetched comment");
    expect(tasks[0].description).toContain("additional comments");
  });

  it("omits comments from task description when includeComments=false", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Issue no comments",
                body: "Issue body only",
                parent: null,
                labels: { nodes: [] },
                blockedBy: { nodes: [] },
                // no comments field — not requested
              },
            ],
          },
        },
      },
    });

    await importGitHubIssues("test-proj", "owner/repo", "open", undefined, undefined, false);

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks[0].description).toBe("Issue body only");
  });

  it("UT-3: importGitHubIssues sets dependsOn when issue A is blocked by issue B (both in import set)", async () => {
    mockGhOutput([
      { number: 1, title: "Blocker" },
      { number: 2, title: "Blocked", blockedBy: [1] },
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.dependencies).toBe(1);

    const tasks = taskStore.listTasks("test-proj");
    const blocker = tasks.find((t) => t.title.startsWith("#1:"));
    const blocked = tasks.find((t) => t.title.startsWith("#2:"));
    expect(blocker).toBeDefined();
    expect(blocked).toBeDefined();

    const dependsOn = JSON.parse(blocked!.dependsOn) as string[];
    expect(dependsOn).toContain(blocker!.id);
  });

  it("UT-4: importGitHubIssues does not set dependsOn for blockers outside the import set", async () => {
    mockGhOutput([
      { number: 2, title: "Blocked", blockedBy: [999] }, // 999 not in import set
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.dependencies).toBe(0);

    const tasks = taskStore.listTasks("test-proj");
    const blocked = tasks.find((t) => t.title.startsWith("#2:"));
    const dependsOn = JSON.parse(blocked!.dependsOn) as string[];
    expect(dependsOn).toHaveLength(0);
  });

  it("UT-5: importGitHubIssues returns correct dependencies count", async () => {
    mockGhOutput([
      { number: 1, title: "A" },
      { number: 2, title: "B", blockedBy: [1] },
      { number: 3, title: "C", blockedBy: [1, 2] },
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.dependencies).toBe(3); // B blocked by 1, C blocked by 1 and 2
  });

  it("UT-6: re-importing already-imported issues does not duplicate dependsOn entries", async () => {
    // First import
    mockGhOutput([
      { number: 1, title: "Blocker" },
      { number: 2, title: "Blocked", blockedBy: [1] },
    ]);
    await importGitHubIssues("test-proj", "owner/repo", "open");

    // Second import — both issues already exist, should be skipped
    mockGhOutput([
      { number: 1, title: "Blocker" },
      { number: 2, title: "Blocked", blockedBy: [1] },
    ]);
    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.skipped).toBe(2);
    expect(result.dependencies).toBe(0);

    const tasks = taskStore.listTasks("test-proj");
    const blocked = tasks.find((t) => t.title.startsWith("#2:"));
    const dependsOn = JSON.parse(blocked!.dependsOn) as string[];
    // Should still have exactly one entry — not duplicated
    expect(dependsOn).toHaveLength(1);
  });

  it("UT-7: circular blocking relationships are handled gracefully", async () => {
    mockGhOutput([
      { number: 1, title: "A", blockedBy: [2] },
      { number: 2, title: "B", blockedBy: [1] },
    ]);

    const result = await importGitHubIssues("test-proj", "owner/repo", "open");
    expect(result.imported).toBe(2);
    expect(result.dependencies).toBe(2);

    const tasks = taskStore.listTasks("test-proj");
    const taskA = tasks.find((t) => t.title.startsWith("#1:"));
    const taskB = tasks.find((t) => t.title.startsWith("#2:"));
    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();

    const depsA = JSON.parse(taskA!.dependsOn) as string[];
    const depsB = JSON.parse(taskB!.dependsOn) as string[];
    expect(depsA).toContain(taskB!.id);
    expect(depsB).toContain(taskA!.id);
  });

  it("rejects concurrent imports", async () => {
    // Set up a slow mock that doesn't resolve immediately
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        setTimeout(() => {
          cb(
            null,
            JSON.stringify({
              data: {
                repository: {
                  issues: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      {
                        number: 1,
                        title: "Issue",
                        body: "",
                        parent: null,
                        labels: { nodes: [] },
                        blockedBy: { nodes: [] },
                      },
                    ],
                  },
                },
              },
            }),
            "",
          );
        }, 50);
      },
    );

    const first = importGitHubIssues("test-proj", "owner/repo", "open");
    await expect(
      importGitHubIssues("test-proj", "owner/repo", "open"),
    ).rejects.toThrow("already in progress");
    await first;
  });
});
