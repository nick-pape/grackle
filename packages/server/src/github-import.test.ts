import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// ── Mock ws-broadcast to avoid WebSocket dependency in tests ─────
vi.mock("./ws-broadcast.js", () => ({
  broadcast: vi.fn(),
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
import { topologicalSortIssues, fetchGitHubIssues, importGitHubIssues } from "./github-import.js";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import { sqlite } from "./test-db.js";
import { broadcast } from "./ws-broadcast.js";

/** Helper to build a minimal issue-like object for topological sort tests. */
function issue(number: number, parentNumber?: number): { number: number; parentNumber: number | undefined } {
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
      env_id        TEXT NOT NULL DEFAULT '',
      session_id    TEXT NOT NULL DEFAULT '',
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
      can_decompose INTEGER NOT NULL DEFAULT 0
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
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, "");
    },
  );
}

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
      const issues = [
        issue(5, 3),
        issue(4),
        issue(3, 1),
        issue(2),
        issue(1),
      ];
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
      const issues = [
        issue(1),
        issue(30, 1),
        issue(20, 1),
        issue(10, 1),
      ];
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
          const parentIdx = sorted.findIndex((s) => s.number === current.parentNumber);
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
    await expect(fetchGitHubIssues("badrepo", "open")).rejects.toThrow("owner/repo format");
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
              },
              {
                number: 2,
                title: "Child issue",
                body: "body2",
                parent: { number: 1 },
                labels: { nodes: [] },
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
    expect(issues[1].number).toBe(2);
    expect(issues[1].parentNumber).toBe(1);
  });

  it("paginates across multiple pages", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            nodes: [{ number: 1, title: "Issue 1", body: "", parent: null, labels: { nodes: [] } }],
          },
        },
      },
    });
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ number: 2, title: "Issue 2", body: "", parent: null, labels: { nodes: [] } }],
          },
        },
      },
    });

    const issues = await fetchGitHubIssues("owner/repo", "open");
    expect(issues).toHaveLength(2);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("filters by label", async () => {
    mockGhResponse({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { number: 1, title: "Bug", body: "", parent: null, labels: { nodes: [{ name: "bug" }] } },
              { number: 2, title: "Feature", body: "", parent: null, labels: { nodes: [{ name: "feature" }] } },
              { number: 3, title: "Another Bug", body: "", parent: null, labels: { nodes: [{ name: "bug" }] } },
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
  const mockedBroadcast = vi.mocked(broadcast);

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    projectStore.createProject("test-proj", "Test Project", "desc", "", "");
    mockExecFile.mockReset();
    mockedBroadcast.mockReset();
  });

  /** Helper to set up mock gh output with given issues. */
  function mockGhOutput(issues: { number: number; title: string; body?: string; parent?: { number: number } | null; labels?: string[] }[]): void {
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
    mockGhOutput([
      { number: 1, title: "Issue one" },
    ]);
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
    const taskCreatedCalls = mockedBroadcast.mock.calls.filter(
      (call) => call[0].type === "task_created"
    );
    expect(taskCreatedCalls).toHaveLength(2);
  });

  it("throws when project does not exist", async () => {
    await expect(importGitHubIssues("nonexistent", "owner/repo", "open"))
      .rejects.toThrow("Project not found");
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

  it("uses environment ID from request when provided", async () => {
    mockGhOutput([
      { number: 1, title: "Issue one" },
    ]);

    await importGitHubIssues("test-proj", "owner/repo", "open", undefined, "env-123");

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks[0].environmentId).toBe("env-123");
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
    mockGhOutput([
      { number: 1, title: "Issue one" },
    ]);

    await importGitHubIssues("test-proj", "owner/repo", "open");

    const tasks = taskStore.listTasks("test-proj");
    expect(tasks[0].canDecompose).toBe(true);
  });

  it("rejects concurrent imports", async () => {
    // Set up a slow mock that doesn't resolve immediately
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        setTimeout(() => {
          cb(null, JSON.stringify({
            data: {
              repository: {
                issues: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ number: 1, title: "Issue", body: "", parent: null, labels: { nodes: [] } }],
                },
              },
            },
          }), "");
        }, 50);
      },
    );

    const first = importGitHubIssues("test-proj", "owner/repo", "open");
    await expect(importGitHubIssues("test-proj", "owner/repo", "open"))
      .rejects.toThrow("already in progress");
    await first;
  });
});
