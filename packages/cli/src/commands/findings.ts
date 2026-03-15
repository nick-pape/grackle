import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

export function registerFindingCommands(program: Command): void {
  const finding = program.command("finding").description("Manage findings");

  finding
    .command("list <project-id>")
    .description("List findings in a project")
    .option("--category <cat>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Max results", parseInt)
    .action(async (projectId: string, opts: { category?: string; tag?: string; limit?: number }) => {
      const client = createGrackleClient();
      const res = await client.queryFindings({
        projectId,
        categories: opts.category ? [opts.category] : [],
        tags: opts.tag ? [opts.tag] : [],
        limit: opts.limit || 20,
      });
      if (res.findings.length === 0) {
        console.log("No findings.");
        return;
      }
      const table = new Table({
        head: ["ID", "Category", "Title", "Tags", "Created"],
      });
      for (const f of res.findings) {
        table.push([
          f.id,
          f.category,
          f.title.slice(0, 40),
          f.tags.join(",") || "-",
          f.createdAt,
        ]);
      }
      console.log(table.toString());
    });

  finding
    .command("post <project-id> <title>")
    .description("Post a finding")
    .option("--category <cat>", "Finding category", "general")
    .option("--content <text>", "Finding content", "")
    .option("--tags <tags>", "Comma-separated tags")
    .action(async (projectId: string, title: string, opts: { tags?: string; category: string; content: string }) => {
      const client = createGrackleClient();
      const tags: string[] = opts.tags ? opts.tags.split(",") : [];
      const f = await client.postFinding({
        projectId,
        taskId: "",
        sessionId: "",
        category: opts.category,
        title,
        content: opts.content,
        tags,
      });
      console.log(`Posted finding: ${f.id}`);
    });
}
