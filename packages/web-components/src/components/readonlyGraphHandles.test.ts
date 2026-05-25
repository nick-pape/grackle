/**
 * Guards the read-only-graph handle fix (#1303).
 *
 * The Coordination graph and the Task DAG are view-only React Flow graphs with
 * no `onConnect` handler, so their nodes must not offer a drag-to-connect
 * affordance. Each must (a) pass `nodesConnectable={false}` to `<ReactFlow>` and
 * (b) render its `.handle` dots hidden + non-interactive.
 *
 * These graphs depend on React Flow's DOM measurements, which don't render
 * reliably in the headless Storybook runner (see CoordinationGraph.stories.tsx),
 * so behavior is guarded here at the source level instead — cheap, deterministic,
 * and enough to catch an accidental regression of either half of the fix.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Reads a file relative to this test as UTF-8 text. */
function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf-8");
}

/** The two read-only React Flow graphs and their handle stylesheets. */
const GRAPHS = [
  {
    name: "CoordinationGraph",
    component: "./streams/CoordinationGraph.tsx",
    styles: "./streams/CoordinationGraph.module.scss",
  },
  {
    name: "DagView",
    component: "./dag/DagView.tsx",
    styles: "./dag/DagView.module.scss",
  },
] as const;

/** Custom node components — every <Handle> they render must be non-connectable. */
const NODE_COMPONENTS = [
  "./streams/SessionNode.tsx",
  "./streams/StreamNode.tsx",
  "./dag/TaskNode.tsx",
] as const;

describe("read-only graph handles (#1303)", () => {
  for (const graph of GRAPHS) {
    describe(graph.name, () => {
      const component = read(graph.component);
      const styles = read(graph.styles);

      it("disables drag-to-connect on the ReactFlow", () => {
        expect(component).toMatch(/nodesConnectable=\{false\}/);
      });

      it("hides and disables interaction on the .handle dots", () => {
        // Isolate the `.handle { ... }` rule and assert both guards are present.
        const handleRule = styles.match(/\.handle\s*\{[^}]*\}/);
        expect(handleRule, "expected a .handle rule in the stylesheet").not.toBeNull();
        expect(handleRule![0]).toMatch(/opacity:\s*0\s*!important/);
        expect(handleRule![0]).toMatch(/pointer-events:\s*none\s*!important/);
      });
    });
  }

  for (const nodeComponent of NODE_COMPONENTS) {
    it(`marks every <Handle> non-connectable in ${nodeComponent}`, () => {
      const source = read(nodeComponent);
      const handles = source.match(/<Handle\b[^>]*\/>/g) ?? [];
      expect(handles.length, "expected at least one <Handle>").toBeGreaterThan(0);
      for (const handle of handles) {
        expect(handle).toContain("isConnectable={false}");
      }
    });
  }
});
