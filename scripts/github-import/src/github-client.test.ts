import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock child_process for gh CLI calls ─────────────────────────
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

import { fetchGitHubIssues } from "./github-client.js";

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

  it("returns blockedByNumbers populated from GraphQL response", async () => {
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

  it("returns empty blockedByNumbers when no blocking relationships", async () => {
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
});
