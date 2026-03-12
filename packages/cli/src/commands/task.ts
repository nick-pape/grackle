import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import { taskStatusToString } from "@grackle-ai/common";
import Table from "cli-table3";
import chalk from "chalk";
import { execFileSync } from "node:child_process";

export function registerTaskCommands(program: Command): void {
  const task = program.command("task").description("Manage tasks");

  task
    .command("list <project-id>")
    .description("List tasks in a project")
    .action(async (projectId: string) => {
      const client = createGrackleClient();
      const res = await client.listTasks({ id: projectId });
      if (res.tasks.length === 0) {
        console.log("No tasks.");
        return;
      }
      const table = new Table({
        head: ["ID", "Title", "Status", "Branch", "Deps", "Session"],
      });
      for (const t of res.tasks) {
        const deps = t.dependsOn.length > 0 ? t.dependsOn.join(",") : "-";
        table.push([t.id, t.title.slice(0, 30), taskStatusToString(t.status), t.branch.slice(0, 30), deps, t.sessionId?.slice(0, 8) || "-"]);
      }
      console.log(table.toString());
    });

  task
    .command("create <project-id> <title>")
    .description("Create a task")
    .option("--desc <text>", "Task description")
    .option("--env <env-id>", "Environment ID")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .action(async (projectId: string, title: string, opts) => {
      const client = createGrackleClient();
      const dependsOn = opts.dependsOn ? opts.dependsOn.split(",") : [];
      const t = await client.createTask({
        projectId,
        title,
        description: opts.desc || "",
        environmentId: opts.env || "",
        dependsOn,
      });
      console.log(`Created task: ${t.id} (${t.title}) branch: ${t.branch}`);
    });

  task
    .command("show <task-id>")
    .description("Show task details")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      const t = await client.getTask({ id: taskId });
      console.log(`ID:          ${t.id}`);
      console.log(`Title:       ${t.title}`);
      console.log(`Status:      ${taskStatusToString(t.status)}`);
      console.log(`Branch:      ${t.branch}`);
      console.log(`Env:         ${t.environmentId || "-"}`);
      console.log(`Session:     ${t.sessionId || "-"}`);
      console.log(`Depends On:  ${t.dependsOn.length > 0 ? t.dependsOn.join(", ") : "none"}`);
      if (t.description) console.log(`Description: ${t.description}`);
      if (t.reviewNotes) console.log(`Review Notes: ${t.reviewNotes}`);
    });

  task
    .command("start <task-id>")
    .description("Start a task (spawn agent)")
    .option("--runtime <runtime>", "Agent runtime")
    .option("--model <model>", "Model to use")
    .action(async (taskId: string, opts) => {
      const client = createGrackleClient();
      const session = await client.startTask({
        taskId,
        runtime: opts.runtime || "",
        model: opts.model || "",
      });
      console.log(`Task started. Session: ${session.id}`);
    });

  task
    .command("delete <task-id>")
    .description("Delete a task")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      await client.deleteTask({ id: taskId });
      console.log(`Deleted: ${taskId}`);
    });

  task
    .command("approve <task-id>")
    .description("Approve a task in review")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      const t = await client.approveTask({ id: taskId });
      console.log(`Approved: ${t.id} → ${taskStatusToString(t.status)}`);
    });

  task
    .command("reject <task-id>")
    .description("Reject a task in review")
    .option("--notes <text>", "Review notes", "")
    .action(async (taskId: string, opts) => {
      const client = createGrackleClient();
      const t = await client.rejectTask({
        id: taskId,
        reviewNotes: opts.notes,
      });
      console.log(`Rejected: ${t.id} → ${taskStatusToString(t.status)}`);
    });

  task
    .command("import-github <project-id>")
    .description("Bulk import GitHub issues as tasks")
    .requiredOption("--repo <owner/repo>", "GitHub repository (owner/repo)")
    .option("--label <label>", "Filter issues by label name")
    .option("--state <state>", "Issue state to fetch", "open")
    .option("--env <env-id>", "Environment ID to assign to created tasks")
    .action(
      /**
       * Fetches GitHub issues via the `gh` CLI GraphQL API (including parent
       * sub-issue relationships), deduplicates against existing tasks (matched
       * by issue number prefix `#<number>:`), topologically sorts so parents
       * are created before children, and bulk-creates any issues that have not
       * yet been imported into the given project.
       *
       * @param projectId - The Grackle project ID to import tasks into.
       * @param opts - Parsed CLI options (repo, label, state, env).
       */
      async (projectId: string, opts: { repo: string; label?: string; state: string; env?: string }) => {
        const MAX_BUFFER_BYTES = 50 * 1024 * 1024;
        const ISSUES_PER_PAGE = 100;

        interface GitHubIssue {
          number: number;
          title: string;
          body: string;
          parentNumber: number | undefined;
          labels: string[];
        }

        // 1. Fetch issues from GitHub via GraphQL (includes parent sub-issue info)
        const [owner, repo] = opts.repo.split("/");
        if (!owner || !repo) {
          console.error("--repo must be in owner/repo format.");
          process.exit(1);
        }

        const stateEnum = opts.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
        const issues: GitHubIssue[] = [];
        let cursor: string | undefined;
        let hasNextPage = true;

        while (hasNextPage) {
          const query = `
            query($owner: String!, $repo: String!, $cursor: String) {
              repository(owner: $owner, name: $repo) {
                issues(first: ${ISSUES_PER_PAGE}, states: [${stateEnum}], after: $cursor) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    number
                    title
                    body
                    parent { number }
                    labels(first: 10) { nodes { name } }
                  }
                }
              }
            }`;

          const ghArgs = [
            "api", "graphql",
            "-f", `query=${query}`,
            "-f", `owner=${owner}`,
            "-f", `repo=${repo}`,
          ];
          if (cursor !== undefined) {
            ghArgs.push("-f", `cursor=${cursor}`);
          }
          let ghOutput: string;
          try {
            ghOutput = execFileSync("gh", ghArgs, {
              encoding: "utf8",
              maxBuffer: MAX_BUFFER_BYTES,
            });
          } catch (err) {
            console.error(`Failed to fetch issues via GraphQL for ${opts.repo} (state=${opts.state}).`);
            console.error(err);
            process.exit(1);
          }

          let parsed: {
            data: {
              repository: {
                issues: {
                  pageInfo: { hasNextPage: boolean; endCursor: string | undefined };
                  nodes: {
                    number: number;
                    title: string;
                    body: string;
                    parent: { number: number } | undefined;
                    labels: { nodes: { name: string }[] };
                  }[];
                };
              };
            };
          };
          try {
            parsed = JSON.parse(ghOutput);
          } catch (err) {
            console.error("Failed to parse GraphQL response.");
            console.error("Parse error:", err);
            process.exit(1);
          }

          const issuesPage = parsed.data.repository.issues;
          for (const node of issuesPage.nodes) {
            issues.push({
              number: node.number,
              title: node.title,
              body: node.body,
              parentNumber: node.parent?.number ?? undefined,
              labels: node.labels.nodes.map((l) => l.name),
            });
          }

          hasNextPage = issuesPage.pageInfo.hasNextPage;
          cursor = issuesPage.pageInfo.endCursor;
        }

        // Filter by label client-side (GraphQL filterBy labels requires exact match array)
        if (opts.label) {
          const labelFilter = opts.label;
          const beforeCount = issues.length;
          const filtered = issues.filter((i) => i.labels.includes(labelFilter));
          issues.length = 0;
          issues.push(...filtered);
          if (issues.length < beforeCount) {
            console.log(`Filtered to ${issues.length} issues with label "${labelFilter}"`);
          }
        }

        // 2. Fetch existing tasks for deduplication and parent linking
        const client = createGrackleClient();
        const res = await client.listTasks({ id: projectId });
        const issueNumberPattern = /^#(\d+):/;

        /** Maps GitHub issue number → Grackle task ID (for both existing and newly created tasks). */
        const issueNumberToTaskId = new Map<number, string>();
        const existingIssueNumbers = new Set<number>();

        for (const t of res.tasks) {
          const match = t.title.match(issueNumberPattern);
          if (match) {
            const num = Number(match[1]);
            existingIssueNumbers.add(num);
            issueNumberToTaskId.set(num, t.id);
          }
        }

        // 3. Topological sort: parents before children
        const issueSet = new Set(issues.map((i) => i.number));
        const sorted = topologicalSortIssues(issues, issueSet);

        // 4. Create tasks in topological order with parent linking
        let imported = 0;
        let skipped = 0;
        let linked = 0;

        for (const issue of sorted) {
          if (existingIssueNumbers.has(issue.number)) {
            skipped++;
            continue;
          }

          const title = `#${issue.number}: ${issue.title}`;
          let parentTaskId = "";
          if (issue.parentNumber !== undefined) {
            const resolvedParentId = issueNumberToTaskId.get(issue.parentNumber);
            if (resolvedParentId) {
              parentTaskId = resolvedParentId;
              linked++;
            }
          }

          const created = await client.createTask({
            projectId,
            title,
            description: issue.body ?? "",
            environmentId: opts.env ?? "",
            dependsOn: [],
            parentTaskId,
          });
          issueNumberToTaskId.set(issue.number, created.id);
          imported++;
        }

        // 5. Print summary
        const parts = [`Imported ${chalk.green(imported)} tasks`];
        if (linked > 0) {
          parts.push(`${chalk.cyan(linked)} linked to parents`);
        }
        parts.push(`skipped ${skipped} already imported`);
        console.log(parts.join(", "));
      }
    );
}

/**
 * Topologically sorts issues so that parents appear before their children.
 * Issues whose parent is outside the import set are treated as roots.
 * Falls back to original order for issues at the same depth.
 *
 * @param issues - The list of GitHub issues to sort.
 * @param issueSet - Set of issue numbers in the current import batch.
 * @returns A new array of issues sorted with parents before children.
 */
function topologicalSortIssues<T extends { number: number; parentNumber: number | undefined }>(
  issues: T[],
  issueSet: Set<number>
): T[] {
  const issueByNumber = new Map(issues.map((i) => [i.number, i]));
  const visited = new Set<number>();
  const sorted: T[] = [];

  function visit(issue: T): void {
    if (visited.has(issue.number)) {
      return;
    }
    visited.add(issue.number);

    // Visit parent first if it's in the import set
    if (issue.parentNumber !== undefined && issueSet.has(issue.parentNumber)) {
      const parent = issueByNumber.get(issue.parentNumber);
      if (parent) {
        visit(parent);
      }
    }

    sorted.push(issue);
  }

  for (const issue of issues) {
    visit(issue);
  }

  return sorted;
}
