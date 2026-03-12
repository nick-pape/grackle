import { describe, it, expect } from "vitest";
import { topologicalSortIssues } from "./task.js";

/** Helper to build a minimal issue-like object for topological sort tests. */
function issue(number: number, parentNumber?: number): { number: number; parentNumber: number | undefined } {
  return { number, parentNumber };
}

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
      // Both should appear; #10's parent #99 is outside the set so #10 is a root
      expect(sorted.map((i) => i.number)).toEqual([10, 11]);
    });

    it("still orders children correctly when only the parent is external", () => {
      // #20 has external parent #99, #21 is child of #20 (in-set)
      const issues = [issue(21, 20), issue(20, 99)];
      const issueSet = new Set([20, 21]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted.map((i) => i.number)).toEqual([20, 21]);
    });
  });

  describe("mixed forest", () => {
    it("handles a mix of root issues and parent-child trees", () => {
      const issues = [
        issue(5, 3),  // child of 3
        issue(4),     // root
        issue(3, 1),  // child of 1
        issue(2),     // root
        issue(1),     // root (parent of 3)
      ];
      const issueSet = new Set([1, 2, 3, 4, 5]);
      const sorted = topologicalSortIssues(issues, issueSet);
      const order = sorted.map((i) => i.number);

      // 1 must come before 3, and 3 must come before 5
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
      expect(order.indexOf(3)).toBeLessThan(order.indexOf(5));
      // All 5 issues present
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
      // Two children of the same parent — parent should only appear once
      const issues = [issue(3, 1), issue(2, 1), issue(1)];
      const issueSet = new Set([1, 2, 3]);
      const sorted = topologicalSortIssues(issues, issueSet);
      expect(sorted).toHaveLength(3);
      const numbers = sorted.map((i) => i.number);
      expect(new Set(numbers).size).toBe(3); // no duplicates
    });

    it("handles a cycle gracefully (does not infinite loop)", () => {
      // Cycles shouldn't happen in GitHub, but the visited set prevents infinite loops
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
      // All are roots — original order should be preserved
      expect(sorted.map((i) => i.number)).toEqual([10, 5, 20, 1]);
    });

    it("preserves sibling order for children of the same parent", () => {
      const issues = [
        issue(1),     // parent
        issue(30, 1), // first child
        issue(20, 1), // second child
        issue(10, 1), // third child
      ];
      const issueSet = new Set([1, 30, 20, 10]);
      const sorted = topologicalSortIssues(issues, issueSet);
      const order = sorted.map((i) => i.number);
      // Parent first, then children in original order
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
      // Every issue should come after its parent
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
