import type { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { createGrackleClients } from "../client.js";
import type { grackle } from "@grackle-ai/common";

/**
 * Render the runtime catalog (AHP `RootState.agents`) as a table string.
 * Pure (no I/O) so it can be unit-tested independently of the gRPC client.
 */
export function formatRuntimesTable(runtimes: grackle.RuntimeInfo[]): string {
  const table = new Table({ head: ["Provider", "Name", "Models", "Credential needs"] });
  for (const runtime of runtimes) {
    const models = runtime.models.map((m) => m.id).join(", ") || chalk.dim("(agent-selected)");
    const needs = runtime.protectedResources.length > 0
      ? runtime.protectedResources.map((p) => `${p.resourceName} (${p.credentialKinds.join(" or ")})`).join("\n")
      : chalk.dim("none");
    table.push([chalk.cyan(runtime.provider), runtime.displayName, models, needs]);
  }
  return table.toString();
}

/** Register the `runtimes` command: list the runtime catalog. */
export function registerRuntimesCommands(program: Command): void {
  program
    .command("runtimes")
    .description("List available agent runtimes, their models, and credential needs")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const res = await client.listRuntimes({});
      console.log(formatRuntimesTable(res.runtimes));
    });
}
