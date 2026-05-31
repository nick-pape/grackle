/**
 * `grackle agent` command group — manage standing agents (#1417).
 *
 * Distinct from the top-level agent-session verbs (`spawn`, `status`, `kill`,
 * …) in `session-verbs.ts`: this group is CRUD over the standing-Agent entity.
 * Phase 0 — the Agent has no lifecycle yet, so these are plain create / list /
 * show / edit / delete commands.
 *
 * @module
 */

import { Command } from "commander";
import chalk from "chalk";
import { createGrackleClients } from "../client.js";

/** Max characters of an avatar to inline in `agent list`. */
const INLINE_AVATAR_MAX_CHARS: number = 6;

/**
 * Return the avatar string when it's a short inline glyph (emoji / monogram),
 * or `""` when it's a URL / `data:` URI that would spam the terminal. The
 * full value is always available via `agent show`.
 */
function renderInlineAvatar(avatar: string): string {
  if (!avatar) {
    return "";
  }
  if (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("/") ||
    avatar.startsWith("data:")
  ) {
    return "";
  }
  // Multi-codepoint emoji can be > 1 character; cap at a small ceiling.
  if ([...avatar].length > INLINE_AVATAR_MAX_CHARS) {
    return "";
  }
  return avatar;
}

/**
 * Register the `agent` command group on the root program.
 *
 * @param program - The root Commander program.
 */
export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Create and manage standing agents");

  agent
    .command("list")
    .description("List all agents")
    .action(async () => {
      const { orchestration } = createGrackleClients();
      const res = await orchestration.listAgents({});
      if (res.agents.length === 0) {
        console.log(chalk.yellow("No agents found."));
        return;
      }
      for (const a of res.agents) {
        // Inline only short glyphs (emoji / monogram). URLs and base64
        // data URIs would wrap and spam the terminal — `show` is where
        // the full value belongs.
        const inlineAvatar = renderInlineAvatar(a.avatar);
        const prefix = inlineAvatar ? `${inlineAvatar} ` : "";
        console.log(`${prefix}${chalk.bold(a.name)} ${chalk.dim(`(${a.id})`)}`);
        console.log(`  persona: ${a.primaryPersonaId || "(none)"}`);
      }
    });

  agent
    .command("show <id>")
    .description("Show details for an agent")
    .action(async (id: string) => {
      const { orchestration } = createGrackleClients();
      const a = await orchestration.getAgent({ id });
      console.log(`ID:       ${a.id}`);
      console.log(`Name:     ${a.name}`);
      console.log(`Avatar:   ${a.avatar || "-"}`);
      console.log(`Persona:  ${a.primaryPersonaId || "-"}`);
      console.log(`Created:  ${a.createdAt}`);
      console.log(`Updated:  ${a.updatedAt}`);
    });

  agent
    .command("create <name>")
    .description("Create an agent")
    .option("--avatar <value>", "Avatar: emoji, URL, or base64 data URI", "")
    .option("--persona <id>", "Primary persona id", "")
    .action(async (name: string, opts: { avatar: string; persona: string }) => {
      const { orchestration } = createGrackleClients();
      const res = await orchestration.createAgent({
        name,
        avatar: opts.avatar,
        primaryPersonaId: opts.persona,
      });
      console.log(chalk.green(`Created agent ${chalk.bold(res.name)} (${res.id})`));
    });

  agent
    .command("edit <id>")
    .description("Update an agent")
    .option("--name <name>", "New name")
    .option("--avatar <value>", "New avatar: emoji, URL, or base64 data URI")
    .option("--persona <id>", "New primary persona id")
    .action(async (id: string, opts: { name?: string; avatar?: string; persona?: string }) => {
      const { orchestration } = createGrackleClients();
      const res = await orchestration.updateAgent({
        id,
        name: opts.name,
        avatar: opts.avatar,
        primaryPersonaId: opts.persona,
      });
      console.log(chalk.green(`Updated agent ${chalk.bold(res.name)} (${res.id})`));
    });

  agent
    .command("delete <id>")
    .description("Delete an agent")
    .action(async (id: string) => {
      const { orchestration } = createGrackleClients();
      await orchestration.deleteAgent({ id });
      console.log(chalk.green(`Deleted agent ${id}`));
    });
}
