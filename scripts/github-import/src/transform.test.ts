import { describe, it, expect, beforeEach } from "vitest";
import {
  topologicalSortIssues,
  buildDescriptionWithComments,
  buildExistingIssueMap,
  planImport,
} from "./transform.js";
import type { GitHubIssue } from "./transform.js";

/** Helper to build a minimal issue-like object for topological sort tests. */
function issue(
  number: number,
  parentNumber?: number,
): { number: number; parentNumber: number | undefined } {
  return { number, parentNumber };
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

    it("handles a chain of three levels (grandparent -> parent -> child)", () => {
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

// ── buildExistingIssueMap (pure function) tests ─────────────────

describe("buildExistingIssueMap", () => {
  it("returns empty maps for empty input", () => {
    const result = buildExistingIssueMap([]);
    expect(result.issueNumberToTaskId.size).toBe(0);
    expect(result.existingIssueNumbers.size).toBe(0);
  });

  it("extracts issue numbers from titles matching the #N: pattern", () => {
    const tasks = [
      { id: "aaa", title: "#1: First issue" },
      { id: "bbb", title: "#42: Another issue" },
    ];
    const result = buildExistingIssueMap(tasks);
    expect(result.existingIssueNumbers).toEqual(new Set([1, 42]));
    expect(result.issueNumberToTaskId.get(1)).toBe("aaa");
    expect(result.issueNumberToTaskId.get(42)).toBe("bbb");
  });

  it("ignores tasks whose titles do not match the pattern", () => {
    const tasks = [
      { id: "aaa", title: "#1: Matches" },
      { id: "bbb", title: "No hash prefix" },
      { id: "ccc", title: "Also #2 not at start" },
    ];
    const result = buildExistingIssueMap(tasks);
    expect(result.existingIssueNumbers.size).toBe(1);
    expect(result.issueNumberToTaskId.size).toBe(1);
  });
});

// ── planImport (pure function) tests ────────────────────────────

describe("planImport", () => {
  /** Helper to create a minimal GitHubIssue. */
  function ghIssue(
    num: number,
    title: string,
    opts?: { parentNumber?: number; blockedBy?: number[]; body?: string },
  ): GitHubIssue {
    return {
      number: num,
      title,
      body: opts?.body ?? "",
      parentNumber: opts?.parentNumber,
      labels: [],
      blockedByNumbers: opts?.blockedBy ?? [],
      comments: [],
      commentsHasNextPage: false,
    };
  }

  let idCounter: number;
  function generateId(): string {
    return `id-${idCounter++}`;
  }

  beforeEach(() => {
    idCounter = 1;
  });

  it("creates instructions for all new issues", () => {
    const issues = [ghIssue(1, "A"), ghIssue(2, "B")];
    const plan = planImport(issues, new Set(), new Map(), generateId);

    expect(plan.tasksToCreate).toHaveLength(2);
    expect(plan.skipped).toBe(0);
    expect(plan.linked).toBe(0);
    expect(plan.tasksToCreate[0].title).toBe("#1: A");
    expect(plan.tasksToCreate[1].title).toBe("#2: B");
  });

  it("skips already-existing issues", () => {
    const issues = [ghIssue(1, "A"), ghIssue(2, "B")];
    const plan = planImport(issues, new Set([1]), new Map([[1, "existing-id"]]), generateId);

    expect(plan.tasksToCreate).toHaveLength(1);
    expect(plan.skipped).toBe(1);
    expect(plan.tasksToCreate[0].title).toBe("#2: B");
  });

  it("resolves parent links between new issues", () => {
    const issues = [ghIssue(1, "Parent"), ghIssue(2, "Child", { parentNumber: 1 })];
    const plan = planImport(issues, new Set(), new Map(), generateId);

    expect(plan.linked).toBe(1);
    expect(plan.tasksToCreate[1].parentTaskId).toBe(plan.tasksToCreate[0].id);
  });

  it("resolves parent links to existing tasks", () => {
    const issues = [ghIssue(2, "Child", { parentNumber: 1 })];
    const plan = planImport(issues, new Set(), new Map([[1, "existing-parent"]]), generateId);

    expect(plan.linked).toBe(1);
    expect(plan.tasksToCreate[0].parentTaskId).toBe("existing-parent");
  });

  it("resolves blockedBy into dependency instructions", () => {
    const issues = [ghIssue(1, "A"), ghIssue(2, "B", { blockedBy: [1] })];
    const plan = planImport(issues, new Set(), new Map(), generateId);

    expect(plan.dependenciesToSet).toHaveLength(1);
    expect(plan.dependenciesToSet[0].taskId).toBe(plan.tasksToCreate[1].id);
    expect(plan.dependenciesToSet[0].dependsOn).toEqual([plan.tasksToCreate[0].id]);
  });

  it("resolves blockedBy to existing tasks", () => {
    const issues = [ghIssue(2, "B", { blockedBy: [1] })];
    const plan = planImport(issues, new Set(), new Map([[1, "existing-blocker"]]), generateId);

    expect(plan.dependenciesToSet).toHaveLength(1);
    expect(plan.dependenciesToSet[0].dependsOn).toEqual(["existing-blocker"]);
  });

  it("skips blockers outside the known set", () => {
    const issues = [ghIssue(2, "B", { blockedBy: [999] })];
    const plan = planImport(issues, new Set(), new Map(), generateId);

    expect(plan.dependenciesToSet).toHaveLength(0);
  });

  it("handles circular blocking relationships", () => {
    const issues = [
      ghIssue(1, "A", { blockedBy: [2] }),
      ghIssue(2, "B", { blockedBy: [1] }),
    ];
    const plan = planImport(issues, new Set(), new Map(), generateId);

    expect(plan.tasksToCreate).toHaveLength(2);
    expect(plan.dependenciesToSet).toHaveLength(2);
  });

  it("handles child-before-parent ordering", () => {
    const issues = [
      ghIssue(2, "Child", { parentNumber: 1 }),
      ghIssue(1, "Parent"),
    ];
    const plan = planImport(issues, new Set(), new Map(), generateId);

    // Parent should be created before child due to topo sort
    expect(plan.tasksToCreate[0].title).toBe("#1: Parent");
    expect(plan.tasksToCreate[1].title).toBe("#2: Child");
    expect(plan.tasksToCreate[1].parentTaskId).toBe(plan.tasksToCreate[0].id);
  });

  it("uses the provided generateId function", () => {
    let counter = 100;
    const customId = (): string => `custom-${counter++}`;
    const issues = [ghIssue(1, "A")];
    const plan = planImport(issues, new Set(), new Map(), customId);

    expect(plan.tasksToCreate[0].id).toBe("custom-100");
  });
});
